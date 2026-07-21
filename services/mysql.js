import mysql from "mysql2/promise";
import { mergeDimensionsFillEmpty, hasAnyDimensionValue } from "@/lib/item-dimensions.js";
import {
    sqlExcludeEcomBranches,
    ECOM_BRANCH_ALIASES,
    isEcomBranchAlias,
    isExcludedBranchAlias,
    sqlOnlyEcomBranches,
    sqlExcludeBranches,
    sqlExcludeSalesBranches,
    resolveCompanyIdForBranch,
    sqlExcludeEcomSalesBranches,
    sqlOnlyEcomSalesBranches,
} from "@/lib/companies.js";
import { SALES_LOOKBACK_DAYS, SQL_NET_QTY, SQL_NET_AMOUNT, SQL_GROSS_QTY, netQtySold } from "@/lib/sales-velocity.js";
import { getCached, invalidateCache } from "@/lib/server-cache";

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
});

const purchasePool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
});

async function countWarehouseRows(companyId = "main") {
    return getCached(`wh-count:${companyId}`, 60_000, async () => {
        const [[row]] = await pool.query(
            `SELECT COUNT(*) AS c FROM inventory_items
             WHERE company_id = ? AND default_warehouse != '__catalog__'`,
            [companyId]
        );
        return Number(row?.c) || 0;
    });
}

async function countCatalogRows(companyId = "main") {
    return getCached(`cat-count:${companyId}`, 60_000, async () => {
        const [[row]] = await pool.query(
            `SELECT COUNT(*) AS c FROM inventory_items
             WHERE company_id = ? AND default_warehouse = '__catalog__'`,
            [companyId]
        );
        return Number(row?.c) || 0;
    });
}

/** warehouse = per-site synced rows; catalog = product master only; catalog-empty = no products yet */
async function resolveInventoryLayout(companyId = "main") {
    const warehouseRows = await countWarehouseRows(companyId);
    if (warehouseRows > 0) return "warehouse";
    const catalogRows = await countCatalogRows(companyId);
    if (catalogRows > 0) return "catalog";
    return "catalog-empty";
}

function salesLookbackSql(days = SALES_LOOKBACK_DAYS) {
    const window = parseInt(days, 10) || SALES_LOOKBACK_DAYS;
    return `document_date >= DATE_SUB(CURDATE(), INTERVAL ${window} DAY) AND document_date <= CURDATE()`;
}

/** Join catalog metadata when reading per-branch warehouse stock rows. */
function inventoryFromClause(layout) {
    if (layout === "warehouse") {
        return `FROM inventory_items i
                LEFT JOIN inventory_items c
                  ON c.inventory_id = i.inventory_id
                 AND c.company_id = i.company_id
                 AND c.default_warehouse = '__catalog__'`;
    }
    return `FROM inventory_items i`;
}

function inventoryPlanningCols(alias = "c") {
    return `
                    ${alias}.vendor_id as VendorID,
                    ${alias}.lead_time_days as LeadTimeDays,
                    ${alias}.safety_stock as SafetyStock,
                    ${alias}.moq as MOQ`;
}

function inventorySelectCols(layout) {
    if (layout === "warehouse") {
        return `
                    i.inventory_id as InventoryID,
                    COALESCE(c.inventory_name, i.inventory_name) as Description,
                    COALESCE(c.item_class, i.item_class) as ItemClass,
                    i.branch_id as Branch,
                    i.site_id as SiteID,
                    COALESCE(i.on_hand, 0) as OnHand,
                    COALESCE(i.available, i.on_hand, 0) as Available,
                    COALESCE(c.default_price, i.default_price, 0) as DefaultPrice,
                    ${inventoryPlanningCols("c")}`;
    }
    return `
                    i.inventory_id as InventoryID,
                    i.inventory_name as Description,
                    i.item_class as ItemClass,
                    i.branch_id as Branch,
                    i.site_id as SiteID,
                    COALESCE(i.on_hand, 0) as OnHand,
                    COALESCE(i.available, i.on_hand, 0) as Available,
                    i.default_price as DefaultPrice,
                    ${inventoryPlanningCols("i")}`;
}

function netSalesQtySubquery(purchaseDb, salesEx, branch = "") {
    const branchClause = branch
        ? ` AND TRIM(UPPER(branch_name)) = TRIM(UPPER(?))`
        : "";
    return `(
        SELECT inventory_id, SUM(${SQL_NET_QTY}) as total_qty
        FROM \`${purchaseDb}\`.product_periodic_sales
        WHERE ${salesEx.clause}
          AND ${salesLookbackSql()}${branchClause}
        GROUP BY inventory_id
    )`;
}

const EMPTY_GLOBAL_STATS = {
    totalStock: 0,
    totalValue: 0,
    lowStock: 0,
    totalLowStock: 0,
    outOfStock: 0,
    deadStock: 0,
    overstock: 0,
    count: 0,
    lastSync: null,
};

export const MySqlService = {
    /**
     * Get the latest last_sync timestamp for inventory items
     */
    async getLastInventorySyncTime() {
        try {
            const [[res]] = await pool.query(
                `SELECT MAX(last_sync) as lastSync FROM inventory_items`
            );
            return res.lastSync || null;
        } catch (err) {
            console.error("[MySQL getLastInventorySyncTime Error]", err);
            return null;
        }
    },

    /**
     * Get the latest last_sync timestamp for sales
     */
    async getLastSalesSyncTime() {
        try {
            const [[res]] = await purchasePool.query(
                `SELECT MAX(last_sync) as lastSync FROM product_periodic_sales`
            );
            return res.lastSync || null;
        } catch (err) {
            console.error("[MySQL getLastSalesSyncTime Error]", err);
            return null;
        }
    },

    /** Latest sync timestamp across inventory, sales, and PO — used to invalidate replenishment cache. */
    async getReplenishmentDataWatermark() {
        const [inv, sales, po] = await Promise.all([
            this.getLastInventorySyncTime(),
            this.getLastSalesSyncTime(),
            this.getLastPOSyncTime(),
        ]);
        const stamps = [inv, sales, po]
            .filter(Boolean)
            .map((d) => new Date(d).getTime())
            .filter(Number.isFinite);
        return stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
    },

    /**
     * Get the latest last_sync timestamp for Purchase Orders
     */
    async getLastPOSyncTime() {
        try {
            const [[res]] = await purchasePool.query(
                `SELECT MAX(last_sync) as lastSync FROM purchase_history`
            );
            return res.lastSync || null;
        } catch (err) {
            console.error("[MySQL getLastPOSyncTime Error]", err);
            return null;
        }
    },

    /**
     * Fetch purchase orders from MySQL (for Purchase Orders module)
     */
    async getPurchaseOrders({ page = 1, pageSize = 50, search = "", status = "", startDate = "", endDate = "", branch = "", vendorId = "", companyId = "main" } = {}) {
        const cacheKey = `po:${JSON.stringify({ page, pageSize, search, status, startDate, endDate, branch, vendorId, companyId })}`;
        return getCached(cacheKey, 30_000, () =>
            this._getPurchaseOrdersImpl({ page, pageSize, search, status, startDate, endDate, branch, vendorId, companyId })
        );
    },

    async _getPurchaseOrdersImpl({ page = 1, pageSize = 50, search = "", status = "", startDate = "", endDate = "", branch = "", vendorId = "", companyId = "main" } = {}) {
        const offset = (page - 1) * pageSize;
        const limitInt = parseInt(pageSize, 10);
        const offsetInt = parseInt(offset, 10);
        const inventoryDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";

        try {
            let whereClauses = [];
            let params = [];

            if (status) {
                whereClauses.push("h.status = ?");
                params.push(status);
            }

            if (startDate) {
                whereClauses.push("h.order_date >= ?");
                params.push(startDate);
            }

            if (endDate) {
                whereClauses.push("h.order_date <= ?");
                params.push(`${endDate} 23:59:59`);
            }

            if (search) {
                whereClauses.push("(h.order_nbr LIKE ? OR h.vendor_id LIKE ? OR h.vendor_name LIKE ? OR v.vendor_name LIKE ?)");
                params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
            }

            if (vendorId) {
                whereClauses.push("h.vendor_id = ?");
                params.push(vendorId);
            }

            if (branch) {
                // Filter by PO destination warehouse/branch (from Acumatica line Site/Warehouse),
                // not by whether the SKU currently has stock at that branch.
                whereClauses.push(`EXISTS (
                    SELECT 1 FROM purchase_order_details d
                    WHERE d.order_nbr COLLATE utf8mb4_unicode_ci = h.order_nbr
                      AND (
                        UPPER(TRIM(COALESCE(d.warehouse_id, ''))) = UPPER(TRIM(?))
                        OR UPPER(TRIM(COALESCE(d.branch_id, ''))) = UPPER(TRIM(?))
                      )
                )`);
                params.push(branch, branch);
            }

            const wherePart = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

            const [[rows], [[{ total }]]] = await Promise.all([
                purchasePool.query(
                    `SELECT 
                        h.order_nbr as orderNbr,
                        h.vendor_id as vendorId,
                        COALESCE(NULLIF(TRIM(h.vendor_name), ''), v.vendor_name) as vendorName,
                        h.status,
                        h.order_date as date,
                        h.total_amount as totalAmount
                     FROM purchase_history h
                     LEFT JOIN vendors v ON v.vendor_id COLLATE utf8mb4_unicode_ci = h.vendor_id
                     ${wherePart}
                     ORDER BY h.order_date DESC, h.order_nbr DESC
                     LIMIT ${limitInt} OFFSET ${offsetInt}`,
                    params
                ),
                purchasePool.query(
                    `SELECT COUNT(*) as total FROM purchase_history h
                     LEFT JOIN vendors v ON v.vendor_id COLLATE utf8mb4_unicode_ci = h.vendor_id
                     ${wherePart}`,
                    params
                ),
            ]);

            let linesByOrder = new Map();
            if (rows.length > 0) {
                const orderNbrs = rows.map(r => r.orderNbr);
                const placeholders = orderNbrs.map(() => "?").join(",");
                const [lineRows] = await purchasePool.query(
                    `SELECT order_nbr, line_nbr as lineNbr, inventory_id as inventoryId, description, qty, uom,
                            ext_cost as extCost, warehouse_id as warehouseId, branch_id as branchId
                     FROM purchase_order_details
                     WHERE order_nbr COLLATE utf8mb4_unicode_ci IN (${placeholders})
                     ORDER BY line_nbr ASC`,
                    orderNbrs
                );
                for (const line of lineRows) {
                    const key = String(line.order_nbr || "").trim();
                    if (!linesByOrder.has(key)) linesByOrder.set(key, []);
                    linesByOrder.get(key).push({
                        inventoryId: line.inventoryId,
                        description: line.description,
                        qty: line.qty,
                        uom: line.uom,
                        extCost: line.extCost,
                        warehouseId: line.warehouseId || line.branchId || "",
                        branchId: line.branchId || line.warehouseId || "",
                    });
                }
            }

            const ordersWithLines = rows.map(order => ({
                ...order,
                orderType: "Normal",
                lines: linesByOrder.get(String(order.orderNbr || "").trim()) || [],
            }));

            return {
                orders: ordersWithLines,
                totalCount: total,
                hasMore: total > offset + rows.length
            };
        } catch (err) {
            console.error("[MySQL getPurchaseOrders Error]", err);
            throw err;
        }
    },

    /**
     * Bulk upsert purchase history for reliability calculation
     */
    async upsertPurchaseHistory(rows) {
        if (!rows.length) return;
        const connection = await purchasePool.getConnection();
        try {
            await connection.beginTransaction();
            const sql = `
                INSERT INTO purchase_history 
                (order_nbr, vendor_id, vendor_name, status, order_date, promised_date, receipt_date, total_amount, last_sync)
                VALUES ?
                ON DUPLICATE KEY UPDATE
                vendor_id = VALUES(vendor_id),
                vendor_name = COALESCE(NULLIF(VALUES(vendor_name), ''), vendor_name),
                status = VALUES(status),
                promised_date = VALUES(promised_date),
                receipt_date = COALESCE(VALUES(receipt_date), receipt_date),
                total_amount = VALUES(total_amount),
                last_sync = VALUES(last_sync)
            `;
            const values = rows.map(r => [
                r.order_nbr, r.vendor_id, r.vendor_name, r.status, r.order_date, r.promised_date, r.receipt_date, r.total_amount, new Date()
            ]);
            await connection.query(sql, [values]);
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    },

    async ensureReceivedQtyColumn() {
        try {
            const purchaseDb = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
            const [[row]] = await purchasePool.query(
                `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=? AND TABLE_NAME='purchase_order_details' AND COLUMN_NAME='received_qty'`,
                [purchaseDb]
            );
            if (Number(row?.cnt) === 0) {
                await purchasePool.query(
                    `ALTER TABLE purchase_order_details ADD COLUMN received_qty DECIMAL(18,4) DEFAULT 0 AFTER qty`
                );
            }
            return true;
        } catch (err) {
            console.error("[MySQL ensureReceivedQtyColumn Error]", err);
            return false;
        }
    },

    /** Ensure PO detail warehouse/branch columns exist for Acumatica-accurate branch filtering. */
    async ensurePoWarehouseColumns() {
        try {
            const purchaseDb = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
            for (const col of [
                { name: "warehouse_id", def: "VARCHAR(100) NULL AFTER uom" },
                { name: "branch_id", def: "VARCHAR(100) NULL AFTER warehouse_id" },
            ]) {
                const [[row]] = await purchasePool.query(
                    `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA=? AND TABLE_NAME='purchase_order_details' AND COLUMN_NAME=?`,
                    [purchaseDb, col.name]
                );
                if (Number(row?.cnt) === 0) {
                    await purchasePool.query(
                        `ALTER TABLE purchase_order_details ADD COLUMN ${col.name} ${col.def}`
                    );
                }
            }
            return true;
        } catch (err) {
            console.error("[MySQL ensurePoWarehouseColumns Error]", err);
            return false;
        }
    },

    async upsertPurchaseOrderDetails(rows) {
        if (!rows.length) return;
        await this.ensureReceivedQtyColumn();
        await this.ensurePoWarehouseColumns();
        const connection = await purchasePool.getConnection();
        try {
            const sql = `
                INSERT INTO purchase_order_details
                (order_nbr, line_nbr, inventory_id, description, qty, received_qty, uom, warehouse_id, branch_id, ext_cost, last_sync)
                VALUES ?
                ON DUPLICATE KEY UPDATE
                inventory_id = VALUES(inventory_id),
                description = VALUES(description),
                qty = VALUES(qty),
                received_qty = VALUES(received_qty),
                uom = VALUES(uom),
                warehouse_id = COALESCE(NULLIF(VALUES(warehouse_id), ''), warehouse_id),
                branch_id = COALESCE(NULLIF(VALUES(branch_id), ''), branch_id),
                ext_cost = VALUES(ext_cost),
                last_sync = VALUES(last_sync)
            `;
            const values = rows.map(r => [
                r.order_nbr,
                r.line_nbr,
                r.inventory_id,
                r.description,
                r.qty,
                r.received_qty ?? 0,
                r.uom,
                r.warehouse_id || r.branch_id || null,
                r.branch_id || r.warehouse_id || null,
                r.ext_cost,
                r.last_sync,
            ]);
            await connection.query(sql, [values]);
        } finally {
            connection.release();
        }
    },

    async upsertVendors(rows) {
        if (!rows.length) return;
        const connection = await purchasePool.getConnection();
        try {
            const sql = `
                INSERT INTO vendors (vendor_id, vendor_name, status, last_sync)
                VALUES ?
                ON DUPLICATE KEY UPDATE
                vendor_name = COALESCE(NULLIF(VALUES(vendor_name), ''), vendor_name),
                status = VALUES(status),
                last_sync = VALUES(last_sync)
            `;
            const values = rows.map(r => [r.vendor_id, r.vendor_name, r.status, r.last_sync]);
            await connection.query(sql, [values]);
        } finally {
            connection.release();
        }
    },

    async getVendorNamesByIds(vendorIds = []) {
        const ids = [...new Set((vendorIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
        if (!ids.length) return {};

        try {
            const placeholders = ids.map(() => "?").join(", ");
            const [rows] = await purchasePool.query(
                `SELECT vendor_id, vendor_name
                 FROM vendors
                 WHERE vendor_id IN (${placeholders})`,
                ids
            );
            return rows.reduce((acc, row) => {
                const name = String(row.vendor_name || "").trim();
                if (name) acc[row.vendor_id] = name;
                return acc;
            }, {});
        } catch (err) {
            console.error("[MySQL getVendorNamesByIds Error]", err);
            return {};
        }
    },

    /**
     * Backfill missing purchase_history.vendor_name from the vendors table.
     */
    async backfillPurchaseHistoryVendorNames() {
        try {
            const [result] = await purchasePool.query(`
                UPDATE purchase_history h
                INNER JOIN vendors v ON v.vendor_id COLLATE utf8mb4_unicode_ci = h.vendor_id
                SET h.vendor_name = v.vendor_name
                WHERE (h.vendor_name IS NULL OR TRIM(h.vendor_name) = '')
                  AND v.vendor_name IS NOT NULL
                  AND TRIM(v.vendor_name) != ''
            `);
            return result?.affectedRows || 0;
        } catch (err) {
            console.error("[MySQL backfillPurchaseHistoryVendorNames Error]", err);
            return 0;
        }
    },

    /**
     * Fetch unique vendors from vendors table
     */
    async getVendors({ page = 1, pageSize = 50, search = "" }) {
        const offset = (page - 1) * pageSize;
        const limitInt = parseInt(pageSize, 10);
        const offsetInt = parseInt(offset, 10);

        try {
            let whereClause = "";
            let params = [];

            if (search) {
                whereClause = "WHERE vendor_id LIKE ? OR vendor_name LIKE ?";
                params = [`%${search}%`, `%${search}%`];
            }

            const [rows] = await purchasePool.query(
                `SELECT 
                    vendor_id as VendorID,
                    vendor_name as VendorName,
                    status as Status,
                    COALESCE(avg_lead_time, 0) as AvgLeadTime,
                    COALESCE(reliability_score, 100.00) as ReliabilityScore
                 FROM vendors
                 ${whereClause}
                 ORDER BY VendorName ASC
                 LIMIT ${limitInt} OFFSET ${offsetInt}`,
                params
            );

            const [[{ total }]] = await purchasePool.query(
                `SELECT COUNT(*) as total FROM vendors ${whereClause}`,
                params
            );

            return {
                data: rows.map(r => ({
                    VendorID: { value: r.VendorID },
                    VendorName: { value: r.VendorName },
                    Status: { value: r.Status },
                    AvgLeadTime: { value: r.AvgLeadTime },
                    ReliabilityScore: { value: r.ReliabilityScore }
                })),
                totalCount: total
            };
        } catch (err) {
            console.error("[MySQL getVendors Error]", err);
            throw err;
        }
    },

    /**
     * Calculate and persist performance metrics for all vendors
     */
    async calculateAndStoreVendorPerformance() {
        try {
            console.log(">>> [MySQL] Calculating Vendor Performance Metrics...");
            
            // 1. Get Lead Times
            const leadTimes = await this.getVendorLeadTimes();
            
            // 2. Get Reliability Scores
            const reliability = await this.getSupplierPerformance();
            
            // 3. Update Vendors table
            const vendorIds = new Set([...Object.keys(leadTimes), ...Object.keys(reliability)]);
            
            for (const vid of vendorIds) {
                const lt = leadTimes[vid]?.days || 0;
                const rs = reliability[vid]?.score ?? null;
                
                await purchasePool.query(
                    `UPDATE vendors SET avg_lead_time = ?, reliability_score = ? WHERE vendor_id = ?`,
                    [lt, rs, vid]
                );
            }
            
            console.log(`>>> [MySQL] Performance calculation complete for ${vendorIds.size} vendors.`);
            return vendorIds.size;
        } catch (err) {
            console.error("[MySQL calculateAndStoreVendorPerformance Error]", err);
            throw err;
        }
    },

    /**
     * Get a map of inventory IDs to their latest vendor IDs
     */
    async getItemVendorMap() {
        try {
            const [rows] = await purchasePool.query(`
                SELECT d.inventory_id, h.vendor_id
                FROM purchase_history h
                JOIN purchase_order_details d ON h.order_nbr COLLATE utf8mb4_unicode_ci = d.order_nbr
                INNER JOIN (
                    SELECT d2.inventory_id, MAX(h2.order_date) as max_date
                    FROM purchase_history h2
                    JOIN purchase_order_details d2 ON h2.order_nbr COLLATE utf8mb4_unicode_ci = d2.order_nbr
                    GROUP BY d2.inventory_id
                ) latest ON d.inventory_id = latest.inventory_id AND h.order_date = latest.max_date
            `);
            const map = new Map();
            rows.forEach(r => map.set(String(r.inventory_id || "").toUpperCase().trim(), r.vendor_id));
            return map;
        } catch (err) {
            console.error("[MySQL getItemVendorMap Error]", err);
            return new Map();
        }
    },

    /**
     * Get the latest vendor for a specific inventory item from purchase history
     */
    async getLatestVendorForItem(inventoryId) {
        try {
            const [rows] = await purchasePool.query(`
                SELECT h.vendor_id
                FROM purchase_history h
                JOIN purchase_order_details d ON h.order_nbr COLLATE utf8mb4_unicode_ci = d.order_nbr
                WHERE d.inventory_id = ?
                ORDER BY h.order_date DESC
                LIMIT 1
            `, [inventoryId]);
            return rows[0]?.vendor_id || null;
        } catch (err) {
            console.error("[MySQL getLatestVendorForItem Error]", err);
            return null;
        }
    },

    /**
     * Calculate average lead times per vendor (Order Date to Receipt Date)
     */
    async getVendorLeadTimes() {
        return getCached("vendorLeadTimes", 60_000, () => this._computeVendorLeadTimes());
    },

    async _computeVendorLeadTimes() {
        try {
            const [rows] = await purchasePool.query(`
                SELECT 
                    vendor_id,
                    AVG(DATEDIFF(receipt_date, order_date)) as avg_lead_time,
                    COUNT(*) as sample_size
                FROM purchase_history
                WHERE status IN ('Closed', 'Completed') 
                  AND order_date IS NOT NULL 
                  AND receipt_date IS NOT NULL
                  AND order_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                GROUP BY vendor_id
            `);
            return rows.reduce((acc, row) => {
                acc[row.vendor_id] = {
                    days: Math.round(row.avg_lead_time) || 0,
                    sample: row.sample_size,
                    source: "actual",
                };
                return acc;
            }, {});
        } catch (err) {
            console.error("[MySQL getVendorLeadTimes Error]", err);
            return {};
        }
    },

    /**
     * Vendor lead times for replenishment — user-entered values from Suppliers take priority over calculated actuals.
     */
    async getEffectiveVendorLeadTimes() {
        const calculated = await this.getVendorLeadTimes();
        const annotations = await this.getAnnotations("supplier");
        const merged = { ...calculated };

        for (const [vendorId, fields] of Object.entries(annotations)) {
            const raw = fields?.leadTime;
            if (raw === undefined || raw === null || raw === "") continue;
            const days = parseInt(String(raw).trim(), 10);
            if (!Number.isNaN(days) && days >= 0) {
                merged[vendorId] = { days, sample: 0, source: "user" };
            }
        }

        return merged;
    },

    /**
     * Open purchase order quantities by inventory ID for one destination warehouse.
     * MAIN Coming PO = lines with warehouse_id MAIN only (not other branches).
     * Branch Coming PO = that branch warehouse only.
     */
    async getOpenPoQtyByItem({ warehouseId = "MAIN" } = {}) {
        try {
            await this.ensureReceivedQtyColumn();
            await this.ensurePoWarehouseColumns();
            const dest = String(warehouseId || "MAIN").trim().toUpperCase() || "MAIN";
            const [rows] = await purchasePool.query(
                `
                SELECT
                    UPPER(TRIM(d.inventory_id)) as inventoryId,
                    COALESCE(SUM(GREATEST(d.qty - COALESCE(d.received_qty, 0), 0)), 0) as openQty
                FROM purchase_order_details d
                INNER JOIN purchase_history h
                    ON h.order_nbr COLLATE utf8mb4_unicode_ci = d.order_nbr
                WHERE UPPER(TRIM(h.status)) IN (
                        'OPEN',
                        'ON HOLD',
                        'HOLD',
                        'BALANCED',
                        'PENDING APPROVAL',
                        'PENDING PRINTING',
                        'PENDING EMAIL'
                    )
                  AND UPPER(TRIM(d.warehouse_id)) = ?
                  AND d.inventory_id IS NOT NULL
                  AND TRIM(d.inventory_id) != ''
                GROUP BY UPPER(TRIM(d.inventory_id))
                `,
                [dest]
            );
            const map = new Map();
            for (const row of rows) {
                const key = String(row.inventoryId || "").toUpperCase().trim();
                if (key) map.set(key, Number(row.openQty) || 0);
            }
            return map;
        } catch (err) {
            console.error("[MySQL getOpenPoQtyByItem Error]", err);
            return new Map();
        }
    },

    /**
     * Get calculated reliability scores for all vendors
     */
    async getSupplierPerformance() {
        return getCached("supplierPerformance", 60_000, () => this._computeSupplierPerformance());
    },

    async _computeSupplierPerformance() {
        try {
            const [rows] = await purchasePool.query(`
                SELECT 
                    vendor_id,
                    COUNT(*) as total_orders,
                    SUM(CASE WHEN receipt_date <= promised_date THEN 1 ELSE 0 END) as on_time_orders,
                    ROUND(
                        (SUM(CASE WHEN receipt_date <= promised_date THEN 1 ELSE 0 END) / COUNT(*)) * 100, 
                        2
                    ) as reliability_score
                FROM purchase_history
                WHERE status IN ('Closed', 'Completed')
                  AND promised_date IS NOT NULL
                  AND receipt_date IS NOT NULL
                  AND order_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                GROUP BY vendor_id
            `);
            return rows.reduce((acc, row) => {
                acc[row.vendor_id] = {
                    score: Number(row.reliability_score),
                    totalOrders: Number(row.total_orders),
                    onTimeOrders: Number(row.on_time_orders)
                };
                return acc;
            }, {});
        } catch (err) {
            console.error("[MySQL getSupplierPerformance Error]", err);
            return {};
        }
    },

    /**
     * Fetch inventory with pagination, search, and branch filtering (for Dashboard)
     */
    async getInventory({ page = 1, pageSize = 50, search = "", branch = "", filter = "", companyId = "main" }) {
        const offset = (page - 1) * pageSize;
        const purchaseDb = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
        const effectiveCompanyId = resolveCompanyIdForBranch(companyId, branch);

        if (branch && isExcludedBranchAlias(branch)) {
            return { data: [], totalCount: 0, hasMore: false };
        }

        try {
            await this.ensureInventoryPlanningColumns();
            const layout = await resolveInventoryLayout(effectiveCompanyId);
            const hasWarehouse = layout === "warehouse";
            const queryLayout = hasWarehouse ? "warehouse" : "catalog";

            if ((branch || filter) && !hasWarehouse) {
                return { data: [], totalCount: 0, hasMore: false, dataMode: "warehouse-missing" };
            }

            let whereClauses = ["i.company_id = ?"];
            let params = [effectiveCompanyId];

            if (queryLayout === "warehouse") {
                whereClauses.push("i.default_warehouse IS NOT NULL", "i.default_warehouse != '__catalog__'");
            } else if (queryLayout === "catalog") {
                whereClauses.push("i.default_warehouse = '__catalog__'");
            } else {
                whereClauses.push("i.default_warehouse IS NOT NULL");
            }

            const branchEx = sqlExcludeBranches("i");
            whereClauses.push(branchEx.clause);
            params.push(...branchEx.params);

            if (branch && queryLayout === "warehouse") {
                whereClauses.push("UPPER(TRIM(i.branch_id)) = UPPER(TRIM(?))");
                params.push(branch);
            }

            if (effectiveCompanyId === "main") {
                const ecomEx = sqlExcludeEcomBranches("i");
                whereClauses.push(ecomEx.clause);
                params.push(...ecomEx.params);
            } else if (effectiveCompanyId === "ecommerce") {
                const ecomOnly = sqlOnlyEcomBranches("i");
                whereClauses.push(ecomOnly.clause);
                params.push(...ecomOnly.params);
            }

            if (search) {
                if (queryLayout === "warehouse") {
                    whereClauses.push("(i.inventory_id LIKE ? OR COALESCE(c.inventory_name, i.inventory_name) LIKE ?)");
                } else {
                    whereClauses.push("(i.inventory_id LIKE ? OR i.inventory_name LIKE ?)");
                }
                params.push(`%${search}%`, `%${search}%`);
            }

            if (filter === "low_stock") {
                whereClauses.push("i.on_hand > 0 AND i.on_hand < 10");
            } else if (filter === "out_of_stock") {
                whereClauses.push("i.on_hand <= 0");
            } else if (filter === "dead_stock") {
                whereClauses.push("i.on_hand > 0 AND COALESCE(s.total_qty, 0) <= 0");
            } else if (filter === "overstock") {
                whereClauses.push("i.on_hand > (COALESCE(s.total_qty, 0) * 2) AND COALESCE(s.total_qty, 0) > 0");
            }

            const wherePart = `WHERE ${whereClauses.join(" AND ")}`;

            const limitInt = parseInt(pageSize, 10);
            const offsetInt = parseInt(offset, 10);

            const needsSalesJoin = filter === "dead_stock" || filter === "overstock";
            const salesEx = needsSalesJoin ? sqlExcludeSalesBranches("branch_name") : null;
            const salesParams = needsSalesJoin ? [...salesEx.params] : [];
            const salesJoin = needsSalesJoin
                ? `LEFT JOIN ${netSalesQtySubquery(purchaseDb, salesEx)} s ON i.inventory_id = s.inventory_id`
                : "";
            const qtySoldSelect = needsSalesJoin ? "COALESCE(s.total_qty, 0) as QtySold" : "0 as QtySold";

            const fromClause = inventoryFromClause(queryLayout);
            const selectCols = inventorySelectCols(queryLayout);

            const query = `
                SELECT 
                    ${selectCols},
                    ${qtySoldSelect}
                 ${fromClause}
                 ${salesJoin}
                 ${wherePart} 
                 ORDER BY i.inventory_id ASC 
                 LIMIT ${limitInt} OFFSET ${offsetInt}`;

            const [rows] = await pool.query(query, [...salesParams, ...params]);

            const [[{ total }]] = await pool.query(
                `SELECT COUNT(*) as total 
                 ${fromClause}
                 ${salesJoin}
                 ${wherePart}`,
                [...salesParams, ...params]
            );

            // Transform rows to match the BFF structure (objects with .value)
            const transformed = rows.map(item => {
                const onHand = Number(item.OnHand);
                const onHandVal = Number.isFinite(onHand) ? onHand : 0;
                let available = item.Available == null || item.Available === ""
                    ? NaN
                    : Number(item.Available);
                if (!Number.isFinite(available)) available = onHandVal;
                return {
                    InventoryID: { value: item.InventoryID },
                    Description: { value: item.Description || "—" },
                    SiteID: { value: item.SiteID },
                    Branch: { value: item.Branch },
                    OnHand: { value: onHandVal },
                    Available: { value: available },
                    DefaultPrice: { value: item.DefaultPrice || 0 },
                    ItemClass: { value: item.ItemClass || "" },
                    VendorID: { value: item.VendorID || "" },
                    LeadTimeDays: { value: item.LeadTimeDays },
                    SafetyStock: { value: item.SafetyStock },
                    MOQ: { value: item.MOQ },
                    QtySold: { value: item.QtySold }
                };
            });

            if (total === 0 && !branch && !filter && layout === "catalog-empty") {
                const catalog = await this.getInventoryFromCatalog({
                    page,
                    pageSize,
                    search,
                    companyId: effectiveCompanyId,
                    offset,
                    purchaseDb,
                });
                if (catalog.totalCount > 0) return catalog;
            }

            return {
                data: transformed,
                totalCount: total,
                hasMore: total > offset + pageSize,
                dataMode: queryLayout === "catalog" && layout === "warehouse" ? "catalog" : layout,
            };
        } catch (err) {
            console.error("[MySQL getInventory Error]", err);
            throw err;
        }
    },

    /**
     * List products from catalog rows when warehouse levels have not been synced yet.
     */
    async getInventoryFromCatalog({ page, pageSize, search, companyId, offset, purchaseDb }) {
        await this.ensureInventoryPlanningColumns();

        const limitInt = parseInt(pageSize, 10);
        const offsetInt = parseInt(offset, 10);
        const whereParts = ["i.company_id = ?", "i.default_warehouse = '__catalog__'"];
        const params = [companyId];

        if (search) {
            whereParts.push("(i.inventory_id LIKE ? OR i.inventory_name LIKE ?)");
            params.push(`%${search}%`, `%${search}%`);
        }

        const wherePart = `WHERE ${whereParts.join(" AND ")}`;
        const salesEx = sqlExcludeSalesBranches("branch_name");
        const salesParams = [...salesEx.params];
        const db = purchaseDb || process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";

        const query = `
            SELECT
                i.inventory_id as InventoryID,
                i.inventory_name as Description,
                i.item_class as ItemClass,
                i.branch_id as Branch,
                i.site_id as SiteID,
                COALESCE(i.on_hand, 0) as OnHand,
                COALESCE(i.available, i.on_hand, 0) as Available,
                i.default_price as DefaultPrice,
                i.vendor_id as VendorID,
                i.lead_time_days as LeadTimeDays,
                i.safety_stock as SafetyStock,
                i.moq as MOQ,
                COALESCE(s.total_qty, 0) as QtySold
             FROM inventory_items i
             LEFT JOIN ${netSalesQtySubquery(db, salesEx)} s ON i.inventory_id = s.inventory_id
             ${wherePart}
             ORDER BY i.inventory_id ASC
             LIMIT ${limitInt} OFFSET ${offsetInt}`;

        const [rows] = await pool.query(query, [...salesParams, ...params]);
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM inventory_items i ${wherePart}`,
            params
        );

        const transformed = rows.map((item) => {
            const onHand = Number(item.OnHand);
            const onHandVal = Number.isFinite(onHand) ? onHand : 0;
            let available = item.Available == null || item.Available === ""
                ? NaN
                : Number(item.Available);
            if (!Number.isFinite(available)) available = onHandVal;
            return {
                InventoryID: { value: item.InventoryID },
                Description: { value: item.Description || "—" },
                SiteID: { value: item.SiteID },
                Branch: { value: item.Branch },
                OnHand: { value: onHandVal },
                Available: { value: available },
                DefaultPrice: { value: item.DefaultPrice || 0 },
                ItemClass: { value: item.ItemClass || "" },
                VendorID: { value: item.VendorID || "" },
                LeadTimeDays: { value: item.LeadTimeDays },
                SafetyStock: { value: item.SafetyStock },
                MOQ: { value: item.MOQ },
                QtySold: { value: item.QtySold },
            };
        });

        return {
            data: transformed,
            totalCount: total,
            hasMore: total > offsetInt + pageSize,
            dataMode: "catalog",
        };
    },

    /**
     * Calculate global stats (Total Value, Low Stock, Dead Stock, Overstock, etc.)
     */
    async getGlobalStats(branch = "", search = "", companyId = "main") {
        const cacheKey = `global-stats:${companyId}:${branch}:${search}`;
        return getCached(cacheKey, 120_000, () => this._computeGlobalStats(branch, search, companyId));
    },

    async _computeGlobalStats(branch = "", search = "", companyId = "main") {
        try {
            const purchaseDb = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
            const effectiveCompanyId = resolveCompanyIdForBranch(companyId, branch);

            if (branch && isExcludedBranchAlias(branch)) {
                return { ...EMPTY_GLOBAL_STATS };
            }

            const warehouseRows = await countWarehouseRows(effectiveCompanyId);
            if (warehouseRows === 0) {
                return {
                    ...EMPTY_GLOBAL_STATS,
                    lastSync: await this.getLastInventorySyncTime(),
                    dataMode: "warehouse-missing",
                };
            }

            let whereClauses = [
                "i.company_id = ?",
                "i.default_warehouse IS NOT NULL",
                "i.default_warehouse != '__catalog__'",
            ];
            let params = [effectiveCompanyId];

            const branchEx = sqlExcludeBranches("i");
            whereClauses.push(branchEx.clause);
            params.push(...branchEx.params);

            if (branch) {
                whereClauses.push("UPPER(TRIM(i.branch_id)) = UPPER(TRIM(?))");
                params.push(branch);
            }

            if (effectiveCompanyId === "main") {
                const ecomEx = sqlExcludeEcomBranches("i");
                whereClauses.push(ecomEx.clause);
                params.push(...ecomEx.params);
            } else if (effectiveCompanyId === "ecommerce") {
                const ecomOnly = sqlOnlyEcomBranches("i");
                whereClauses.push(ecomOnly.clause);
                params.push(...ecomOnly.params);
            }

            if (search) {
                whereClauses.push("(i.inventory_id LIKE ? OR COALESCE(c.inventory_name, i.inventory_name) LIKE ?)");
                params.push(`%${search}%`, `%${search}%`);
            }

            const wherePart = `WHERE ${whereClauses.join(" AND ")}`;

            const salesEx = sqlExcludeSalesBranches("branch_name");
            const salesParams = branch
                ? [...salesEx.params, branch]
                : [...salesEx.params];

            const fromClause = inventoryFromClause("warehouse");
            const priceExpr = "COALESCE(c.default_price, i.default_price, 0)";

            const query = `
                SELECT
                    COUNT(DISTINCT i.inventory_id) as totalProducts,
                    SUM(COALESCE(i.on_hand, 0)) as totalStock,
                    SUM(COALESCE(i.on_hand, 0) * ${priceExpr}) as totalValue,
                    SUM(CASE WHEN i.on_hand > 0 AND i.on_hand < 10 THEN 1 ELSE 0 END) as lowStockCount,
                    SUM(CASE WHEN i.on_hand > 0 AND i.on_hand < 10 THEN i.on_hand ELSE 0 END) as totalLowStock,
                    SUM(CASE WHEN i.on_hand <= 0 THEN 1 ELSE 0 END) as outOfStockCount,
                    SUM(CASE WHEN i.on_hand > 0 AND COALESCE(s.total_qty, 0) <= 0 THEN 1 ELSE 0 END) as deadStockCount,
                    SUM(CASE WHEN i.on_hand > (COALESCE(s.total_qty, 0) * 2) AND COALESCE(s.total_qty, 0) > 0 THEN 1 ELSE 0 END) as overstockCount,
                    MAX(i.last_sync) as lastSync
                 ${fromClause}
                 LEFT JOIN ${netSalesQtySubquery(purchaseDb, salesEx, branch)} s ON i.inventory_id = s.inventory_id
                 ${wherePart}`;

            const [[stats]] = await pool.query(query, [...salesParams, ...params]);

            const totalProducts = Number(stats.totalProducts) || 0;

            return {
                totalStock: Number(stats.totalStock) || 0,
                totalValue: Number(stats.totalValue) || 0,
                lowStock: Number(stats.lowStockCount) || 0,
                totalLowStock: Number(stats.totalLowStock) || 0,
                outOfStock: Number(stats.outOfStockCount) || 0,
                deadStock: Number(stats.deadStockCount) || 0,
                overstock: Number(stats.overstockCount) || 0,
                count: totalProducts,
                lastSync: stats.lastSync || await this.getLastInventorySyncTime(),
                dataMode: "warehouse",
            };
        } catch (err) {
            console.error("[MySQL getGlobalStats Error]", err);
            throw err;
        }
    },

    /**
     * Planning KPIs for the inventory dashboard (supplier, lead time, MOQ gaps).
     * Branch filter applies only when warehouse rows exist; catalog mode is company-wide.
     */
    async getPlanningStats(branch = "", search = "", companyId = "main") {
        try {
            const layout = await resolveInventoryLayout(companyId);
            let whereClauses = ["i.company_id = ?", "i.default_warehouse = '__catalog__'"];
            const params = [companyId];

            if (search) {
                whereClauses.push("(i.inventory_id LIKE ? OR i.inventory_name LIKE ?)");
                params.push(`%${search}%`, `%${search}%`);
            }

            if (layout === "warehouse" && branch) {
                whereClauses.push(
                    `EXISTS (
                        SELECT 1 FROM inventory_items w
                        WHERE w.company_id = i.company_id
                          AND w.inventory_id = i.inventory_id
                          AND w.default_warehouse != '__catalog__'
                          AND w.branch_id = ?
                    )`
                );
                params.push(branch);
            }

            const wherePart = `WHERE ${whereClauses.join(" AND ")}`;
            const [rows] = await pool.query(
                `SELECT TRIM(i.inventory_id) AS inventory_id
                 FROM inventory_items i
                 ${wherePart}`,
                params
            );

            const vendorMap = await this.getItemVendorMap();
            const leadTimeMap = await this.getVendorLeadTimes();
            const ids = rows.map((r) => String(r.inventory_id || "").toUpperCase().trim()).filter(Boolean);

            let withSupplier = 0;
            let withLeadTime = 0;
            for (const id of ids) {
                const supplierId = vendorMap.get(id);
                if (!supplierId) continue;
                withSupplier += 1;
                if ((leadTimeMap[supplierId]?.days || 0) > 0) withLeadTime += 1;
            }

            const totalProducts = ids.length;
            const lastSync = await this.getLastInventorySyncTime();

            return {
                totalProducts,
                withSupplier,
                withLeadTime,
                missingSafetyStock: totalProducts,
                missingMoq: totalProducts,
                lastSync,
                dataMode: layout,
                branchScoped: layout === "warehouse" && !!branch,
            };
        } catch (err) {
            console.error("[MySQL getPlanningStats Error]", err);
            throw err;
        }
    },

    /**
     * Fetch stock items from MySQL database (one row per unique inventory_id)
     * Enriched with total sales and quantity sold.
     */
    async getStockItems({ page = 1, pageSize = 50, search = "", branch = "", companyId = "main" } = {}) {
        const offset = (page - 1) * pageSize;
        const limitInt = parseInt(pageSize, 10);
        const offsetInt = parseInt(offset, 10);
        const effectiveCompanyId = resolveCompanyIdForBranch(companyId, branch);

        if (branch && branch !== "All Branches" && isExcludedBranchAlias(branch)) {
            return { items: [], totalCount: 0, totalStock: 0 };
        }

        try {
            const whereParts = ["i.company_id = ?"];
            const params = [effectiveCompanyId];

            const branchEx = sqlExcludeBranches("i");
            whereParts.push(branchEx.clause);
            params.push(...branchEx.params);

            if (search) {
                whereParts.push("(i.inventory_id LIKE ? OR i.inventory_name LIKE ?)");
                params.push(`%${search}%`, `%${search}%`);
            }
            if (branch && branch !== "All Branches") {
                whereParts.push("i.default_warehouse != '__catalog__'");
                whereParts.push("i.branch_id IS NOT NULL AND TRIM(i.branch_id) != ''");
                whereParts.push("UPPER(TRIM(i.branch_id)) = UPPER(TRIM(?))");
                params.push(branch);
            } else {
                whereParts.push("i.default_warehouse != '__catalog__'");
            }

            if (effectiveCompanyId === "main") {
                const ecomEx = sqlExcludeEcomBranches("i");
                whereParts.push(ecomEx.clause);
                params.push(...ecomEx.params);
            } else if (effectiveCompanyId === "ecommerce") {
                const ecomOnly = sqlOnlyEcomBranches("i");
                whereParts.push(ecomOnly.clause);
                params.push(...ecomOnly.params);
            }

            const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

            const query = `
                SELECT 
                    TRIM(i.inventory_id) as inventoryId, 
                    MAX(i.inventory_name) as description, 
                    MAX(i.item_class) as itemClass, 
                    MAX(i.item_status) as itemStatus,
                    MAX(i.base_unit) as baseUnit,
                    MAX(i.default_price) as price,
                    MAX(i.moq) as moq,
                    SUM(CASE WHEN i.default_warehouse != '__catalog__' THEN COALESCE(i.on_hand, 0) ELSE 0 END) as totalOnHand,
                    GROUP_CONCAT(DISTINCT CASE WHEN i.default_warehouse != '__catalog__' AND i.on_hand > 0 THEN i.branch_id END SEPARATOR ', ') as branches
                 FROM inventory_items i
                 ${whereClause} 
                 GROUP BY TRIM(i.inventory_id)
                 ORDER BY i.inventory_id ASC 
                 LIMIT ${limitInt} OFFSET ${offsetInt}`;

            const [[rows], [[{ total, overallStock }]]] = await Promise.all([
                pool.query(query, params),
                pool.query(
                    `SELECT 
                        COUNT(DISTINCT TRIM(i.inventory_id)) as total,
                        SUM(CASE WHEN i.default_warehouse != '__catalog__' THEN COALESCE(i.on_hand, 0) ELSE 0 END) as overallStock
                     FROM inventory_items i ${whereClause}`,
                    params
                ),
            ]);

            const pageIds = rows.map((r) => r.inventoryId);
            const [salesMap, dimSet] = await Promise.all([
                this.getPeriodicSalesSummaryForIds({ ids: pageIds, branch }),
                this.getDimensionIdSet(pageIds),
            ]);

            const enriched = rows.map(r => {
                const key = (r.inventoryId || "").toUpperCase().trim();
                const sales = salesMap.get(key) || { qty_sold: 0, total_sales: 0 };
                return {
                    ...r,
                    totalOnHand: Number(r.totalOnHand) || 0,
                    totalQtySold: sales.qty_sold,
                    totalSales: sales.total_sales
                };
            });

            const withDims = enriched.map((r) => ({
                ...r,
                hasDimensions: dimSet.has((r.inventoryId || "").toUpperCase().trim()),
            }));

            if (total === 0 && !branch) {
                const warehouseRows = await countWarehouseRows(effectiveCompanyId);
                if (warehouseRows === 0) {
                    const catalog = await this.getStockItemsFromCatalog({
                        page,
                        pageSize,
                        search,
                        companyId: effectiveCompanyId,
                        offset,
                    });
                    if (catalog.totalCount > 0) return catalog;
                }
            }

            return {
                items: withDims,
                totalCount: total,
                totalStock: Number(overallStock) || 0
            };
        } catch (err) {
            console.error("[MySQL getStockItems Error]", err);
            throw err;
        }
    },

    /**
     * Stock items masterlist from catalog when warehouse levels are not synced yet.
     */
    async getStockItemsFromCatalog({ page, pageSize, search, companyId, offset }) {
        const limitInt = parseInt(pageSize, 10);
        const offsetInt = parseInt(offset, 10);
        const whereParts = ["i.company_id = ?", "i.default_warehouse = '__catalog__'"];
        const params = [companyId];

        if (search) {
            whereParts.push("(i.inventory_id LIKE ? OR i.inventory_name LIKE ?)");
            params.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = `WHERE ${whereParts.join(" AND ")}`;
        const query = `
            SELECT
                TRIM(i.inventory_id) as inventoryId,
                i.inventory_name as description,
                i.item_class as itemClass,
                i.item_status as itemStatus,
                i.base_unit as baseUnit,
                i.default_price as price,
                i.moq as moq,
                0 as totalOnHand,
                '' as branches
             FROM inventory_items i
             ${whereClause}
             ORDER BY i.inventory_id ASC
             LIMIT ${limitInt} OFFSET ${offsetInt}`;

        const [rows] = await pool.query(query, params);
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM inventory_items i ${whereClause}`,
            params
        );

        const pageIds = rows.map((r) => r.inventoryId);
        const [salesMap, dimSet] = await Promise.all([
            this.getPeriodicSalesSummaryForIds({ ids: pageIds }),
            this.getDimensionIdSet(pageIds),
        ]);
        const enriched = rows.map((r) => {
            const key = (r.inventoryId || "").toUpperCase().trim();
            const sales = salesMap.get(key) || { qty_sold: 0, total_sales: 0 };
            return {
                ...r,
                totalOnHand: 0,
                totalQtySold: sales.qty_sold,
                totalSales: sales.total_sales,
            };
        });

        const withDims = enriched.map((r) => ({
            ...r,
            hasDimensions: dimSet.has((r.inventoryId || "").toUpperCase().trim()),
        }));

        return {
            items: withDims,
            totalCount: total,
            totalStock: 0,
            dataMode: "catalog",
        };
    },

    /**
     * Retail replenishment branch picker — inventory sites + sales branch names.
     */
    async getReplenishmentBranches(companyId = "main") {
        try {
            const invBranches = await this.getBranches(companyId);
            const branchIds = new Set(["MAIN"]);
            for (const b of invBranches) {
                if (b.SiteID) branchIds.add(String(b.SiteID).trim());
            }

            return [...branchIds]
                .sort((a, b) => (a === "MAIN" ? -1 : b === "MAIN" ? 1 : a.localeCompare(b)))
                .map((id) => ({ SiteID: id, Description: { value: id } }));
        } catch (err) {
            console.error("[MySQL getReplenishmentBranches Error]", err);
            const fallback = await this.getBranches(companyId);
            return fallback.length ? fallback : [{ SiteID: "MAIN", Description: { value: "MAIN" } }];
        }
    },

    /**
     * Branch-accurate stock + sales for replenishment analysis.
     * Uses branch_id (site/branch location), not default_warehouse (physical warehouse).
     */
    async getReplenishmentItems({ branch = "MAIN", companyId = "main", salesMap = null } = {}) {
        if (isExcludedBranchAlias(branch)) {
            return [];
        }

        try {
            const isMainWarehouse = String(branch).trim().toUpperCase() === "MAIN";
            const effectiveCompanyId = resolveCompanyIdForBranch(companyId, branch);
            const isEcomBranch = isEcomBranchAlias(branch);

            const resolvedSales =
                salesMap ??
                (await this.getPeriodicSalesSummary({
                    branch: isMainWarehouse ? "" : branch,
                }));

            const whereClauses = [
                "i.default_warehouse != '__catalog__'",
                "i.branch_id IS NOT NULL",
                "TRIM(i.branch_id) != ''",
                "(i.item_status IS NULL OR UPPER(TRIM(i.item_status)) = 'ACTIVE')",
            ];
            const params = [];

            if (isEcomBranch) {
                const ecomAliases = [...ECOM_BRANCH_ALIASES];
                whereClauses.push(
                    `UPPER(TRIM(i.branch_id)) IN (${ecomAliases.map(() => "?").join(", ")})`
                );
                params.push(...ecomAliases);
                whereClauses.push(
                    `(i.company_id = 'ecommerce' OR (i.company_id = 'main' AND UPPER(TRIM(i.branch_id)) IN (${ecomAliases.map(() => "?").join(", ")})))`
                );
                params.push(...ecomAliases);
            } else {
                whereClauses.push("UPPER(TRIM(i.branch_id)) = UPPER(TRIM(?))");
                params.push(branch);
                whereClauses.push("i.company_id = ?");
                params.push(effectiveCompanyId);

                const branchEx = sqlExcludeBranches("i");
                whereClauses.push(branchEx.clause);
                params.push(...branchEx.params);

                if (effectiveCompanyId === "main") {
                    const ecomEx = sqlExcludeEcomBranches("i");
                    whereClauses.push(ecomEx.clause);
                    params.push(...ecomEx.params);
                } else if (effectiveCompanyId === "ecommerce") {
                    const ecomOnly = sqlOnlyEcomBranches("i");
                    whereClauses.push(ecomOnly.clause);
                    params.push(...ecomOnly.params);
                }
            }

            const [rows] = await pool.query(
                `SELECT
                    TRIM(i.inventory_id) as inventoryId,
                    MAX(i.inventory_name) as description,
                    MAX(i.item_status) as itemStatus,
                    MAX(i.item_class) as itemClass,
                    COALESCE(SUM(i.on_hand), 0) as totalOnHand,
                    COALESCE(SUM(i.available), 0) as totalAvailable
                 FROM inventory_items i
                 WHERE ${whereClauses.join(" AND ")}
                 GROUP BY TRIM(i.inventory_id)
                 ORDER BY TRIM(i.inventory_id) ASC`,
                params
            );

            const itemMap = new Map();
            for (const r of rows) {
                const key = (r.inventoryId || "").toUpperCase().trim();
                if (!key) continue;
                const sales = resolvedSales.get(key) || { qty_sold: 0, total_sales: 0 };
                const onHand = Number(r.totalOnHand) || 0;
                const available = Number(r.totalAvailable) || 0;
                const usableStock = available > 0 ? available : onHand;
                itemMap.set(key, {
                    ...r,
                    totalOnHand: usableStock,
                    totalAvailable: available,
                    totalQtySold: sales.qty_sold,
                    totalSales: sales.total_sales,
                    salesScope: isMainWarehouse ? "network" : "branch",
                });
            }

            // Include items with branch sales but no on-hand stock at this branch (stockout risk).
            const missingSalesKeys = [];
            for (const [key, sales] of resolvedSales) {
                if (!itemMap.has(key) && sales.qty_sold > 0) missingSalesKeys.push(key);
            }
            if (missingSalesKeys.length > 0) {
                const placeholders = missingSalesKeys.map(() => "?").join(", ");
                const catalogCompanyId = isEcomBranch ? "ecommerce" : effectiveCompanyId;
                const [catalogRows] = await pool.query(
                    `SELECT TRIM(inventory_id) AS inventoryId, inventory_name AS description, item_class AS itemClass
                     FROM inventory_items
                     WHERE company_id = ? AND default_warehouse = '__catalog__'
                       AND UPPER(TRIM(inventory_id)) IN (${placeholders})`,
                    [catalogCompanyId, ...missingSalesKeys]
                );
                for (const cat of catalogRows) {
                    const key = (cat.inventoryId || "").toUpperCase().trim();
                    const sales = resolvedSales.get(key) || { qty_sold: 0, total_sales: 0 };
                    itemMap.set(key, {
                        inventoryId: cat.inventoryId,
                        description: cat.description,
                        itemStatus: "ACTIVE",
                        itemClass: cat.itemClass,
                        totalOnHand: 0,
                        totalAvailable: 0,
                        totalQtySold: sales.qty_sold,
                        totalSales: sales.total_sales,
                        salesScope: isMainWarehouse ? "network" : "branch",
                    });
                }
            }

            return [...itemMap.values()];
        } catch (err) {
            console.error("[MySQL getReplenishmentItems Error]", err);
            throw err;
        }
    },

    /**
     * Fetch catalog metadata for a list of inventory IDs (uppercase keys).
     */
    async getCatalogItemsByIds(itemIds = [], companyId = "main") {
        const keys = [...new Set(
            (itemIds || [])
                .map((id) => String(id || "").toUpperCase().trim())
                .filter(Boolean)
        )];
        if (!keys.length) return [];

        try {
            const placeholders = keys.map(() => "?").join(", ");
            const [rows] = await pool.query(
                `SELECT TRIM(inventory_id) AS inventoryId, inventory_name AS description, item_class AS itemClass
                 FROM inventory_items
                 WHERE company_id = ? AND default_warehouse = '__catalog__'
                   AND UPPER(TRIM(inventory_id)) IN (${placeholders})`,
                [companyId, ...keys]
            );
            return rows;
        } catch (err) {
            console.error("[MySQL getCatalogItemsByIds Error]", err);
            return [];
        }
    },

    /**
     * Fetch stock item detail from MySQL including all warehouse locations
     */
    async getStockItemDetail(inventoryId, companyId = "main") {
        try {
            const [rows] = await pool.execute(
                `SELECT 
                    TRIM(inventory_id) as inventoryId, 
                    inventory_name as description, 
                    item_class as itemClass, 
                    default_warehouse as branch, 
                    default_price as price,
                    item_status as itemStatus,
                    base_unit as baseUnit,
                    type,
                    posting_class as postingClass,
                    branch_id as branchId,
                    site_id as siteId,
                    on_hand as onHand,
                    available as available,
                    last_sync as lastSync,
                    company_id as companyId
                 FROM inventory_items 
                 WHERE TRIM(UPPER(inventory_id)) = TRIM(UPPER(?))
                 AND company_id = ?
                 AND default_warehouse != '__catalog__'`,
                [inventoryId, companyId]
            );

            if (rows.length === 0) return null;

            // Use the first row for shared metadata
            const first = rows[0];
            
            // Map all rows to branch details
            const branches = rows.map(r => ({
                branchId: r.branchId || r.siteId,
                siteId: r.siteId,
                onHand: Number(r.onHand) || 0,
                available: Number(r.available) || 0,
                updatedAt: r.lastSync
            })).filter(b => b.branchId && !isExcludedBranchAlias(b.branchId) && (
                companyId === "ecommerce"
                    ? isEcomBranchAlias(b.branchId)
                    : !isEcomBranchAlias(b.branchId)
            ));

            const totalOnHand = branches.reduce((sum, b) => sum + b.onHand, 0);
            const totalAvailable = branches.reduce((sum, b) => sum + b.available, 0);

            return {
                inventoryId: first.inventoryId,
                description: first.description || "—",
                itemClass: first.itemClass || "—",
                unitPrice: first.price || 0,
                itemStatus: first.itemStatus || "—",
                baseUnit: first.baseUnit || "—",
                type: first.type || "—",
                postingClass: first.postingClass || "—",
                defaultWarehouse: first.branch || "—",
                companyId: first.companyId || companyId,
                totalOnHand,
                totalAvailable,
                lastSync: first.lastSync,
                branches
            };
        } catch (err) {
            console.error("[MySQL getStockItemDetail Error]", err);
            return null;
        }
    },

    /**
     * Fetch unique branches from MySQL
     */
    async getBranches(companyId = "main") {
        try {
            const branchEx = sqlExcludeBranches("inventory_items");
            let query;
            let params;

            if (companyId === "ecommerce") {
                const ecomOnly = sqlOnlyEcomBranches("inventory_items");
                query = `SELECT DISTINCT branch_id FROM inventory_items
                         WHERE company_id = 'ecommerce'
                           AND branch_id IS NOT NULL AND branch_id != '' AND branch_id != '__catalog__'
                           AND ${ecomOnly.clause}
                           AND ${branchEx.clause}
                         ORDER BY branch_id ASC`;
                params = [...ecomOnly.params, ...branchEx.params];
            } else {
                query = `SELECT DISTINCT branch_id FROM inventory_items
                         WHERE company_id IN ('main', 'ecommerce')
                           AND branch_id IS NOT NULL AND branch_id != '' AND branch_id != '__catalog__'
                           AND ${branchEx.clause}
                         ORDER BY branch_id ASC`;
                params = [...branchEx.params];
            }

            const [rows] = await pool.execute(query, params);

            return rows.map(r => ({
                SiteID: r.branch_id,
                Description: { value: r.branch_id }
            }));
        } catch (err) {
            console.error("[MySQL getBranches Error]", err);
            return [];
        }
    },

    /** Move ecommerce branch rows from main company into ecommerce company bucket. */
    async cleanupMisclassifiedEcomBranches() {
        try {
            const branches = [...ECOM_BRANCH_ALIASES];
            const [result] = await pool.query(
                `UPDATE inventory_items SET company_id = 'ecommerce'
                 WHERE company_id = 'main'
                   AND default_warehouse != '__catalog__'
                   AND UPPER(TRIM(branch_id)) IN (${branches.map(() => "?").join(", ")})`,
                branches
            );
            return result.affectedRows || 0;
        } catch (err) {
            console.error("[MySQL cleanupMisclassifiedEcomBranches Error]", err);
            return 0;
        }
    },

    /**
     * Fetch product catalog (id, class, description) for mapping
     */
    async getProductCatalog() {
        try {
            const [rows] = await pool.execute(
                `SELECT DISTINCT inventory_id, item_class, inventory_name as description FROM inventory_items`
            );
            return rows;
        } catch (err) {
            console.error("[MySQL getProductCatalog Error]", err);
            return [];
        }
    },

    /**
     * Get overall stock sum, optionally filtered by branch
     */
    async getOverallStocks(branch = "") {
        try {
            let whereClause = "default_warehouse != '__catalog__'";
            let params = [];
            if (branch) {
                whereClause += " AND branch_id = ?";
                params.push(branch);
            }
            const [[{ total }]] = await pool.query(
                `SELECT SUM(COALESCE(on_hand, 0)) as total FROM inventory_items WHERE ${whereClause}`,
                params
            );
            return Number(total) || 0;
        } catch (err) {
            console.error("[MySQL getOverallStocks Error]", err);
            return 0;
        }
    },

    /**
     * Bulk upsert branches
     */
    async upsertBranches(branches) {
        if (!branches.length) return;
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            for (const b of branches) {
                await connection.execute(
                    `INSERT INTO branches (branch_id, branch_name, active) 
                     VALUES (?, ?, ?) 
                     ON DUPLICATE KEY UPDATE branch_name = VALUES(branch_name), active = VALUES(active)`,
                    [b.branch_id, b.branch_name, b.active ? 1 : 0]
                );
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            console.error("[MySQL upsertBranches Error]", err);
            throw err;
        } finally {
            connection.release();
        }
    },

    async ensureInventoryPlanningColumns() {
        if (MySqlService._planningColsReady) return true;

        const inventoryDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
        const cols = [
            { name: "vendor_id", def: "VARCHAR(100) NULL" },
            { name: "lead_time_days", def: "INT NULL" },
            { name: "safety_stock", def: "DECIMAL(18,4) NULL" },
            { name: "moq", def: "DECIMAL(18,4) NULL" },
        ];
        try {
            for (const c of cols) {
                const [[row]] = await pool.query(
                    `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA=? AND TABLE_NAME='inventory_items' AND COLUMN_NAME=?`,
                    [inventoryDb, c.name]
                );
                if (row.cnt === 0) {
                    await pool.query(`ALTER TABLE inventory_items ADD COLUMN \`${c.name}\` ${c.def}`);
                }
            }
            MySqlService._planningColsReady = true;
            return true;
        } catch (err) {
            console.error("[MySQL ensureInventoryPlanningColumns Error]", err);
            return false;
        }
    },
    _planningColsReady: false,

    /**
     * Bulk-update catalog fields on existing inventory_items rows.
     */
    async upsertInventoryItems(items, companyId = "main") {
        if (!items.length) return;
        await this.ensureInventoryPlanningColumns();
        const CHUNK = 200;
        const now = new Date();
        const safeNum = (v) => { const n = Number(v); return (isNaN(n) ? null : n); };
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            for (let i = 0; i < items.length; i += CHUNK) {
                const chunk = items.slice(i, i + CHUNK);
                const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
                const values = chunk.flatMap(item => [
                    String(item.inventory_id || "").trim(),
                    companyId,
                    '__catalog__',
                    item.description,
                    item.item_class,
                    safeNum(item.default_price),
                    item.item_status || 'active',
                    item.base_unit || '',
                    item.item_type || '',
                    item.posting_class || '',
                    item.vendor_id || null,
                    item.lead_time_days != null ? parseInt(item.lead_time_days, 10) : null,
                    safeNum(item.safety_stock),
                    safeNum(item.moq),
                    now,
                ]);
                await connection.query(
                    `INSERT INTO inventory_items
                        (inventory_id, company_id, default_warehouse, inventory_name, item_class,
                        default_price, item_status, base_unit, type, posting_class,
                        vendor_id, lead_time_days, safety_stock, moq, last_sync)
                    VALUES ${placeholders}
                    ON DUPLICATE KEY UPDATE
                        inventory_name = VALUES(inventory_name),
                        item_class     = VALUES(item_class),
                        default_price  = VALUES(default_price),
                        item_status    = VALUES(item_status),
                        base_unit      = VALUES(base_unit),
                        type           = COALESCE(NULLIF(VALUES(type),''), type),
                        posting_class  = COALESCE(NULLIF(VALUES(posting_class),''), posting_class),
                        vendor_id      = COALESCE(NULLIF(VALUES(vendor_id),''), vendor_id),
                        lead_time_days = COALESCE(VALUES(lead_time_days), lead_time_days),
                        safety_stock   = COALESCE(VALUES(safety_stock), safety_stock),
                        moq            = COALESCE(VALUES(moq), moq),
                        last_sync      = VALUES(last_sync)`,
                    values
                );
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            console.error('[MySQL upsertInventoryItems Error]', err);
            throw err;
        } finally {
            connection.release();
        }
    },

    /** Clear branch/stock fields on catalog rows — stock lives on warehouse rows only. */
    async sanitizeCatalogStockFields(companyId = null) {
        try {
            const sql = companyId
                ? `UPDATE inventory_items
                   SET branch_id = NULL, site_id = NULL, on_hand = 0, available = 0
                   WHERE company_id = ? AND default_warehouse = '__catalog__'`
                : `UPDATE inventory_items
                   SET branch_id = NULL, site_id = NULL, on_hand = 0, available = 0
                   WHERE default_warehouse = '__catalog__'`;
            const params = companyId ? [companyId] : [];
            const [result] = await pool.query(sql, params);
            return result.affectedRows || 0;
        } catch (err) {
            console.error("[MySQL sanitizeCatalogStockFields Error]", err);
            throw err;
        }
    },

    /**
     * Bulk upsert inventory levels.
     */
    async upsertInventoryLevels(levels, companyId = "main") {
        if (!levels.length) return;
        const CHUNK = 200;
        const now = new Date();
        const safeNum = (v) => { const n = Number(v); return (isNaN(n) ? null : n); };
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            for (let i = 0; i < levels.length; i += CHUNK) {
                const chunk = levels.slice(i, i + CHUNK);
                const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
                const values = chunk.flatMap(l => [
                    String(l.inventory_id || "").trim(),
                    companyId,
                    String(l.warehouse_id || l.branch_id || "").trim(),
                    l.description || null,
                    l.item_class ?? "",
                    safeNum(l.default_price),
                    l.item_status || 'active',
                    l.base_unit || '',
                    l.item_type || '',
                    l.posting_class || '',
                    String(l.branch_id || "").trim(),
                    String(l.site_id || "").trim(),
                    safeNum(l.on_hand) ?? 0,
                    safeNum(l.available) ?? 0,
                    now,
                ]);
                await connection.query(
                    `INSERT INTO inventory_items
                        (inventory_id, company_id, default_warehouse, inventory_name, item_class,
                        default_price, item_status, base_unit, type, posting_class,
                        branch_id, site_id, on_hand, available, last_sync)
                    VALUES ${placeholders}
                    ON DUPLICATE KEY UPDATE
                        on_hand        = VALUES(on_hand),
                        available      = VALUES(available),
                        branch_id      = VALUES(branch_id),
                        site_id        = VALUES(site_id),
                        inventory_name = COALESCE(VALUES(inventory_name), inventory_name),
                        item_class     = COALESCE(VALUES(item_class),     item_class),
                        default_price  = COALESCE(VALUES(default_price),  default_price),
                        item_status    = COALESCE(VALUES(item_status),    item_status),
                        base_unit      = COALESCE(VALUES(base_unit),      base_unit),
                        type           = COALESCE(NULLIF(VALUES(type),''), type),
                        posting_class  = COALESCE(NULLIF(VALUES(posting_class),''), posting_class),
                        last_sync      = VALUES(last_sync)`,
                    values
                );
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            console.error('[MySQL upsertInventoryLevels Error]', err);
            throw err;
        } finally {
            connection.release();
        }
    },

    /** Remove stock rows not refreshed during the current sync run. */
    async deleteStaleInventoryLevels(syncStartedAt, companyId = "main") {
        try {
            // 2-minute buffer so freshly upserted rows are never removed due to clock skew
            const cutoff = new Date(new Date(syncStartedAt).getTime() - 2 * 60 * 1000);
            const [result] = await pool.query(
                `DELETE FROM inventory_items
                 WHERE company_id = ?
                   AND default_warehouse != '__catalog__'
                   AND (last_sync IS NULL OR last_sync < ?)`,
                [companyId, cutoff]
            );
            return result.affectedRows || 0;
        } catch (err) {
            console.error("[MySQL deleteStaleInventoryLevels Error]", err);
            throw err;
        }
    },

    async countWarehouseRows(companyId = "main") {
        return countWarehouseRows(companyId);
    },

    async resolveInventoryLayout(companyId = "main") {
        return resolveInventoryLayout(companyId);
    },

    /** Remove all synced stock-level rows (keeps catalog rows). Used only for manual repair. */
    async purgeInventoryLevels(companyId = null) {
        try {
            const sql = companyId
                ? `DELETE FROM inventory_items WHERE default_warehouse != '__catalog__' AND company_id = ?`
                : `DELETE FROM inventory_items WHERE default_warehouse != '__catalog__'`;
            const params = companyId ? [companyId] : [];
            const [result] = await pool.query(sql, params);
            return result.affectedRows || 0;
        } catch (err) {
            console.error("[MySQL purgeInventoryLevels Error]", err);
            throw err;
        }
    },

    /** Remove stock rows for specific items before re-importing from Acumatica. */
    async deleteInventoryLevelsForItems(itemIds, companyId = "main") {
        const ids = [...new Set(itemIds.map((id) => String(id || "").trim()).filter(Boolean))];
        if (!ids.length) return 0;
        try {
            const placeholders = ids.map(() => "?").join(",");
            const [result] = await pool.query(
                `DELETE FROM inventory_items
                 WHERE company_id = ?
                   AND default_warehouse != '__catalog__'
                   AND TRIM(inventory_id) IN (${placeholders})`,
                [companyId, ...ids]
            );
            return result.affectedRows || 0;
        } catch (err) {
            console.error("[MySQL deleteInventoryLevelsForItems Error]", err);
            throw err;
        }
    },

    /**
     * Bulk upsert rows from Supabase product_periodic_sales into db_purchase
     */
    async upsertPeriodicSales(rows) {
        if (!rows.length) return;
        const connection = await purchasePool.getConnection();
        try {
            await connection.beginTransaction();
            for (const r of rows) {
                await connection.execute(
                    `INSERT INTO product_periodic_sales
                        (id, branch_name, order_type, financial_period, document_date,
                         description, qty, total_amount, item_class, inventory_id,
                         posting_class, last_sync)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        branch_name      = VALUES(branch_name),
                        order_type       = VALUES(order_type),
                        financial_period = VALUES(financial_period),
                        document_date    = VALUES(document_date),
                        description      = VALUES(description),
                        qty              = VALUES(qty),
                        total_amount     = VALUES(total_amount),
                        item_class       = VALUES(item_class),
                        inventory_id     = VALUES(inventory_id),
                        posting_class    = VALUES(posting_class),
                        last_sync        = VALUES(last_sync)`,
                    [
                        r.id,
                        r.branch_name ?? null,
                        r.order_type ?? null,
                        r.financial_period ?? null,
                        r.document_date ?? null,
                        r.description ?? null,
                        r.qty ?? null,
                        r.total_amount ?? null,
                        r.item_class ?? null,
                        r.inventory_id ?? null,
                        r.posting_class ?? null,
                        r.last_sync ? new Date(r.last_sync) : new Date(),
                    ]
                );
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            console.error("[MySQL upsertPeriodicSales Error]", err);
            throw err;
        } finally {
            connection.release();
        }
    },

    /**
     * Identify and handle orphaned sales records (no matching inventory item)
     */
    async validateSalesIntegrity() {
        const connection = await purchasePool.getConnection();
        try {
            console.log(">>> [MySQL] Validating Sales Integrity...");
            const inventoryDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
            
            // 1. Find orphaned records
            const [orphans] = await connection.query(`
                SELECT COUNT(*) as count 
                FROM product_periodic_sales s
                LEFT JOIN \`${inventoryDb}\`.inventory_items i ON s.inventory_id = i.inventory_id
                WHERE i.inventory_id IS NULL
            `);
            
            console.log(`>>> [MySQL] Found ${orphans[0].count} orphaned sales records.`);
            
            // 2. Mark orphans with a special class if they exist (optional, for visibility)
            if (orphans[0].count > 0) {
                await connection.query(`
                    UPDATE product_periodic_sales s
                    LEFT JOIN \`${inventoryDb}\`.inventory_items i ON s.inventory_id = i.inventory_id
                    SET s.item_class = 'ORPHANED'
                    WHERE i.inventory_id IS NULL
                `);
            }
            
            return orphans[0].count;
        } catch (err) {
            console.error("[MySQL validateSalesIntegrity Error]", err);
            throw err;
        } finally {
            connection.release();
        }
    },

    /**
     * Log a synchronization event
     */
    async logSyncEvent(mode, section, status, records = 0, message = null) {
        try {
            await purchasePool.query(
                `INSERT INTO sync_logs (mode, section, status, records_processed, message)
                 VALUES (?, ?, ?, ?, ?)`,
                [mode, section, status, records, message]
            );
            return true;
        } catch (err) {
            console.error("[MySQL logSyncEvent Error]", err);
            return false;
        }
    },

    /**
     * Fetch recent sync logs
     */
    async getSyncLogs(limit = 20) {
        try {
            const [rows] = await purchasePool.query(
                `SELECT id, timestamp, mode, section, status, records_processed as records, message 
                 FROM sync_logs 
                 ORDER BY timestamp DESC 
                 LIMIT ?`,
                [limit]
            );
            return rows;
        } catch (err) {
            console.error("[MySQL getSyncLogs Error]", err);
            return [];
        }
    },

    /**
     * Get all persistent user annotations for a specific module
     */
    async getAnnotations(moduleName) {
        try {
            const [rows] = await purchasePool.query(
                "SELECT ref_id, field_key, field_value FROM user_annotations WHERE module = ?",
                [moduleName]
            );
            // Transform to { [ref_id]: { [field_key]: value } }
            return rows.reduce((acc, row) => {
                if (!acc[row.ref_id]) acc[row.ref_id] = {};
                acc[row.ref_id][row.field_key] = row.field_value;
                return acc;
            }, {});
        } catch (err) {
            console.error("[MySQL getAnnotations Error]", err);
            return {};
        }
    },

    /**
     * Persist or update a user annotation
     */
    async upsertAnnotation(moduleName, refId, fieldKey, fieldValue) {
        try {
            await purchasePool.query(
                `INSERT INTO user_annotations (module, ref_id, field_key, field_value)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE field_value = VALUES(field_value)`,
                [moduleName, refId, fieldKey, fieldValue]
            );
            return true;
        } catch (err) {
            console.error("[MySQL upsertAnnotation Error]", err);
            return false;
        }
    },

    async ensureItemDimensionsTable() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS item_dimensions (
                    inventory_id VARCHAR(100) NOT NULL,
                    pcs_per_box DECIMAL(18,4) NULL,
                    length_m DECIMAL(18,6) NULL,
                    height_m DECIMAL(18,6) NULL,
                    width_m DECIMAL(18,6) NULL,
                    weight_kg DECIMAL(18,4) NULL,
                    cbm DECIMAL(18,8) NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (inventory_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } catch (err) {
            console.error("[MySQL ensureItemDimensionsTable Error]", err);
            throw err;
        }
    },

    async getItemDimensions(inventoryId) {
        await this.ensureItemDimensionsTable();
        const [rows] = await pool.execute(
            `SELECT inventory_id, pcs_per_box, length_m, height_m, width_m, weight_kg, cbm, updated_at
             FROM item_dimensions WHERE TRIM(UPPER(inventory_id)) = TRIM(UPPER(?))`,
            [inventoryId]
        );
        if (!rows.length) return null;
        const r = rows[0];
        return {
            inventoryId: r.inventory_id,
            pcs_per_box: r.pcs_per_box != null ? Number(r.pcs_per_box) : null,
            length_m: r.length_m != null ? Number(r.length_m) : null,
            height_m: r.height_m != null ? Number(r.height_m) : null,
            width_m: r.width_m != null ? Number(r.width_m) : null,
            weight_kg: r.weight_kg != null ? Number(r.weight_kg) : null,
            cbm: r.cbm != null ? Number(r.cbm) : null,
            updatedAt: r.updated_at,
        };
    },

    async upsertItemDimensions(inventoryId, data) {
        await this.ensureItemDimensionsTable();
        await pool.execute(
            `INSERT INTO item_dimensions
                (inventory_id, pcs_per_box, length_m, height_m, width_m, weight_kg, cbm)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                pcs_per_box = VALUES(pcs_per_box),
                length_m = VALUES(length_m),
                height_m = VALUES(height_m),
                width_m = VALUES(width_m),
                weight_kg = VALUES(weight_kg),
                cbm = VALUES(cbm)`,
            [
                String(inventoryId).trim(),
                data.pcs_per_box ?? null,
                data.length_m ?? null,
                data.height_m ?? null,
                data.width_m ?? null,
                data.weight_kg ?? null,
                data.cbm ?? null,
            ]
        );
        return this.getItemDimensions(inventoryId);
    },

    async getDimensionIdSet(inventoryIds = []) {
        await this.ensureItemDimensionsTable();
        const ids = [...new Set(inventoryIds.map((id) => String(id || "").trim()).filter(Boolean))];
        const set = new Set();
        if (!ids.length) return set;
        const placeholders = ids.map(() => "?").join(",");
        const [rows] = await pool.query(
            `SELECT UPPER(TRIM(inventory_id)) AS id FROM item_dimensions
             WHERE TRIM(inventory_id) IN (${placeholders})
               AND (
                 pcs_per_box IS NOT NULL OR length_m IS NOT NULL OR height_m IS NOT NULL
                 OR width_m IS NOT NULL OR weight_kg IS NOT NULL OR cbm IS NOT NULL
               )`,
            ids
        );
        for (const r of rows) set.add(r.id);
        return set;
    },

    async inventoryIdExists(inventoryId) {
        const [[row]] = await pool.query(
            `SELECT 1 FROM inventory_items WHERE TRIM(UPPER(inventory_id)) = TRIM(UPPER(?)) LIMIT 1`,
            [inventoryId]
        );
        return !!row;
    },

    async importItemDimensions(rows, { fillEmpty = true } = {}) {
        await this.ensureItemDimensionsTable();
        let imported = 0;
        let skipped = 0;
        const skippedIds = [];

        for (const row of rows) {
            const id = String(row.inventory_id || "").trim();
            if (!id) continue;
            if (!hasAnyDimensionValue(row)) continue;

            const exists = await this.inventoryIdExists(id);
            if (!exists) {
                skipped++;
                if (skippedIds.length < 50) skippedIds.push(id);
                continue;
            }

            if (fillEmpty) {
                const existing = await this.getItemDimensions(id);
                const merged = mergeDimensionsFillEmpty(existing, { ...row, inventory_id: id });
                await this.upsertItemDimensions(id, merged);
            } else {
                await this.upsertItemDimensions(id, row);
            }
            imported++;
        }

        return { imported, skipped, skippedIds };
    },

    /**
     * Post-sync enrichment: Fill missing item_class and posting_class in sales table
     * by joining with the inventory catalog.
     */
    async enrichSalesData() {
        const connection = await purchasePool.getConnection();
        try {
            console.log(">>> [MySQL] Starting Sales Data Enrichment...");
            
            const inventoryDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
            
            // Update item_class and posting_class from inventory_items catalog where missing
            const sql = `
                UPDATE product_periodic_sales s
                JOIN \`${inventoryDb}\`.inventory_items i ON s.inventory_id = i.inventory_id
                SET 
                    s.item_class = COALESCE(s.item_class, i.item_class),
                    s.posting_class = COALESCE(s.posting_class, i.posting_class)
                WHERE (s.item_class IS NULL OR s.posting_class IS NULL)
                AND i.default_warehouse = '__catalog__'
            `;
            const [res] = await connection.query(sql);
            console.log(`>>> [MySQL] Enrichment complete. Rows updated: ${res.affectedRows}`);
            return res.affectedRows;
        } catch (err) {
            console.error("[MySQL enrichSalesData Error]", err);
            throw err;
        } finally {
            connection.release();
        }
    },

    /**
     * Get 90-day comparative sales analysis from MySQL (3 x 30-day periods)
     */
    async getSalesAnalysis({ branch = "", periods = [] }) {
        const cacheKey = `salesAnalysis:${branch}:${periods.map((p) => `${p.key}:${p.start}:${p.end}`).join("|")}`;
        return getCached(cacheKey, 300_000, () => this._computeSalesAnalysis({ branch, periods }));
    },

    async _computeSalesAnalysis({ branch = "", periods = [] }) {
        try {
            console.log(`[MySQL getSalesAnalysis] Params: branch="${branch}", periodsCount=${periods.length}`);
            if (periods.length === 0) return { data: [], metrics: {} };

            if (branch && branch !== "All Branches" && isExcludedBranchAlias(branch)) {
                return { data: [], metrics: { totalRevenue: 0, totalQtySold: 0, uniqueProducts: 0 } };
            }

            // periods = [{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', key: 'P1' }, ...]
            const allDates = periods.flatMap(p => [p.start, p.end]);
            const overallStart = allDates.reduce((a, b) => a < b ? a : b);
            const overallEnd = allDates.reduce((a, b) => a > b ? a : b);

            const whereClauses = ["s.document_date >= ?", "s.document_date <= ?"];
            const params = [overallStart, overallEnd];

            const salesEx = sqlExcludeSalesBranches("branch_name", "s");
            whereClauses.push(salesEx.clause);
            params.push(...salesEx.params);

            if (branch && branch !== "All Branches") {
                whereClauses.push("TRIM(UPPER(s.branch_name)) = TRIM(UPPER(?))");
                params.push(branch);
            }

            const wherePart = `WHERE ${whereClauses.join(" AND ")}`;

            const periodCases = periods.map(p => 
                `SUM(CASE WHEN s.document_date >= '${p.start}' AND s.document_date <= '${p.end}' THEN (${SQL_NET_QTY}) ELSE 0 END) as qty_${p.key},
                 SUM(CASE WHEN s.document_date >= '${p.start}' AND s.document_date <= '${p.end}' THEN (${SQL_NET_AMOUNT}) ELSE 0 END) as sales_${p.key}`
            ).join(",\n                    ");

            const query = `SELECT 
                    s.inventory_id,
                    s.branch_name,
                    MAX(s.description) as last_description,
                    ${periodCases}
                 FROM product_periodic_sales s
                 ${wherePart}
                 GROUP BY s.inventory_id, s.branch_name`;

            const [rows] = await purchasePool.query(query, params);
            console.log(`[MySQL getSalesAnalysis] Success: ${rows.length} rows found.`);

            // Fetch catalog for missing descriptions (optional but better)
            const catalog = await this.getProductCatalog();
            const catalogMap = new Map(catalog.map(i => [i.inventory_id.toUpperCase().trim(), i.description]));

            let totalRevenue = 0;
            let totalQtySold = 0;

            const finalData = rows.map(r => {
                const invId = (r.inventory_id || "").toUpperCase().trim();
                const description = r.last_description || catalogMap.get(invId) || "—";

                const item = {
                    inventoryId: r.inventory_id,
                    branchName: r.branch_name,
                    description: description,
                    monthlyData: {},
                    totalQty: 0,
                    totalSales: 0
                };

                periods.forEach(p => {
                    const q = netQtySold(r[`qty_${p.key}`]);
                    const s = Math.max(0, Number(r[`sales_${p.key}`]) || 0);
                    item.monthlyData[p.key] = { qty: q, sales: s };
                    item.totalQty += q;
                    item.totalSales += s;
                });

                totalRevenue += item.totalSales;
                totalQtySold += item.totalQty;
                return item;
            }).sort((a, b) => b.totalSales - a.totalSales);

            return {
                data: finalData,
                metrics: {
                    totalRevenue,
                    totalQtySold,
                    uniqueProducts: finalData.length
                }
            };
        } catch (err) {
            console.error("[MySQL getSalesAnalysis Error]", err);
            throw err;
        }
    },

    /**
     * Aggregate periodic sales for specific inventory IDs only (fast path for paginated lists).
     */
    async getPeriodicSalesSummaryForIds({ ids = [], branch = "", lookbackDays = SALES_LOOKBACK_DAYS } = {}) {
        const normalized = [...new Set(
            ids.map((id) => String(id || "").toUpperCase().trim()).filter(Boolean)
        )];
        if (!normalized.length) return new Map();

        const cacheKey = `salesIds:${lookbackDays}:${branch}:${normalized.slice().sort().join(",")}`;
        return getCached(cacheKey, 45_000, () =>
            this._queryPeriodicSalesForIds(normalized, branch, lookbackDays)
        );
    },

    async _queryPeriodicSalesForIds(normalized, branch, lookbackDays) {
        try {
            if (branch && branch !== "All Branches" && isExcludedBranchAlias(branch)) {
                return new Map();
            }

            const whereClauses = [salesLookbackSql(lookbackDays)];
            const params = [];

            const salesEx = sqlExcludeSalesBranches("branch_name");
            whereClauses.push(salesEx.clause);
            params.push(...salesEx.params);

            if (branch && branch !== "All Branches") {
                const branchNames = await this.resolveSalesBranchNames(branch);
                const placeholders = branchNames.map(() => "TRIM(UPPER(?))").join(", ");
                whereClauses.push(`TRIM(UPPER(branch_name)) IN (${placeholders})`);
                params.push(...branchNames);
            }

            const idPlaceholders = normalized.map(() => "?").join(", ");
            whereClauses.push(`UPPER(TRIM(inventory_id)) IN (${idPlaceholders})`);
            params.push(...normalized);

            const wherePart = `WHERE ${whereClauses.join(" AND ")}`;

            const [rows] = await purchasePool.query(
                `SELECT
                    UPPER(TRIM(inventory_id)) AS inventory_id,
                    SUM(${SQL_NET_QTY}) AS qty_sold,
                    SUM(${SQL_NET_AMOUNT}) AS total_sales
                 FROM product_periodic_sales
                 ${wherePart}
                 GROUP BY UPPER(TRIM(inventory_id))`,
                params
            );

            const map = new Map();
            for (const r of rows) {
                if (r.inventory_id) {
                    map.set(r.inventory_id, {
                        qty_sold: netQtySold(r.qty_sold),
                        total_sales: Math.max(0, Number(r.total_sales) || 0),
                    });
                }
            }
            return map;
        } catch (err) {
            console.error("[MySQL getPeriodicSalesSummaryForIds Error]", err);
            return new Map();
        }
    },

    /**
     * Aggregate periodic sales by inventory_id for a given branch/search filter.
     * Returns Map<inventory_id_upper, { qty_sold, total_sales }>
     * Required by Dashboard Inventory API.
     */
    async getPeriodicSalesSummary({ branch = "", search = "", lookbackDays = SALES_LOOKBACK_DAYS } = {}) {
        try {
            if (branch && branch !== "All Branches" && isExcludedBranchAlias(branch)) {
                return new Map();
            }

            const whereClauses = [salesLookbackSql(lookbackDays)];
            const params = [];

            const salesEx = sqlExcludeSalesBranches("branch_name");
            whereClauses.push(salesEx.clause);
            params.push(...salesEx.params);

            if (branch && branch !== "All Branches") {
                const branchNames = await this.resolveSalesBranchNames(branch);
                const placeholders = branchNames.map(() => "TRIM(UPPER(?))").join(", ");
                whereClauses.push(`TRIM(UPPER(branch_name)) IN (${placeholders})`);
                params.push(...branchNames);
            }
            if (search) {
                whereClauses.push("(inventory_id LIKE ? OR description LIKE ?)");
                params.push(`%${search}%`, `%${search}%`);
            }

            const wherePart = `WHERE ${whereClauses.join(" AND ")}`;

            const [rows] = await purchasePool.query(
                `SELECT
                    UPPER(TRIM(inventory_id)) AS inventory_id,
                    SUM(${SQL_NET_QTY})          AS qty_sold,
                    SUM(${SQL_NET_AMOUNT}) AS total_sales
                 FROM product_periodic_sales
                 ${wherePart}
                 GROUP BY UPPER(TRIM(inventory_id))`,
                params
            );

            const map = new Map();
            for (const r of rows) {
                if (r.inventory_id) {
                    map.set(r.inventory_id, {
                        qty_sold: netQtySold(r.qty_sold),
                        total_sales: Math.max(0, Number(r.total_sales) || 0),
                    });
                }
            }
            return map;
        } catch (err) {
            console.error("[MySQL getPeriodicSalesSummary Error]", err);
            return new Map();
        }
    },

    /**
     * Gross sales for SKUs stocked at a branch, counted across all invoice branches.
     * Retail locations (ILOILO, CEBU, etc.) often post invoices under BACOLOD/BOHOL lines.
     */
    async getBranchCatalogNetworkSalesSummary({
        branch = "",
        companyId = "main",
        lookbackDays = SALES_LOOKBACK_DAYS,
    } = {}) {
        if (!branch || isExcludedBranchAlias(branch)) {
            return { map: new Map(), mode: "gross", salesScope: "catalog-network" };
        }

        try {
            const inv = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
            const effectiveCompanyId = resolveCompanyIdForBranch(companyId, branch);
            const isEcomBranch = isEcomBranchAlias(branch);
            const window = parseInt(lookbackDays, 10) || SALES_LOOKBACK_DAYS;
            const whereClauses = [
                `s.document_date >= DATE_SUB(CURDATE(), INTERVAL ${window} DAY)`,
                `s.document_date <= CURDATE()`,
                `s.order_type IN ('Invoice', 'Debit Memo')`,
            ];
            const joinParams = [];
            const whereParams = [];

            const salesEx = sqlExcludeSalesBranches("s.branch_name");
            whereClauses.push(salesEx.clause);
            whereParams.push(...salesEx.params);

            let invBranchClause;
            if (isEcomBranch) {
                const ecomAliases = [...ECOM_BRANCH_ALIASES];
                invBranchClause = `UPPER(TRIM(i.branch_id)) IN (${ecomAliases.map(() => "?").join(", ")})`;
                joinParams.push(...ecomAliases);
                whereClauses.push(
                    `(i.company_id = 'ecommerce' OR (i.company_id = 'main' AND UPPER(TRIM(i.branch_id)) IN (${ecomAliases.map(() => "?").join(", ")})))`
                );
                whereParams.push(...ecomAliases);
            } else {
                invBranchClause = `UPPER(TRIM(i.branch_id)) = UPPER(TRIM(?))`;
                joinParams.push(branch);

                const branchEx = sqlExcludeBranches("i");
                whereClauses.push(branchEx.clause);
                whereParams.push(...branchEx.params);

                if (effectiveCompanyId === "main") {
                    const ecomEx = sqlExcludeEcomBranches("i");
                    whereClauses.push(ecomEx.clause);
                    whereParams.push(...ecomEx.params);

                    const ecomSalesEx = sqlExcludeEcomSalesBranches("s.branch_name");
                    whereClauses.push(ecomSalesEx.clause);
                    whereParams.push(...ecomSalesEx.params);
                } else if (effectiveCompanyId === "ecommerce") {
                    const ecomOnly = sqlOnlyEcomBranches("i");
                    whereClauses.push(ecomOnly.clause);
                    whereParams.push(...ecomOnly.params);
                }

                whereClauses.push(`i.company_id = ?`);
                whereParams.push(effectiveCompanyId);
            }

            const params = [...joinParams, ...whereParams];

            const [rows] = await purchasePool.query(
                `SELECT UPPER(TRIM(s.inventory_id)) AS inventory_id,
                        SUM(CASE WHEN s.order_type IN ('Invoice','Debit Memo') THEN ABS(s.qty) ELSE 0 END) AS qty_sold,
                        SUM(CASE WHEN s.order_type IN ('Invoice','Debit Memo') THEN ABS(s.total_amount) ELSE 0 END) AS total_sales
                 FROM product_periodic_sales s
                 INNER JOIN \`${inv}\`.inventory_items i
                   ON UPPER(TRIM(s.inventory_id)) = UPPER(TRIM(i.inventory_id))
                  AND ${invBranchClause}
                  AND i.default_warehouse != '__catalog__'
                  AND (i.item_status IS NULL OR UPPER(TRIM(i.item_status)) = 'ACTIVE')
                 WHERE ${whereClauses.join(" AND ")}
                 GROUP BY UPPER(TRIM(s.inventory_id))
                 HAVING qty_sold > 0`,
                params
            );

            const map = new Map();
            for (const r of rows) {
                if (r.inventory_id) {
                    map.set(r.inventory_id, {
                        qty_sold: Number(r.qty_sold) || 0,
                        total_sales: Math.max(0, Number(r.total_sales) || 0),
                    });
                }
            }
            return { map, mode: "gross", salesScope: "catalog-network", lookbackDays };
        } catch (err) {
            console.error("[MySQL getBranchCatalogNetworkSalesSummary Error]", err);
            return { map: new Map(), mode: "gross", salesScope: "catalog-network" };
        }
    },

    /** Resolve sales invoice branch names that match an inventory branch/site id. */
    async resolveSalesBranchNames(branchId) {
        const key = String(branchId || "").trim();
        if (!key) return [];

        const candidates = new Set([key]);
        if (isEcomBranchAlias(key)) {
            for (const alias of ECOM_BRANCH_ALIASES) candidates.add(alias);
        }

        try {
            const names = new Set();
            for (const candidate of candidates) {
                const [rows] = await purchasePool.query(
                    `SELECT DISTINCT branch_name
                     FROM product_periodic_sales
                     WHERE branch_name IS NOT NULL AND TRIM(branch_name) != ''
                       AND (
                         TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
                         OR TRIM(UPPER(branch_name)) LIKE CONCAT(TRIM(UPPER(?)), ' %')
                         OR TRIM(UPPER(branch_name)) LIKE CONCAT(TRIM(UPPER(?)), '-%')
                       )`,
                    [candidate, candidate, candidate]
                );
                for (const r of rows) {
                    const n = String(r.branch_name || "").trim();
                    if (n) names.add(n);
                }
            }
            const resolved = [...names];
            return resolved.length ? resolved : [key];
        } catch (err) {
            console.error("[MySQL resolveSalesBranchNames Error]", err);
            return [key];
        }
    },

    async getReplenishmentSalesSummary({ branch = "", lookbackDays = SALES_LOOKBACK_DAYS } = {}) {
        const filterPositiveSalesMap = (map) => {
            const filtered = new Map();
            for (const [key, val] of map) {
                const qty = Number(val?.qty_sold) || 0;
                if (qty > 0) {
                    filtered.set(key, {
                        qty_sold: qty,
                        total_sales: Math.max(0, Number(val?.total_sales) || 0),
                    });
                }
            }
            return filtered;
        };

        const netMap = filterPositiveSalesMap(await this.getPeriodicSalesSummary({ branch, lookbackDays }));
        if (netMap.size > 0) return { map: netMap, mode: "net" };

        try {
            if (branch && branch !== "All Branches" && isExcludedBranchAlias(branch)) {
                return { map: new Map(), mode: "gross" };
            }

            const whereClauses = [salesLookbackSql(lookbackDays)];
            const params = [];
            const salesEx = sqlExcludeSalesBranches("branch_name");
            whereClauses.push(salesEx.clause);
            params.push(...salesEx.params);

            if (branch && branch !== "All Branches") {
                const branchNames = await this.resolveSalesBranchNames(branch);
                const placeholders = branchNames.map(() => "TRIM(UPPER(?))").join(", ");
                whereClauses.push(`TRIM(UPPER(branch_name)) IN (${placeholders})`);
                params.push(...branchNames);
            }

            const [rows] = await purchasePool.query(
                `SELECT UPPER(TRIM(inventory_id)) AS inventory_id,
                        SUM(${SQL_GROSS_QTY}) AS qty_sold,
                        SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(total_amount) ELSE 0 END) AS total_sales
                 FROM product_periodic_sales
                 WHERE ${whereClauses.join(" AND ")}
                 GROUP BY UPPER(TRIM(inventory_id))
                 HAVING SUM(${SQL_GROSS_QTY}) > 0`,
                params
            );

            const grossMap = new Map();
            for (const r of rows) {
                if (r.inventory_id) {
                    grossMap.set(r.inventory_id, {
                        qty_sold: Number(r.qty_sold) || 0,
                        total_sales: Math.max(0, Number(r.total_sales) || 0),
                    });
                }
            }
            return { map: grossMap, mode: "gross" };
        } catch (err) {
            console.error("[MySQL getReplenishmentSalesSummary Error]", err);
            return { map: new Map(), mode: "net" };
        }
    },

    /** Extended lookback gross sales when 90-day window has no invoice rows for a branch. */
    async getAccurateReplenishmentSalesMap({ branch = "", companyId = "main" } = {}) {
        const isMain = !branch || String(branch).trim().toUpperCase() === "MAIN";
        const effectiveCompanyId = isMain ? companyId : resolveCompanyIdForBranch(companyId, branch);
        let lookbackDays = SALES_LOOKBACK_DAYS;

        const mergeSalesMaps = (a, b) => {
            const merged = new Map();
            for (const [key, val] of a) {
                const qty = Number(val?.qty_sold) || 0;
                if (qty > 0) {
                    merged.set(key, {
                        qty_sold: qty,
                        total_sales: Math.max(0, Number(val?.total_sales) || 0),
                    });
                }
            }
            for (const [key, val] of b) {
                const existing = merged.get(key);
                const qty = Math.max(existing?.qty_sold ?? 0, Number(val?.qty_sold) || 0);
                if (qty > 0) {
                    merged.set(key, {
                        qty_sold: qty,
                        total_sales: Math.max(existing?.total_sales ?? 0, Number(val?.total_sales) || 0),
                    });
                }
            }
            return merged;
        };

        const countPositive = (map) => {
            let n = 0;
            for (const v of map.values()) if ((v.qty_sold ?? 0) > 0) n++;
            return n;
        };

        if (isMain) {
            let result = await this.getRetailNetworkSalesSummary({ companyId, lookbackDays });
            let map = result.map;
            let count = countPositive(map);

            if (count < 20) {
                for (const days of [180, 365]) {
                    const extended = await this.getRetailNetworkSalesSummary({ companyId, lookbackDays: days });
                    const extCount = countPositive(extended.map);
                    if (extCount > count) {
                        map = extended.map;
                        lookbackDays = days;
                        count = extCount;
                    }
                }
            }

            return {
                map,
                salesScope: "network",
                lookbackDays,
                salesMode: result.mode || "gross",
            };
        }

        let strict = await this.getReplenishmentSalesSummary({ branch, lookbackDays });
        let catalog = await this.getBranchCatalogNetworkSalesSummary({ branch, companyId: effectiveCompanyId, lookbackDays });
        let map = mergeSalesMaps(strict.map, catalog.map);
        let count = countPositive(map);
        let salesScope = countPositive(catalog.map) >= countPositive(strict.map) ? "catalog-network" : "branch";
        let salesMode = countPositive(catalog.map) >= countPositive(strict.map) ? "gross" : strict.mode;

        if (count < 20) {
            for (const days of [180, 365]) {
                const extStrict = await this.getReplenishmentSalesSummary({ branch, lookbackDays: days });
                const extCatalog = await this.getBranchCatalogNetworkSalesSummary({ branch, companyId: effectiveCompanyId, lookbackDays: days });
                const extMap = mergeSalesMaps(extStrict.map, extCatalog.map);
                const extCount = countPositive(extMap);
                if (extCount > count) {
                    map = extMap;
                    lookbackDays = days;
                    count = extCount;
                    salesScope = countPositive(extCatalog.map) >= countPositive(extStrict.map)
                        ? "catalog-network" : "branch";
                    salesMode = countPositive(extCatalog.map) >= countPositive(extStrict.map)
                        ? "gross" : extStrict.mode;
                }
            }
        }

        return { map, salesScope, lookbackDays, salesMode };
    },

    /** Network-wide gross sales for retail invoice branches only (MAIN warehouse demand). */
    async getRetailNetworkSalesSummary({ companyId = "main", lookbackDays = SALES_LOOKBACK_DAYS } = {}) {
        try {
            const whereClauses = [
                salesLookbackSql(lookbackDays),
                `order_type IN ('Invoice', 'Debit Memo')`,
            ];
            const params = [];

            const salesEx = sqlExcludeSalesBranches("branch_name");
            whereClauses.push(salesEx.clause);
            params.push(...salesEx.params);

            if (companyId === "main") {
                const ecomEx = sqlExcludeEcomSalesBranches("branch_name");
                whereClauses.push(ecomEx.clause);
                params.push(...ecomEx.params);
            }

            const [rows] = await purchasePool.query(
                `SELECT UPPER(TRIM(inventory_id)) AS inventory_id,
                        SUM(${SQL_GROSS_QTY}) AS qty_sold,
                        SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(total_amount) ELSE 0 END) AS total_sales
                 FROM product_periodic_sales
                 WHERE ${whereClauses.join(" AND ")}
                 GROUP BY UPPER(TRIM(inventory_id))
                 HAVING SUM(${SQL_GROSS_QTY}) > 0`,
                params
            );

            const map = new Map();
            for (const r of rows) {
                if (r.inventory_id) {
                    map.set(r.inventory_id, {
                        qty_sold: Number(r.qty_sold) || 0,
                        total_sales: Math.max(0, Number(r.total_sales) || 0),
                    });
                }
            }
            return { map, mode: "gross", lookbackDays };
        } catch (err) {
            console.error("[MySQL getRetailNetworkSalesSummary Error]", err);
            return { map: new Map(), mode: "gross", lookbackDays };
        }
    },

    async getReplenishmentSalesSummaryExtended({ branch = "", companyId = "main", branchStrict = false } = {}) {
        let result = await this.getReplenishmentSalesSummary({ branch, lookbackDays: SALES_LOOKBACK_DAYS });
        let count = 0;
        for (const v of result.map.values()) if ((v.qty_sold ?? 0) > 0) count++;

        if (count < 20) {
            for (const days of [180, 365]) {
                const extended = await this.getReplenishmentSalesSummary({ branch, lookbackDays: days });
                let extCount = 0;
                for (const v of extended.map.values()) if ((v.qty_sold ?? 0) > 0) extCount++;
                if (extCount > count) {
                    result = { ...extended, lookbackDays: days };
                    count = extCount;
                }
            }
        }

        const isMain = !branch || String(branch).trim().toUpperCase() === "MAIN";
        if (!isMain && !branchStrict && count < 20) {
            const catalog = await this.getBranchCatalogNetworkSalesSummary({ branch, companyId });
            let catCount = 0;
            for (const v of catalog.map.values()) if ((v.qty_sold ?? 0) > 0) catCount++;
            if (catCount > count) {
                return catalog;
            }
        }

        return {
            ...result,
            salesScope: isMain ? "network" : "branch",
            lookbackDays: result.lookbackDays || SALES_LOOKBACK_DAYS,
        };
    },

    async ensureReplenishmentCacheTable() {
        return getCached("replenishment:table-ready", 3_600_000, async () => {
        try {
            await purchasePool.query(`
                CREATE TABLE IF NOT EXISTS replenishment_cache (
                    company_id VARCHAR(50) NOT NULL DEFAULT 'main',
                    branch_id VARCHAR(100) NOT NULL,
                    inventory_id VARCHAR(100) NOT NULL,
                    description VARCHAR(500) NULL,
                    current_stock DECIMAL(18,4) DEFAULT 0,
                    qty_sold_90 DECIMAL(18,4) DEFAULT 0,
                    sales_velocity DECIMAL(18,6) DEFAULT 0,
                    days_remaining INT DEFAULT 0,
                    suggested_qty DECIMAL(18,4) DEFAULT 0,
                    priority_level VARCHAR(20) NOT NULL DEFAULT 'Low',
                    lead_time_days INT DEFAULT 0,
                    vendor_id VARCHAR(100) NULL,
                    branch_order_qty DECIMAL(18,4) DEFAULT 0,
                    main_inventory DECIMAL(18,4) DEFAULT 0,
                    coming_po DECIMAL(18,4) DEFAULT 0,
                    total_branch_replenishment DECIMAL(18,4) DEFAULT 0,
                    sales_scope VARCHAR(50) NULL,
                    restock_source VARCHAR(255) NULL,
                    what_to_do TEXT NULL,
                    ai_preview TEXT NULL,
                    ai_insights_json JSON NULL,
                    is_main_warehouse_view TINYINT(1) NOT NULL DEFAULT 0,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (company_id, branch_id, inventory_id),
                    KEY idx_repl_branch_priority (company_id, branch_id, priority_level),
                    KEY idx_repl_updated (updated_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            return true;
        } catch (err) {
            console.error("[MySQL ensureReplenishmentCacheTable Error]", err);
            return false;
        }
        });
    },

    /** Fast SQL rollup of branch demand for MAIN warehouse planning. */
    async getBranchOrderQtyFromCache(companyId = "main") {
        await this.ensureReplenishmentCacheTable();
        try {
            const [rows] = await purchasePool.query(
                `SELECT UPPER(TRIM(inventory_id)) AS inventoryId,
                        SUM(COALESCE(suggested_qty, 0)) AS qty
                 FROM replenishment_cache
                 WHERE company_id = ?
                   AND UPPER(TRIM(branch_id)) != 'MAIN'
                   AND COALESCE(suggested_qty, 0) > 0
                 GROUP BY UPPER(TRIM(inventory_id))`,
                [companyId]
            );
            const map = new Map();
            for (const r of rows) {
                const key = String(r.inventoryId || "").trim();
                if (key) map.set(key, Number(r.qty) || 0);
            }
            return map;
        } catch (err) {
            console.error("[MySQL getBranchOrderQtyFromCache Error]", err);
            return new Map();
        }
    },

    async getCachedReplenishmentBranchIds(companyId = "main") {
        await this.ensureReplenishmentCacheTable();
        try {
            const [rows] = await purchasePool.query(
                `SELECT DISTINCT branch_id AS branchId
                 FROM replenishment_cache
                 WHERE company_id = ? AND UPPER(TRIM(branch_id)) != 'MAIN'`,
                [companyId]
            );
            return new Set(rows.map((r) => String(r.branchId || "").trim()).filter(Boolean));
        } catch (err) {
            console.error("[MySQL getCachedReplenishmentBranchIds Error]", err);
            return new Set();
        }
    },

    recommendationToCacheRow(companyId, branchId, rec) {
        const ai = {
            ...(rec.aiInsights || {}),
            lookbackDays: rec.lookbackDays,
            qtySold90: rec.qtySold90,
            salesScope: rec.salesScope || rec.aiInsights?.salesScope,
        };
        const ads = Number(ai.salesVelocity) || 0;
        const isMain = !!rec.isMainWarehouseView;
        return [
            companyId,
            branchId,
            rec.itemId,
            rec.description || "",
            rec.currentStock ?? 0,
            rec.qtySold90 ?? 0,
            ads,
            ai.daysRemaining === "N/A" ? 0 : Number(ai.daysRemaining) || 0,
            rec.suggestedQty ?? 0,
            rec.priorityLevel || "Low",
            rec.leadTimeDays ?? ai.leadTimeDays ?? 0,
            rec.vendorId || null,
            rec.branchOrderQty ?? 0,
            rec.mainInventory ?? rec.currentStock ?? 0,
            rec.comingPO ?? 0,
            rec.totalBranchReplenishment ?? rec.branchOrderQty ?? 0,
            rec.salesScope || ai.salesScope || null,
            rec.restockSource || ai.restockSource || null,
            ai.whatToDo || null,
            ai.howItWorks?.preview || null,
            JSON.stringify(ai),
            isMain ? 1 : 0,
            new Date(),
        ];
    },

    cacheRowToRecommendation(row, index, { slim = false } = {}) {
        let aiInsights = null;
        if (!slim && row.ai_insights_json) {
            try {
                aiInsights = typeof row.ai_insights_json === "string"
                    ? JSON.parse(row.ai_insights_json)
                    : row.ai_insights_json;
            } catch {
                aiInsights = null;
            }
        }
        if (!aiInsights) {
            aiInsights = {
                salesVelocity: String(row.sales_velocity ?? 0),
                daysRemaining: row.days_remaining ?? 0,
                whatToDo: row.what_to_do || "",
                howItWorks: { preview: row.ai_preview || "" },
                leadTimeDays: row.lead_time_days ?? 0,
            };
        }

        const rec = {
            recommendationId: `REC-C${index}`,
            itemId: row.inventory_id,
            description: row.description,
            currentStock: Number(row.current_stock) || 0,
            suggestedQty: Number(row.suggested_qty) || 0,
            priorityLevel: row.priority_level,
            branchId: row.branch_id,
            restockSource: row.restock_source,
            generatedDate: row.updated_at,
            aiInsights,
            leadTimeDays: row.lead_time_days ?? 0,
            vendorId: row.vendor_id,
            qtySold90: Number(row.qty_sold_90) || aiInsights.qtySold90 || 0,
            lookbackDays: aiInsights.lookbackDays,
            salesScope: row.sales_scope || aiInsights.salesScope,
            stockSource: "mysql",
            isMainWarehouseView: !!row.is_main_warehouse_view,
        };

        if (row.is_main_warehouse_view) {
            rec.mainInventory = Number(row.main_inventory) || 0;
            rec.branchOrderQty = Number(row.branch_order_qty) || 0;
            rec.totalBranchReplenishment = Number(row.total_branch_replenishment) || 0;
        }
        // Always attach Coming PO for the cache row's branch (MAIN or branch-specific)
        rec.comingPO = Number(row.coming_po) || 0;

        return rec;
    },

    async getReplenishmentCacheStats(companyId, branchId) {
        await this.ensureReplenishmentCacheTable();
        const [[row]] = await purchasePool.query(
            `SELECT
                COUNT(*) AS itemCount,
                MAX(updated_at) AS updatedAt,
                SUM(CASE WHEN priority_level = 'High' THEN 1 ELSE 0 END) AS urgentCount,
                SUM(CASE WHEN priority_level = 'Medium' THEN 1 ELSE 0 END) AS soonCount,
                SUM(COALESCE(suggested_qty, 0)) AS totalSuggested,
                MAX(sales_scope) AS salesScope
             FROM replenishment_cache
             WHERE company_id = ? AND branch_id = ?`,
            [companyId, branchId]
        );
        return {
            itemCount: Number(row?.itemCount) || 0,
            updatedAt: row?.updatedAt || null,
            urgentCount: Number(row?.urgentCount) || 0,
            soonCount: Number(row?.soonCount) || 0,
            totalSuggested: Number(row?.totalSuggested) || 0,
            salesScope: row?.salesScope || null,
        };
    },

    /**
     * Paginated cache read — used for ultra-fast first paint (default slim, no heavy JSON).
     */
    async getReplenishmentFromCachePage(companyId, branchId, { page = 1, pageSize = 10, slim = true } = {}) {
        await this.ensureReplenishmentCacheTable();
        try {
            const stats = await this.getReplenishmentCacheStats(companyId, branchId);
            if (!stats.itemCount) return null;

            const safePage = Math.max(1, page);
            const limit = Math.max(1, Math.min(pageSize, 5000));
            const offset = (safePage - 1) * limit;
            const cols = slim
                ? `inventory_id, description, current_stock, qty_sold_90, sales_velocity, days_remaining,
                   suggested_qty, priority_level, lead_time_days, vendor_id, branch_order_qty,
                   main_inventory, coming_po, total_branch_replenishment, sales_scope, restock_source,
                   what_to_do, ai_preview, is_main_warehouse_view, updated_at, branch_id`
                : `*`;

            const [rows] = await purchasePool.query(
                `SELECT ${cols}
                 FROM replenishment_cache
                 WHERE company_id = ? AND branch_id = ?
                 ORDER BY FIELD(priority_level, 'High', 'Medium', 'Low'), suggested_qty DESC, inventory_id ASC
                 LIMIT ? OFFSET ?`,
                [companyId, branchId, limit, offset]
            );

            const recommendations = rows.map((row, i) =>
                this.cacheRowToRecommendation(row, offset + i, { slim })
            );

            return {
                recommendations,
                meta: {
                    branch: branchId,
                    generatedAt: stats.updatedAt,
                    itemCount: stats.itemCount,
                    cacheSource: "mysql",
                    salesScope: stats.salesScope,
                    salesMode: "gross",
                    pagination: {
                        page: safePage,
                        pageSize: limit,
                        totalItems: stats.itemCount,
                        totalPages: Math.max(1, Math.ceil(stats.itemCount / limit)),
                    },
                    stats: {
                        urgent: stats.urgentCount,
                        soon: stats.soonCount,
                        totalSuggested: stats.totalSuggested,
                    },
                },
            };
        } catch (err) {
            console.error("[MySQL getReplenishmentFromCachePage Error]", err);
            return null;
        }
    },

    async upsertReplenishmentCache(companyId, branchId, recommendations = []) {
        await this.ensureReplenishmentCacheTable();
        const connection = await purchasePool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                "DELETE FROM replenishment_cache WHERE company_id = ? AND branch_id = ?",
                [companyId, branchId]
            );

            if (!recommendations.length) {
                await connection.commit();
                invalidateCache(`replenishment:full:${companyId}:${branchId}`);
                invalidateCache(`replenishment:page:${companyId}:${branchId}`);
                return 0;
            }

            const sql = `
                INSERT INTO replenishment_cache (
                    company_id, branch_id, inventory_id, description, current_stock,
                    qty_sold_90, sales_velocity, days_remaining, suggested_qty, priority_level,
                    lead_time_days, vendor_id, branch_order_qty, main_inventory, coming_po,
                    total_branch_replenishment, sales_scope, restock_source, what_to_do,
                    ai_preview, ai_insights_json, is_main_warehouse_view, updated_at
                ) VALUES ?
            `;
            const values = recommendations.map((rec) =>
                this.recommendationToCacheRow(companyId, branchId, rec)
            );
            // Insert in chunks to avoid huge packets
            const CHUNK = 400;
            for (let i = 0; i < values.length; i += CHUNK) {
                await connection.query(sql, [values.slice(i, i + CHUNK)]);
            }
            await connection.commit();
            invalidateCache(`replenishment:full:${companyId}:${branchId}`);
            invalidateCache(`replenishment:page:${companyId}:${branchId}`);
            return values.length;
        } catch (err) {
            await connection.rollback();
            console.error("[MySQL upsertReplenishmentCache Error]", err);
            throw err;
        } finally {
            connection.release();
        }
    },

    async getReplenishmentFromCache(companyId, branchId) {
        return this.getReplenishmentFromCachePage(companyId, branchId, {
            page: 1,
            pageSize: 100000,
            slim: true,
        });
    },
};
