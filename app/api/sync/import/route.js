import { NextResponse } from "next/server";
import { getSessionFromRequest, getSessionMeta, getSessionIdFromRequest } from "@/lib/session-store";
import { MySqlService } from "@/services/mysql";
import {
    sheetToRows,
    parseAcumaticaInventoryExport,
    splitImportedLevelsByCompany,
} from "@/lib/acumatica-file-import";
import { hydrateSessionFromDb } from "@/lib/persist-session";
import { isEcomBranchAlias } from "@/lib/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        const buffer = Buffer.from(await file.arrayBuffer());
        if (!buffer.length) {
            return NextResponse.json({ message: "Uploaded file is empty." }, { status: 400 });
        }

        const rows = sheetToRows(buffer, name);
        const parsed = parseAcumaticaInventoryExport(rows);
        const { main, ecommerce } = splitImportedLevelsByCompany(parsed.levels);

        if (!parsed.catalogs.length) {
            return NextResponse.json(
                { message: "No inventory rows found in the file." },
                { status: 400 }
            );
        }

        await MySqlService.upsertInventoryItems(parsed.catalogs, "main");
        // Also refresh ecommerce catalog copy when default warehouse is ECOMMERCE-heavy
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
            message: `Imported ${parsed.catalogs.length} Stock Item(s) from ${name} (${modeNote}).`,
            mode: parsed.mode,
            catalogs: parsed.catalogs.length,
            stockRows: parsed.levels.length,
            mainRows: main.length,
            ecommerceRows: ecommerce.length,
            skipped: parsed.skipped,
            detected: parsed.detected,
        });
    } catch (err) {
        console.error("[Sync Import]", err);
        await MySqlService.logSyncEvent("import", "Inventory", "error", 0, err.message).catch(() => {});
        return NextResponse.json(
            { message: err.message || "Import failed" },
            { status: 400 }
        );
    }
}
