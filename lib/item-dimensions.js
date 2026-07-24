/** Dimension field definitions — matches Excel export format */

export const DIMENSION_FIELDS = [
    { key: "pcs_per_box", label: "PCS/BOX", step: "1" },
    { key: "length_m", label: "L box size M", step: "0.001" },
    { key: "height_m", label: "H box size M", step: "0.001" },
    { key: "width_m", label: "W box size M", step: "0.001" },
    { key: "weight_kg", label: "KG", step: "0.01" },
    { key: "cbm", label: "CBM", step: "0.000001" },
];

const HEADER_ALIASES = {
    inventory_id: ["inventory id", "inventoryid", "item id", "itemid", "sku"],
    pcs_per_box: ["pcs/box", "pcs per box", "pcs_box"],
    length_m: ["l box size m", "length", "length m", "l box size"],
    height_m: ["h box size m", "height", "height m", "h box size"],
    width_m: ["w box size m", "width", "width m", "w box size"],
    weight_kg: ["kg", "weight", "weight kg"],
    cbm: ["cbm", "cubic meter", "cubic metres"],
};

function normHeader(h) {
    return String(h || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function mapHeaders(rowHeaders) {
    const map = {};
    rowHeaders.forEach((h, idx) => {
        const n = normHeader(h);
        for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
            if (aliases.includes(n) || n === key.replace(/_/g, " ")) {
                map[key] = idx;
            }
        }
    });
    return map;
}

function parseNum(val) {
    if (val === null || val === undefined || val === "") return null;
    const n = Number(String(val).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
}

export function rowToDimensions(cells, headerMap) {
    const invIdx = headerMap.inventory_id;
    if (invIdx === undefined) return null;
    const inventoryId = String(cells[invIdx] ?? "").trim();
    if (!inventoryId) return null;

    const data = { inventory_id: inventoryId };
    for (const { key } of DIMENSION_FIELDS) {
        const idx = headerMap[key];
        data[key] = idx !== undefined ? parseNum(cells[idx]) : null;
    }
    return data;
}

export function isEmptyDimValue(v) {
    return v === null || v === undefined || v === "";
}

export function mergeDimensionsFillEmpty(existing, incoming) {
    const out = { inventory_id: incoming.inventory_id };
    for (const { key } of DIMENSION_FIELDS) {
        const cur = existing?.[key];
        const next = incoming[key];
        if (!isEmptyDimValue(cur)) {
            out[key] = cur;
        } else if (!isEmptyDimValue(next)) {
            out[key] = next;
        } else {
            out[key] = null;
        }
    }
    return out;
}

export function hasAnyDimensionValue(row) {
    if (!row) return false;
    return DIMENSION_FIELDS.some(({ key }) => !isEmptyDimValue(row[key]));
}
