/**
 * Smoke-test Purchase Receipts parse (no Next alias).
 */
import fs from "fs";
import * as XLSX from "xlsx";

function normHeader(h) {
    return String(h ?? "")
        .trim()
        .toLowerCase()
        .replace(/[%#]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeAcumaticaSheet(sheet) {
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
            if (cell.c > maxC) maxC = cell.c;
            if (cell.r > maxR) maxR = cell.r;
        } catch {
            /* skip */
        }
    }
    fixed["!ref"] = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: maxC, r: maxR } });
    return fixed;
}

const path = process.argv[2] || "C:/Users/Carlo/Downloads/Purchase Receipts 20260811.xlsx";
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
const sheet = normalizeAcumaticaSheet(wb.Sheets.Data || wb.Sheets[wb.SheetNames[0]]);
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
const headers = (rows[0] || []).map(normHeader);
const receiptIdx = headers.findIndex((h) => h === "receipt nbr" || h === "receipt nbr.");
console.log({
    rows: rows.length - 1,
    headers,
    hasReceiptNbr: receiptIdx >= 0,
    sample: rows[1],
    sample2: rows[2],
});
