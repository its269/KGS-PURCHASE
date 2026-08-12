import { NextResponse } from "next/server";
import { getSessionFromRequest, getSessionMeta, getSessionIdFromRequest } from "@/lib/session-store";
import { MySqlService } from "@/services/mysql";
import {
    sheetToRows,
    parseAcumaticaInventoryExport,
    parseAcumaticaPurchaseReceiptExport,
    detectAcumaticaImportKind,
    splitImportedLevelsByCompany,
} from "@/lib/acumatica-file-import";
import { hydrateSessionFromDb } from "@/lib/persist-session";
import { isEcomBranchAlias } from "@/lib/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function importInventory(name, rows) {
    const parsed = parseAcumaticaInventoryExport(rows);
    const { main, ecommerce } = splitImportedLevelsByCompany(parsed.levels);

    if (!parsed.catalogs.length) {
        return NextResponse.json(
            { message: "No inventory rows found in the file." },
            { status: 400 }
        );
    }

    await MySqlService.upsertInventoryItems(parsed.catalogs, "main");
    const hasEcomDefault = parsed.catalogs.some((c) =>
        isEcomBranchAlias(c.default_warehouse)
    );
    if (hasEcomDefault || ecommerce.length) {
        await MySqlService.upsertInventoryItems(parsed.catalogs, "ecommerce");
    }

    if (main.length) {
        await MySqlService.upsertInventoryLevels(main, "main");
    }
    if (ecommerce.length) {
        await MySqlService.upsertInventoryLevels(ecommerce, "ecommerce");
    }

    await MySqlService.sanitizeCatalogStockFields("main").catch(() => 0);
    await MySqlService.sanitizeCatalogStockFields("ecommerce").catch(() => 0);

    const modeNote =
        parsed.mode === "catalog"
            ? "catalog only (no qty columns — existing stock levels kept)"
            : `${parsed.levels.length} stock row(s)`;

    await MySqlService.logSyncEvent(
        "import",
        "Inventory",
        "completed",
        parsed.catalogs.length,
        `File import ${name}: ${modeNote}`
    );

    return NextResponse.json({
        success: true,
        importType: "inventory",
        message: `Imported ${parsed.catalogs.length} Stock Item(s) from ${name} (${modeNote}).`,
        mode: parsed.mode,
        catalogs: parsed.catalogs.length,
        stockRows: parsed.levels.length,
        mainRows: main.length,
        ecommerceRows: ecommerce.length,
        skipped: parsed.skipped,
        detected: parsed.detected,
    });
}

async function importPurchaseReceipts(name, rows) {
    const parsed = parseAcumaticaPurchaseReceiptExport(rows);
    if (!parsed.receipts.length) {
        return NextResponse.json(
            { message: "No purchase receipt rows found in the file." },
            { status: 400 }
        );
    }

    const written = await MySqlService.upsertPurchaseReceipts(parsed.receipts);

    await MySqlService.logSyncEvent(
        "import",
        "Purchase Receipts",
        "completed",
        written,
        `File import ${name}: ${written} receipt(s)`
    );

    return NextResponse.json({
        success: true,
        importType: "purchase-receipts",
        message: `Imported ${written.toLocaleString()} Purchase Receipt(s) from ${name}.`,
        receipts: written,
        skipped: parsed.skipped,
        detected: parsed.detected,
    });
}

export async function POST(request) {
    let sessionId = getSessionIdFromRequest(request);
    if (sessionId && !getSessionMeta(sessionId)?.localUser?.id) {
        await hydrateSessionFromDb(sessionId);
    }
    const cookie = getSessionFromRequest(request);
    const meta = sessionId ? getSessionMeta(sessionId) : null;
    if (!cookie && !meta?.localUser?.id) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file === "string") {
            return NextResponse.json({ message: "No file uploaded." }, { status: 400 });
        }

        const name = file.name || "export.xlsx";
        const requestedType = String(form.get("importType") || "auto").trim().toLowerCase();
        const buffer = Buffer.from(await file.arrayBuffer());
        if (!buffer.length) {
            return NextResponse.json({ message: "Uploaded file is empty." }, { status: 400 });
        }

        const rows = sheetToRows(buffer, name);
        const detected = detectAcumaticaImportKind(rows);
        let importType = requestedType;
        if (!importType || importType === "auto") {
            importType = detected === "unknown" ? "inventory" : detected;
        }

        if (
            importType === "purchase-receipts" ||
            importType === "purchase_receipts" ||
            importType === "receipts"
        ) {
            if (detected === "inventory") {
                return NextResponse.json(
                    {
                        message:
                            "This file looks like a Stock Items / Inventory export. Choose Stock Items, or upload a Purchase Receipts list export.",
                    },
                    { status: 400 }
                );
            }
            return await importPurchaseReceipts(name, rows);
        }

        if (detected === "purchase-receipts" && requestedType === "inventory") {
            return NextResponse.json(
                {
                    message:
                        "This file looks like a Purchase Receipts export. Choose Purchase Receipts, or upload a Stock Items / Inventory Summary export.",
                },
                { status: 400 }
            );
        }

        return await importInventory(name, rows);
    } catch (err) {
        console.error("[Sync Import]", err);
        await MySqlService.logSyncEvent("import", "Import", "error", 0, err.message).catch(() => {});
        return NextResponse.json(
            { message: err.message || "Import failed" },
            { status: 400 }
        );
    }
}
