const ACU_BASE = `${process.env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;
import { MySqlService } from "@/services/mysql";

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

// --- SALES SYNC STATE MANAGEMENT ---
let activeSalesSyncId = 0;
let salesAbortController = null;

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
                const whId = getF(wh, "WarehouseID");
                if (branch && whId.toLowerCase() !== branch.toLowerCase()) continue;

                flattened.push({
                    InventoryID: { value: getF(item, "InventoryID") },
                    Description: { value: getF(item, "Description") },
                    Branch: { value: whId },
                    SiteID: { value: whId },
                    OnHand: { value: parseFloat(getF(wh, "QtyOnHand") || 0) },
                    Available: { value: parseFloat(getF(wh, "QtyAvailable") || 0) },
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
        const orders = rawOrders.slice(0, pageSize).map(po => ({
            orderNbr: getF(po, "OrderNbr"),
            orderType: getF(po, "OrderType"),
            status: getF(po, "Status"),
            date: getF(po, "Date"),
            vendorId: getF(po, "VendorID"),
            vendorName: getF(po, "VendorName"),
            totalAmount: parseFloat(getF(po, "OrderTotal") || 0),
            lines: (po.Details?.value || po.Details || []).map(line => ({
                inventoryId: getF(line, "InventoryID"),
                description: getAny(line, "LineDescription", "Description"),
                qty: parseFloat(getF(line, "OrderQty") || 0),
                uom: getF(line, "UOM"),
                extCost: parseFloat(getF(line, "LineAmount") || 0)
            }))
        }));

        return { orders, hasMore };
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
                    generatedDate: new Date().toISOString()
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
