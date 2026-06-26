import { MySqlService } from "@/services/mysql";
const ACU_BASE = `${process.env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;

// Bypasses 'CERT_HAS_EXPIRED' error for Acumatica connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const toISODate = (date) => date.toISOString().split("T")[0];

/** --- DATA EXTRACTION HELPERS --- */
const getF = (obj, keyName) => {
    if (!obj) return "";
    const k = Object.keys(obj).find(i => i.toLowerCase() === keyName.toLowerCase());
    if (!k) return "";
    const val = obj[k];
    if (val === null || val === undefined) return "";
    if (typeof val === "object") return val.value ?? "";
    return val;
};

const getAny = (obj, ...keys) => {
    for (const k of keys) {
        const v = getF(obj, k);
        if (v !== "" && v !== null && v !== undefined) return v;
    }
    return "";
};

/** Catalog fields shared across all warehouse rows for one StockItem */
export function extractStockItemCatalog(item) {
    const invId = String(getF(item, "InventoryID")).trim();
    if (!invId) return null;
    return {
        inventory_id: invId,
        description: String(getF(item, "Description")).trim(),
        item_class: String(getF(item, "ItemClass")).trim(),
        default_price: parseFloat(getF(item, "DefaultPrice") || 0),
        item_status: String(getF(item, "ItemStatus") || "Active"),
        base_unit: String(getF(item, "BaseUnit") || ""),
        item_type: String(getF(item, "ItemType") || ""),
        posting_class: String(getF(item, "PostingClass") || ""),
    };
}

/**
 * Map Acumatica WarehouseDetails to per-site stock rows.
 * SiteID (branch) is the location key — WarehouseID is the physical warehouse only.
 */
export function extractWarehouseLevels(item, catalogFields = {}) {
    const invId = String(getF(item, "InventoryID")).trim();
    if (!invId) return [];

    let wds = item.WarehouseDetails || [];
    if (wds && !Array.isArray(wds) && wds.value) wds = wds.value;
    if (!Array.isArray(wds)) wds = [];

    const levels = [];
    for (const wh of wds) {
        const siteId = String(
            getAny(wh, "SiteID", "Branch", "BranchID", "LinkBranch") || getAny(wh, "WarehouseID")
        ).trim();
        if (!siteId) continue;

        const onHand = parseFloat(getAny(wh, "QtyOnHand", "OnHand", "Qty") || 0);
        let available = parseFloat(getAny(wh, "QtyAvailable", "Available", "QtyAvail", "AvailableQty") || 0);
        const onHandVal = Number.isNaN(onHand) ? 0 : onHand;
        if (Number.isNaN(available)) available = onHandVal;

        levels.push({
            inventory_id: invId,
            branch_id: siteId,
            site_id: siteId,
            on_hand: onHandVal,
            available: Number.isNaN(available) ? onHandVal : available,
            ...catalogFields,
        });
    }
    return levels;
}

/** Extract PO detail lines from an Acumatica PurchaseOrder record */
const extractPoDetails = (po) => {
    let details =
        po?.Details ||
        po?.details ||
        po?.Transactions ||
        po?.transactions ||
        po?.PurchaseOrderDetails ||
        [];
    if (details && !Array.isArray(details) && details.value) details = details.value;
    return Array.isArray(details) ? details : [];
};

/** Map a single Acumatica PO detail line to the flattened UI model */
const mapPoLine = (line) => {
    const qty = parseFloat(getAny(line, "OrderQty", "Qty", "Quantity") || 0);
    const unitCost = parseFloat(getAny(line, "UnitCost", "CuryUnitCost") || 0);
    let extCost = parseFloat(getAny(line, "ExtendedCost", "LineAmount", "Amount", "CuryExtCost") || 0);
    if (!extCost && qty && unitCost) extCost = qty * unitCost;

    return {
        inventoryId: getF(line, "InventoryID"),
        description: getAny(line, "LineDescription", "Description", "TransactionDescription"),
        qty,
        uom: getF(line, "UOM"),
        extCost,
    };
};

/** Map a PurchaseOrder header + lines to the API response shape */
const mapPurchaseOrder = (po) => ({
    orderNbr: getF(po, "OrderNbr"),
    orderType: getF(po, "OrderType"),
    status: getF(po, "Status"),
    date: getF(po, "Date"),
    vendorId: getF(po, "VendorID"),
    vendorName: getF(po, "VendorName"),
    totalAmount: parseFloat(getF(po, "OrderTotal") || 0),
    lines: extractPoDetails(po).map(mapPoLine),
});

/** Build OData filters for a PO number (handles combined type+nbr like MNLP260480). */
const buildOrderFilters = (orderNbr) => {
    const full = String(orderNbr || "").trim().replace(/'/g, "''");
    if (!full) return [];
    const filters = [`OrderNbr eq '${full}'`];
    const m = full.match(/^([A-Z]+)(\d+)$/);
    if (m) filters.push(`OrderType eq '${m[1]}' and OrderNbr eq '${m[2]}'`);
    return filters;
};

// --- SALES SYNC STATE MANAGEMENT ---
let activeSalesSyncId = 0;
let salesAbortController = null;

/** List Acumatica companies visible to the logged-in user (after main-company auth). */
export async function discoverAcumaticaCompanies(cookie) {
    const endpoints = [
        `${ACU_BASE}/Company?$select=CompanyID,CompanyName`,
        `${ACU_BASE}/Companies?$select=CompanyID,CompanyName`,
    ];
    for (const url of endpoints) {
        try {
            const res = await AcumaticaService.fetchWithRetry(url, cookie);
            const data = await res.json();
            const rows = data.value || (Array.isArray(data) ? data : []);
            if (!rows.length) continue;
            const companies = rows
                .map((r) => ({
                    id: String(getF(r, "CompanyID")).trim(),
                    name: String(getF(r, "CompanyName") || getF(r, "CompanyID")).trim(),
                }))
                .filter((c) => c.id);
            if (companies.length) return companies;
        } catch (err) {
            console.warn("[Acumatica discoverCompanies]", url, err.message);
        }
    }
    return [];
}

/** Pick the ecommerce company ID from discovery or env. */
export function pickEcommerceCompany(companies, mainCompanyId) {
    const mainKey = String(mainCompanyId || "").trim().toUpperCase();
    const envEcom = String(process.env.ACUMATICA_ECOM_COMPANY || "").trim();

    if (envEcom) {
        const envMatch = companies.find((c) => c.id.toUpperCase() === envEcom.toUpperCase());
        if (envMatch) return envMatch.id;
    }

    const ecomMatch = companies.find((c) => {
        const id = c.id.toUpperCase();
        const name = (c.name || "").toUpperCase();
        if (!id || id === mainKey) return false;
        return id.includes("ECOM") || name.includes("ECOM");
    });
    if (ecomMatch) return ecomMatch.id;

    const nonMain = companies.find((c) => c.id.toUpperCase() !== mainKey);
    return nonMain?.id || envEcom || null;
}

export const AcumaticaService = {
    async fetchWithRetry(url, credential, options = {}) {
        // credential can be a cookie string OR "__bearer__<token>" from session-store
        const isBearer = typeof credential === "string" && credential.startsWith("__bearer__");
        const authHeaders = isBearer
            ? { "Authorization": `Bearer ${credential.slice(10)}` }
            : { "Cookie": credential || "" };

        let lastError = null;
        for (let attempts = 1; attempts <= 3; attempts++) {
            try {
                const res = await fetch(url, {
                    ...options,
                    headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0", ...authHeaders, ...options.headers },
                    cache: 'no-store',
                });
                if (res.status === 401) throw new Error("Unauthorized");
                if (res.ok) return res;

                // Try to get detailed error from body
                let errorDetail = "";
                try {
                    const errJson = await res.json();
                    errorDetail = errJson.message || errJson.exceptionMessage || JSON.stringify(errJson);
                } catch {
                    errorDetail = `HTTP ${res.status}`;
                }

                lastError = new Error(`${errorDetail} (from ${url})`);
                if (res.status < 500) break; // Don't retry client errors
                await new Promise(r => setTimeout(r, 1000 * attempts));
            } catch (err) {
                if (err.name === 'AbortError') throw err;
                lastError = err;
            }
        }
        throw lastError;
    },

    async getBranches(cookie) {
        const url = `${ACU_BASE}/Warehouse?$select=WarehouseID,Description`;
        const res = await this.fetchWithRetry(url, cookie);
        const data = await res.json();
        return (data.value || []).map(w => ({ SiteID: w.WarehouseID?.value || w.WarehouseID })).sort((a, b) => a.SiteID.localeCompare(b.SiteID));
    },

    async getRealBranches(cookie) {
        // Try the Branch endpoint first; fall back to Warehouse if unavailable (404)
        try {
            const url = `${ACU_BASE}/Branch?$select=BranchID,Description`;
            const res = await this.fetchWithRetry(url, cookie);
            const data = await res.json();
            const raw = data.value || (Array.isArray(data) ? data : []);
            if (raw.length > 0) {
                return raw.map(b => ({
                    BranchID: getF(b, "BranchID"),
                    Description: getF(b, "Description")
                }));
            }
        } catch { /* fall through to Warehouse fallback */ }

        // Fallback: derive branches from Warehouse
        const url = `${ACU_BASE}/Warehouse?$select=WarehouseID,Description`;
        const res = await this.fetchWithRetry(url, cookie);
        const data = await res.json();
        const raw = data.value || (Array.isArray(data) ? data : []);
        return raw.map(w => ({
            BranchID: getF(w, "WarehouseID"),
            Description: getF(w, "Description") || getF(w, "WarehouseID")
        }));
    },

    async getStockItems({ page = 1, pageSize = 50, search = "", branch = "", cookie, includeStats = false, includeCount = false }) {
        const skip = (page - 1) * pageSize;
        const top = pageSize;

        let filterArr = [];
        if (search) {
            const s = search.replace(/'/g, "''");
            // ERP only supports AND. Using substringof on InventoryID as it's the primary identifier.
            filterArr.push(`substringof('${s}', InventoryID)`);
        }

        let queryParams = [`$expand=WarehouseDetails`, `$top=${top}`, `$skip=${skip}`, `$count=true`];
        if (filterArr.length > 0) {
            queryParams.push(`$filter=${encodeURIComponent(filterArr.join(" and "))}`);
        }

        const url = `${ACU_BASE}/StockItem?${queryParams.join("&")}`;
        console.log(`>>> [Acumatica] Fetching StockItems: ${url}`);

        const res = await this.fetchWithRetry(url, cookie);
        const data = await res.json();
        const items = data.value || [];
        const totalCount = data["@odata.count"] || items.length;

        let flattened = [];
        for (const item of items) {
            let wds = item.WarehouseDetails || [];
            if (wds && !Array.isArray(wds) && wds.value) wds = wds.value;
            if (!Array.isArray(wds)) wds = [];

            if (wds.length === 0) {
                if (!branch) {
                    flattened.push({
                        InventoryID: { value: getF(item, "InventoryID") },
                        Description: { value: getF(item, "Description") },
                        Branch: { value: "—" },
                        SiteID: { value: "—" },
                        OnHand: { value: 0 },
                        Available: { value: 0 },
                        DefaultPrice: { value: parseFloat(getF(item, "DefaultPrice") || 0) },
                        ItemClass: { value: getF(item, "ItemClass") },
                    });
                }
                continue;
            }
            for (const wh of wds) {
                const siteId = String(
                    getAny(wh, "SiteID", "Branch", "BranchID", "LinkBranch") || getF(wh, "WarehouseID")
                ).trim();
                if (branch && siteId.toLowerCase() !== branch.toLowerCase()) continue;

                const onHand = parseFloat(getAny(wh, "QtyOnHand", "OnHand", "Qty") || 0);
                let available = parseFloat(getAny(wh, "QtyAvailable", "Available", "QtyAvail", "AvailableQty") || 0);
                const onHandVal = Number.isNaN(onHand) ? 0 : onHand;
                if (Number.isNaN(available)) available = onHandVal;

                flattened.push({
                    InventoryID: { value: getF(item, "InventoryID") },
                    Description: { value: getF(item, "Description") },
                    Branch: { value: siteId },
                    SiteID: { value: siteId },
                    OnHand: { value: onHandVal },
                    Available: { value: Number.isNaN(available) ? onHandVal : available },
                    DefaultPrice: { value: parseFloat(getF(item, "DefaultPrice") || 0) },
                    ItemClass: { value: getF(item, "ItemClass") },
                    ItemStatus: { value: getF(item, "ItemStatus") },
                    BaseUnit: { value: getF(item, "BaseUnit") },
                });
            }
        }

        return {
            data: flattened,
            totalCount: totalCount,
            hasMore: items.length === pageSize
        };
    },

    async getSalesAnalysis({ branch, cookie, startDate, endDate }) {
        let filterArr = [];
        if (startDate) filterArr.push(`Date ge datetimeoffset'${startDate}T00:00:00Z'`);
        if (endDate) filterArr.push(`Date le datetimeoffset'${endDate}T23:59:59Z'`);
        if (branch) filterArr.push(`Branch eq '${branch}'`);

        const filter = filterArr.length > 0 ? `&$filter=${filterArr.join(" and ")}` : "";
        const url = `${ACU_BASE}/SalesInvoice?$expand=Details&$top=1000${filter}`;

        const res = await this.fetchWithRetry(url, cookie);
        const data = await res.json();
        return data.value || [];
    },

    /** ── VENDORS ── */
    async getVendors({ page = 1, pageSize = 50, search = "", cookie }) {
        const top = parseInt(pageSize, 10);
        const skip = (parseInt(page, 10) - 1) * top;
        let url = `${ACU_BASE}/Vendor?$top=${top}&$skip=${skip}`;
        
        if (search) {
            const s = search.replace(/'/g, "''");
            // Only search by VendorID if ERP doesn't support OR
            // Or try substringof if supported. Based on probe, substringof is supported but NOT OR.
            // We'll prioritize VendorID startswith for reliability or just skip OData filter and fetch more.
            url += `&$filter=substringof('${s}', VendorID)`;
        }

        const res = await this.fetchWithRetry(url, cookie);
        const data = await res.json();
        const vendors = data.value || [];

        return {
            vendors: vendors.map(v => ({
                vendorId: getF(v, "VendorID"),
                vendorName: getF(v, "VendorName"),
                status: getF(v, "Status"),
                reliabilityScore: 100 // Placeholder
            })),
            totalCount: vendors.length,
            hasMore: vendors.length === top
        };
    },

    /** ── PURCHASE ORDERS ── */
    async getPurchaseOrders({ page = 1, pageSize = 50, search = "", cookie, startDate = "", status = "" }) {
        const skip = (page - 1) * pageSize;
        const top = pageSize + 1;

        let filterArr = [];
        if (search) {
            const s = search.replace(/'/g, "''");
            // ERP only supports AND. Cannot use OR. 
            // We will filter by OrderNbr primarily as it's the most common search target.
            filterArr.push(`substringof('${s}', OrderNbr)`);
        }
        if (status) {
            filterArr.push(`Status eq '${status}'`);
        }
        if (startDate) {
            filterArr.push(`Date ge datetimeoffset'${startDate}T00:00:00Z'`);
        }

        let queryParams = [
            `$expand=Details`,
            `$top=${top}`,
            `$skip=${skip}`,
            `$orderby=${encodeURIComponent("Date desc,OrderNbr desc")}`
        ];
        if (filterArr.length > 0) {
            queryParams.push(`$filter=${encodeURIComponent(filterArr.join(" and "))}`);
        }

        const url = `${ACU_BASE}/PurchaseOrder?${queryParams.join("&")}`;

        console.log(`>>> [Acumatica] Fetching PO: ${url}`);
        const res = await this.fetchWithRetry(url, cookie);
        const data = await res.json();
        const rawOrders = data.value || (Array.isArray(data) ? data : []);

        const hasMore = rawOrders.length > pageSize;
        const orders = rawOrders.slice(0, pageSize).map(mapPurchaseOrder);

        return { orders, hasMore };
    },

    /** Fetch line items for specific order numbers (used when MySQL lines are missing) */
    async getPurchaseOrderLinesByNbrs(orderNbrs, cookie) {
        const nbrs = [...new Set(orderNbrs.map(n => String(n || "").trim()).filter(Boolean))];
        if (!nbrs.length || !cookie) return new Map();

        const lineMap = new Map();
        const CONCURRENCY = 4;

        const fetchOne = async (nbr) => {
            for (const filter of buildOrderFilters(nbr)) {
                try {
                    const url = `${ACU_BASE}/PurchaseOrder?$expand=Details&$filter=${encodeURIComponent(filter)}&$top=1`;
                    const res = await this.fetchWithRetry(url, cookie);
                    const data = await res.json();
                    const rawOrders = data.value || (Array.isArray(data) ? data : []);
                    if (!rawOrders.length) continue;

                    const mapped = mapPurchaseOrder(rawOrders[0]);
                    const key = String(nbr).trim();
                    if (mapped.lines?.length) {
                        lineMap.set(key, mapped.lines);
                        if (mapped.orderNbr && mapped.orderNbr !== key) {
                            lineMap.set(String(mapped.orderNbr).trim(), mapped.lines);
                        }
                        return;
                    }
                } catch {
                    // try next filter variant
                }
            }
        };

        for (let i = 0; i < nbrs.length; i += CONCURRENCY) {
            const batch = nbrs.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(nbr => fetchOne(nbr).catch(err => {
                console.error(`[PO Line Fetch] ${nbr}:`, err.message);
            })));
        }

        return lineMap;
    },

    /** ── REPLENISHMENT RECOMMENDATIONS ── */
    async getReplenishmentRecommendations({ cookie }) {
        // We derive recommendations from active items with low stock availability
        // Scan 300 items to ensure we find enough low-stock candidates
        const url = `${ACU_BASE}/StockItem?$expand=WarehouseDetails&$top=300&$filter=ItemStatus eq 'Active'`;
        const res = await this.fetchWithRetry(url, cookie);
        const data = await res.json();
        const items = data.value || (Array.isArray(data) ? data : []);

        const recommendations = [];
        let recId = 1000;

        for (const item of items) {
            const inventoryId = getF(item, "InventoryID");
            if (!inventoryId) continue;

            const description = getF(item, "Description");
            let wds = item.WarehouseDetails || [];

            // Handle cases where expansion is wrapped in { value: [...] }
            if (wds && !Array.isArray(wds) && wds.value) wds = wds.value;
            if (!Array.isArray(wds)) wds = [];

            // Sum availability across all warehouses
            // We use QtyAvailable as the primary metric, but fallback to QtyOnHand if missing
            const totalAvailable = wds.reduce((sum, wh) => {
                const val = parseFloat(getAny(wh, "QtyAvailable", "Available", "QtyOnHand", "OnHand", "Qty", "AvailableQty", "QtyAvail") || 0);
                return sum + (isNaN(val) ? 0 : val);
            }, 0);

            // Logic: If available < 50 units total, recommend replenishment
            if (totalAvailable < 50) {
                const suggestedQty = 100 - totalAvailable;
                const priority = totalAvailable < 10 ? "High" : totalAvailable < 30 ? "Medium" : "Low";

                recommendations.push({
                    recommendationId: `REC-${recId++}`,
                    itemId: inventoryId,
                    description: description,
                    currentStock: totalAvailable,
                    suggestedQty: Math.ceil(suggestedQty),
                    priorityLevel: priority,
                    generatedDate: new Date().toISOString(),
                    aiInsights: {
                        formula: `(Optimal Stock: 100) - (Current Stock: ${totalAvailable})`,
                        message: totalAvailable < 10 
                            ? "Critical stock level detected. Immediate replenishment advised to avoid complete stockout." 
                            : "Stock level is below safety threshold. Restocking recommended to maintain operational buffer.",
                        stockoutRisk: totalAvailable < 10 ? "Critical (90%+)" : totalAvailable < 30 ? "High (60%)" : "Moderate (30%)"
                    }
                });
            }
        }

        return recommendations.sort((a, b) => {
            const pMap = { "High": 3, "Medium": 2, "Low": 1 };
            if (pMap[b.priorityLevel] !== pMap[a.priorityLevel]) {
                return pMap[b.priorityLevel] - pMap[a.priorityLevel];
            }
            return a.currentStock - b.currentStock; // Lower stock first within same priority
        });
    },

    /** Live branch stock from Acumatica for specific items */
    async getBranchStockForItems(itemIds, branch, cookie) {
        const map = new Map();
        const ids = [...new Set(itemIds.map((id) => String(id || "").trim()).filter(Boolean))];
        if (!ids.length || !cookie || cookie === "__bypass__") return map;

        const branchKey = String(branch || "").toUpperCase().trim();
        const CHUNK = 6;

        for (let i = 0; i < ids.length; i += CHUNK) {
            const batch = ids.slice(i, i + CHUNK);
            const filter = batch.map((id) => `InventoryID eq '${id.replace(/'/g, "''")}'`).join(" or ");
            const url = `${ACU_BASE}/StockItem?$expand=WarehouseDetails&$filter=${encodeURIComponent(filter)}`;
            try {
                const res = await this.fetchWithRetry(url, cookie);
                const data = await res.json();
                for (const item of (data.value || [])) {
                    const invKey = String(getF(item, "InventoryID")).trim().toUpperCase();
                    const levels = extractWarehouseLevels(item);
                    let stock = 0;
                    for (const level of levels) {
                        if (!branchKey || level.branch_id.toUpperCase() === branchKey) {
                            stock += level.on_hand;
                        }
                    }
                    map.set(invKey, stock);
                }
            } catch (err) {
                console.error("[Acumatica getBranchStockForItems]", err.message);
            }
        }
        return map;
    },

    /** ── SALES: Discover Periods and Fetch Data ── */
    async fetchSalesBySpecificMonths({ cookie, targetMonths }) {
        if (salesAbortController) salesAbortController.abort();
        salesAbortController = new AbortController();
        const signal = salesAbortController.signal;
        const syncId = ++activeSalesSyncId;

        const results = [];
        const pageSize = 1000;

        try {
            // 1. DISCOVER ACTUAL PERIOD IDs FROM ACUMATICA
            console.log(`>>> [Acumatica] [Req #${syncId}] Discovering actual Period IDs for:`, targetMonths);
            const pRes = await this.fetchWithRetry(`${ACU_BASE}/FinancialPeriod?$top=500`, cookie);
            const pData = await pRes.json();
            const allPeriods = Array.isArray(pData) ? pData : (pData.value || []);

            const getPeriodId = (p) => p.FinancialPeriodID?.value || p.FinancialPeriodID || p.PeriodID?.value || p.PeriodID;

            // Match our target months to actual ERP Period IDs
            const discoveredIds = [];
            for (const target of targetMonths) {
                const match = allPeriods.find(p => {
                    const pStart = new Date(p.StartDate?.value || p.StartDate);
                    return pStart.getMonth() === target.month - 1 && pStart.getFullYear() === target.year;
                });
                if (match) discoveredIds.push(getPeriodId(match));
            }

            console.log(`>>> [Acumatica] [Req #${syncId}] Discovered ERP Period IDs:`, discoveredIds);

            if (discoveredIds.length === 0) {
                console.log(`>>> [Acumatica] [Req #${syncId}] No matching periods found in ERP. Falling back to date-based range.`);

                const startMonth = targetMonths[0];
                const endMonth = targetMonths[targetMonths.length - 1];
                if (!startMonth) return [];

                const startDate = `${startMonth.year}-${String(startMonth.month).padStart(2, '0')}-01T00:00:00Z`;
                const lastDay = new Date(endMonth.year, endMonth.month, 0).getDate();
                const endDate = `${endMonth.year}-${String(endMonth.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59Z`;

                // Try multiple entities to find real sales
                const entities = ["Invoice", "SalesInvoice", "CashSale"];
                const flatResults = [];

                for (const entity of entities) {
                    if (signal.aborted) break;
                    console.log(`>>> [Acumatica] [Req #${syncId}] Trying ${entity} (Limit 2000, OrderBy Amount Desc)...`);

                    const filter = `Date ge datetimeoffset'${startDate}' and Date le datetimeoffset'${endDate}'`;
                    const url = `${ACU_BASE}/${entity}?$expand=Details&$top=2000&$filter=${filter}&$orderby=Amount desc`;

                    try {
                        const res = await this.fetchWithRetry(url, cookie, { signal });
                        const data = await res.json();
                        const items = data.value || (Array.isArray(data) ? data : []);
                        console.log(`>>> [Acumatica] [Req #${syncId}] Found ${items.length} records in ${entity}.`);
                        if (items.length > 0) {
                            flatResults.push(...items);
                        }
                    } catch (e) {
                        console.warn(`>>> [Acumatica] [Req #${syncId}] ${entity} fetch failed:`, e.message);
                    }
                }

                console.log(`>>> [Acumatica] [Req #${syncId}] TOTAL FALLBACK RECORDS: ${flatResults.length}`);
                return flatResults;
            }

            // 2. FETCH DATA USING DISCOVERED IDs
            for (const id of discoveredIds) {
                if (signal.aborted) break;
                let skip = 0;
                while (true) {
                    if (signal.aborted) break;
                    console.log(`>>> [Acumatica] [Req #${syncId}] Fetching Period ${id} (Skip ${skip})...`);
                    // Try Invoice for period-based fetching
                    const url = `${ACU_BASE}/Invoice?$expand=Details&$top=${pageSize}&$skip=${skip}&$filter=PostPeriod eq '${id}'`;

                    const res = await this.fetchWithRetry(url, cookie, { signal });
                    const data = await res.json();
                    const items = data.value || (Array.isArray(data) ? data : []);

                    results.push(...items);
                    if (items.length < pageSize) break;
                    skip += pageSize;
                }
            }

            console.log(`>>> [Acumatica] [Req #${syncId}] FETCH COMPLETE. Total: ${results.length} records.`);
            return results;

        } catch (err) {
            return [];
        } finally {
            if (activeSalesSyncId === syncId) salesAbortController = null;
        }
    }
};
