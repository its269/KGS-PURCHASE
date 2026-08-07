/**
 * Parse Acumatica Excel/CSV exports into inventory catalog + stock level rows.
 * Supports Stock Items GI exports (catalog) and Inventory Summary (with qty).
 */
import * as XLSX from "xlsx";
import { isEcomBranchAlias } from "@/lib/companies";

function normHeader(h) {
    return String(h ?? "")
        .trim()
        .toLowerCase()
        .replace(/[%#]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/** Map normalized header → field key */
const HEADER_ALIASES = {
    inventory_id: [
        "inventory id",
        "inventoryid",
        "inventory cd",
        "item",
        "item id",
        "stock item",
        "sku",
    ],
    description: ["description", "inventory description", "item description", "desc"],
    // Stock / site qty columns (Inventory Summary) — not "Default Warehouse"
    warehouse_id: [
        "warehouse id",
        "warehouseid",
        "site id",
        "siteid",
        "warehouse",
        "site",
    ],
    branch_id: ["branch id", "branchid", "branch"],
    default_warehouse: ["default warehouse", "defaultwarehouse", "default site"],
    on_hand: [
        "qty on hand",
        "qty. on hand",
        "on hand",
        "onhand",
        "qty on hand base",
        "quantity on hand",
    ],
    available: [
        "qty available",
        "qty. available",
        "available",
        "qty available for shipping",
        "quantity available",
    ],
    item_class: ["item class", "itemclass", "class"],
    item_status: ["item status", "itemstatus"],
    default_price: ["default price", "price", "unit price", "base price"],
    base_unit: ["base unit", "uom", "base uom"],
    item_type: ["item type", "type", "itemtype"],
    posting_class: ["posting class", "postingclass"],
    tax_category: ["tax category", "taxcategory"],
};

function buildHeaderMap(headerRow) {
    const map = {};
    const cells = (headerRow || []).map(normHeader);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        const idx = cells.findIndex((c) => aliases.includes(c));
        if (idx >= 0) map[field] = idx;
    }
    // Prefer exact "warehouse id" over bare "warehouse" already handled by alias order
    return map;
}

function cell(row, idx) {
    if (idx === undefined || idx < 0) return "";
    const v = row[idx];
    if (v == null) return "";
    return String(v).trim();
}

function num(row, idx) {
    const raw = cell(row, idx);
    if (!raw) return null;
    const n = Number(String(raw).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
}

function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    return lines.map((line) => {
        const cells = [];
        let cur = "";
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQ = !inQ;
                continue;
            }
            if (ch === "," && !inQ) {
                cells.push(cur);
                cur = "";
                continue;
            }
            cur += ch;
        }
        cells.push(cur);
        return cells.map((c) => c.trim().replace(/^"|"$/g, ""));
    });
}

/**
 * Acumatica Excel exports often use lowercase cell addresses (a1) and a broken !ref.
 * Normalize so SheetJS can read them.
 */
function normalizeAcumaticaSheet(sheet) {
    if (!sheet || typeof sheet !== "object") return sheet;
    const fixed = {};
    let maxC = 0;
    let maxR = 0;
    for (const [key, value] of Object.entries(sheet)) {
        if (key.startsWith("!")) {
            fixed[key] = value;
            continue;
        }
        const upper = key.toUpperCase();
        fixed[upper] = value;
        try {
            const cell = XLSX.utils.decode_cell(upper);
            if (Number.isFinite(cell.c) && cell.c > maxC) maxC = cell.c;
            if (Number.isFinite(cell.r) && cell.r > maxR) maxR = cell.r;
        } catch {
            /* skip bad keys */
        }
    }
    if (maxC >= 0 && maxR >= 0) {
        fixed["!ref"] = XLSX.utils.encode_range({
            s: { c: 0, r: 0 },
            e: { c: maxC, r: maxR },
        });
    }
    return fixed;
}

export function sheetToRows(buffer, filename = "") {
    const lower = String(filename || "").toLowerCase();
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
        const preferred =
            wb.SheetNames.find((n) => /^data$/i.test(n)) ||
            wb.SheetNames.find((n) => /data|export|stock|inventory/i.test(n)) ||
            wb.SheetNames[0];
        const sheet = normalizeAcumaticaSheet(wb.Sheets[preferred]);
        return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    }
    return parseCsv(buffer.toString("utf8"));
}

/**
 * @returns {{ catalogs: object[], levels: object[], skipped: number, mode: string, detected: object }}
 */
export function parseAcumaticaInventoryExport(rows) {
    if (!rows?.length || rows.length < 2) {
        throw new Error("File has no data rows.");
    }

    let headerIdx = 0;
    let headerMap = buildHeaderMap(rows[0]);
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const trial = buildHeaderMap(rows[i]);
        if (trial.inventory_id !== undefined) {
            headerIdx = i;
            headerMap = trial;
            break;
        }
    }

    if (headerMap.inventory_id === undefined) {
        throw new Error(
            "Could not find an Inventory ID column. Export Stock Items (or Inventory Summary) from Acumatica."
        );
    }

    const hasQtyColumns =
        headerMap.on_hand !== undefined || headerMap.available !== undefined;
    const catalogsById = new Map();
    const levels = [];
    let skipped = 0;

    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.length) continue;
        const inventoryId = cell(row, headerMap.inventory_id);
        if (!inventoryId || inventoryId.toLowerCase() === "false") {
            // skip blank / checkbox-only junk
            if (!inventoryId) skipped += 1;
            continue;
        }

        const description = cell(row, headerMap.description);
        const itemClass = cell(row, headerMap.item_class);
        const itemStatus = cell(row, headerMap.item_status) || "Active";
        const baseUnit = cell(row, headerMap.base_unit);
        const itemType = cell(row, headerMap.item_type);
        const postingClass = cell(row, headerMap.posting_class);
        const defaultPrice = num(row, headerMap.default_price);
        const defaultWarehouse = cell(row, headerMap.default_warehouse);

        if (!catalogsById.has(inventoryId)) {
            catalogsById.set(inventoryId, {
                inventory_id: inventoryId,
                description: description || inventoryId,
                item_class: itemClass || "",
                default_price: defaultPrice,
                item_status: itemStatus,
                base_unit: baseUnit || "",
                item_type: itemType || "",
                posting_class: postingClass || "",
                // retained for messaging / future use
                default_warehouse: defaultWarehouse || "",
            });
        } else if (description) {
            const existing = catalogsById.get(inventoryId);
            if (!existing.description || existing.description === inventoryId) {
                existing.description = description;
            }
        }

        // Only write stock levels when the file has qty columns (Inventory Summary style)
        if (!hasQtyColumns) continue;

        const warehouse =
            cell(row, headerMap.warehouse_id) ||
            cell(row, headerMap.branch_id) ||
            defaultWarehouse;
        const onHand = num(row, headerMap.on_hand);
        const available = num(row, headerMap.available);

        if (!warehouse) continue;

        levels.push({
            inventory_id: inventoryId,
            warehouse_id: warehouse,
            branch_id: warehouse,
            site_id: warehouse,
            description: description || null,
            item_class: itemClass || "",
            default_price: defaultPrice,
            item_status: itemStatus,
            base_unit: baseUnit || "",
            item_type: itemType || "",
            posting_class: postingClass || "",
            on_hand: onHand ?? 0,
            available: available ?? onHand ?? 0,
        });
    }

    return {
        catalogs: [...catalogsById.values()],
        levels,
        skipped,
        mode: hasQtyColumns ? "stock" : "catalog",
        detected: {
            headerRow: headerIdx + 1,
            columns: Object.keys(headerMap),
            catalogCount: catalogsById.size,
            levelCount: levels.length,
            hasQtyColumns,
        },
    };
}

export function splitImportedLevelsByCompany(levels) {
    const main = [];
    const ecommerce = [];
    for (const level of levels || []) {
        if (isEcomBranchAlias(level.branch_id || level.warehouse_id)) {
            ecommerce.push(level);
        } else {
            main.push(level);
        }
    }
    return { main, ecommerce };
}
