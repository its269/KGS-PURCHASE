import mysql from "mysql2/promise";

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
    async getPurchaseOrders({ page = 1, pageSize = 50, search = "", status = "", startDate = "" }) {
        const offset = (page - 1) * pageSize;
        const limitInt = parseInt(pageSize, 10);
        const offsetInt = parseInt(offset, 10);

        try {
            let whereClauses = [];
            let params = [];

            if (status) {
                whereClauses.push("status = ?");
                params.push(status);
            }

            if (startDate) {
                whereClauses.push("order_date >= ?");
                params.push(startDate);
            }

            if (search) {
                whereClauses.push("(order_nbr LIKE ? OR vendor_id LIKE ? OR vendor_name LIKE ?)");
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            const wherePart = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

            const [rows] = await purchasePool.query(
                `SELECT 
                    order_nbr as orderNbr,
                    vendor_id as vendorId,
                    vendor_name as vendorName,
                    status,
                    order_date as date,
                    total_amount as totalAmount
                 FROM purchase_history
                 ${wherePart}
                 ORDER BY order_date DESC, order_nbr DESC
                 LIMIT ${limitInt} OFFSET ${offsetInt}`,
                params
            );

            // Fetch lines for each order
            const ordersWithLines = await Promise.all(rows.map(async (order) => {
                const [lines] = await purchasePool.query(
                    `SELECT inventory_id as inventoryId, description, qty, uom, ext_cost as extCost 
                     FROM purchase_order_details WHERE order_nbr = ?`,
                    [order.orderNbr]
                );
                return {
                    ...order,
                    orderType: "Normal",
                    lines: lines
                };
            }));

            const [[{ total }]] = await purchasePool.query(
                `SELECT COUNT(*) as total FROM purchase_history ${wherePart}`,
                params
            );

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
                vendor_name = VALUES(vendor_name),
                status = VALUES(status),
                promised_date = VALUES(promised_date),
                receipt_date = VALUES(receipt_date),
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

    async upsertPurchaseOrderDetails(rows) {
        if (!rows.length) return;
        const connection = await purchasePool.getConnection();
        try {
            const sql = `
                INSERT INTO purchase_order_details
                (order_nbr, line_nbr, inventory_id, description, qty, uom, ext_cost, last_sync)
                VALUES ?
                ON DUPLICATE KEY UPDATE
                inventory_id = VALUES(inventory_id),
                description = VALUES(description),
                qty = VALUES(qty),
                uom = VALUES(uom),
                ext_cost = VALUES(ext_cost),
                last_sync = VALUES(last_sync)
            `;
            const values = rows.map(r => [
                r.order_nbr, r.line_nbr, r.inventory_id, r.description, r.qty, r.uom, r.ext_cost, r.last_sync
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
                vendor_name = VALUES(vendor_name),
                status = VALUES(status),
                last_sync = VALUES(last_sync)
            `;
            const values = rows.map(r => [r.vendor_id, r.vendor_name, r.status, r.last_sync]);
            await connection.query(sql, [values]);
        } finally {
            connection.release();
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
                const rs = reliability[vid] || 100.00;
                
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
                GROUP BY vendor_id
            `);
            return rows.reduce((acc, row) => {
                acc[row.vendor_id] = {
                    days: Math.round(row.avg_lead_time) || 0,
                    sample: row.sample_size
                };
                return acc;
            }, {});
        } catch (err) {
            console.error("[MySQL getVendorLeadTimes Error]", err);
            return {};
        }
    },

    /**
     * Get calculated reliability scores for all vendors
     */
    async getSupplierPerformance() {
        try {
            const [rows] = await purchasePool.query(`
                SELECT 
                    vendor_id,
                    COUNT(*) as total_orders,
                    SUM(CASE WHEN receipt_date > promised_date THEN 1 ELSE 0 END) as late_orders,
                    ROUND(
                        (SUM(CASE WHEN receipt_date <= promised_date THEN 1 ELSE 0 END) / COUNT(*)) * 100, 
                        1
                    ) as reliability_score
                FROM purchase_history
                WHERE status IN ('Closed', 'Completed') AND promised_date IS NOT NULL AND receipt_date IS NOT NULL
                GROUP BY vendor_id
            `);
            return rows.reduce((acc, row) => {
                acc[row.vendor_id] = row.reliability_score;
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
    async getInventory({ page = 1, pageSize = 50, search = "", branch = "", filter = "" }) {
        const offset = (page - 1) * pageSize;
        const purchaseDb = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";

        try {
            let whereClauses = ["i.default_warehouse IS NOT NULL"];
            let params = [];

            if (branch) {
                whereClauses.push("i.branch_id = ?");
                params.push(branch);
            } else {
                whereClauses.push("i.default_warehouse != '__catalog__'");
            }

            if (search) {
                whereClauses.push("(i.inventory_id LIKE ? OR i.inventory_name LIKE ?)");
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

            const query = `
                SELECT 
                    i.inventory_id as InventoryID, 
                    i.inventory_name as Description, 
                    i.item_class as ItemClass, 
                    i.branch_id as Branch, 
                    i.site_id as SiteID, 
                    COALESCE(i.on_hand, 0) as OnHand, 
                    COALESCE(i.available, 0) as Available, 
                    i.default_price as DefaultPrice,
                    COALESCE(s.total_qty, 0) as QtySold
                 FROM inventory_items i
                 LEFT JOIN (
                    SELECT inventory_id, SUM(qty) as total_qty 
                    FROM \`${purchaseDb}\`.product_periodic_sales 
                    GROUP BY inventory_id
                 ) s ON i.inventory_id = s.inventory_id
                 ${wherePart} 
                 ORDER BY i.inventory_id ASC 
                 LIMIT ${limitInt} OFFSET ${offsetInt}`;

            const [rows] = await pool.query(query, params);

            const [[{ total }]] = await pool.query(
                `SELECT COUNT(*) as total 
                 FROM inventory_items i 
                 LEFT JOIN (
                    SELECT inventory_id, SUM(qty) as total_qty 
                    FROM \`${purchaseDb}\`.product_periodic_sales 
                    GROUP BY inventory_id
                 ) s ON i.inventory_id = s.inventory_id
                 ${wherePart}`,
                params
            );

            // Transform rows to match the BFF structure (objects with .value)
            const transformed = rows.map(item => ({
                InventoryID: { value: item.InventoryID },
                Description: { value: item.Description || "—" },
                SiteID: { value: item.SiteID },
                Branch: { value: item.Branch },
                OnHand: { value: item.OnHand },
                Available: { value: item.Available },
                DefaultPrice: { value: item.DefaultPrice || 0 },
                ItemClass: { value: item.ItemClass || "" },
                QtySold: { value: item.QtySold }
            }));

            return {
                data: transformed,
                totalCount: total,
                hasMore: total > offset + pageSize
            };
        } catch (err) {
            console.error("[MySQL getInventory Error]", err);
            throw err;
        }
    },

    /**
     * Calculate global stats (Total Value, Low Stock, Dead Stock, Overstock, etc.)
     */
    async getGlobalStats(branch = "", search = "") {
        try {
            const purchaseDb = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
            let whereClauses = ["i.default_warehouse IS NOT NULL", "i.default_warehouse != '__catalog__'"];
            let params = [];

            if (branch) {
                whereClauses.push("i.branch_id = ?");
                params.push(branch);
            }

            if (search) {
                whereClauses.push("(i.inventory_id LIKE ? OR i.inventory_name LIKE ?)");
                params.push(`%${search}%`, `%${search}%`);
            }

            const wherePart = `WHERE ${whereClauses.join(" AND ")}`;

            const query = `
                SELECT
                    COUNT(DISTINCT i.inventory_id) as totalProducts,
                    SUM(COALESCE(i.on_hand, 0)) as totalStock,
                    SUM(COALESCE(i.on_hand, 0) * COALESCE(i.default_price, 0)) as totalValue,
                    SUM(CASE WHEN i.on_hand > 0 AND i.on_hand < 10 THEN 1 ELSE 0 END) as lowStockCount,
                    SUM(CASE WHEN i.on_hand > 0 AND i.on_hand < 10 THEN i.on_hand ELSE 0 END) as totalLowStock,
                    SUM(CASE WHEN i.on_hand <= 0 THEN 1 ELSE 0 END) as outOfStockCount,
                    
                    /* Dead Stock: On Hand > 0 but 0 sales in last 90 days */
                    SUM(CASE WHEN i.on_hand > 0 AND COALESCE(s.total_qty, 0) <= 0 THEN 1 ELSE 0 END) as deadStockCount,
                    
                    /* Overstock: On Hand > (ADS * 180 days). Since ADS = total_qty/90, this is On Hand > total_qty * 2 */
                    SUM(CASE WHEN i.on_hand > (COALESCE(s.total_qty, 0) * 2) AND COALESCE(s.total_qty, 0) > 0 THEN 1 ELSE 0 END) as overstockCount,
                    
                    MAX(i.last_sync) as lastSync
                 FROM inventory_items i
                 LEFT JOIN (
                    SELECT inventory_id, SUM(qty) as total_qty 
                    FROM \`${purchaseDb}\`.product_periodic_sales 
                    GROUP BY inventory_id
                 ) s ON i.inventory_id = s.inventory_id
                 ${wherePart}`;

            const [[stats]] = await pool.query(query, params);

            return {
                totalStock: Number(stats.totalStock) || 0,
                totalValue: Number(stats.totalValue) || 0,
                lowStock: Number(stats.lowStockCount) || 0,
                totalLowStock: Number(stats.totalLowStock) || 0,
                outOfStock: Number(stats.outOfStockCount) || 0,
                deadStock: Number(stats.deadStockCount) || 0,
                overstock: Number(stats.overstockCount) || 0,
                count: Number(stats.totalProducts) || 0,
                lastSync: stats.lastSync
            };
        } catch (err) {
            console.error("[MySQL getGlobalStats Error]", err);
            throw err;
        }
    },

    /**
     * Fetch stock items from MySQL database (one row per unique inventory_id)
     * Enriched with total sales and quantity sold.
     */
    async getStockItems({ page = 1, pageSize = 50, search = "", branch = "" } = {}) {
        const offset = (page - 1) * pageSize;
        const limitInt = parseInt(pageSize, 10);
        const offsetInt = parseInt(offset, 10);

        try {
            const whereParts = [];
            const params = [];

            if (search) {
                whereParts.push("(i.inventory_id LIKE ? OR i.inventory_name LIKE ?)");
                params.push(`%${search}%`, `%${search}%`);
            }
            if (branch && branch !== "All Branches") {
                whereParts.push("i.default_warehouse = ?");
                params.push(branch);
            }

            const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

            // 1. Fetch items from Inventory database with summed stock and list of branches
            const query = `
                SELECT 
                    TRIM(i.inventory_id) as inventoryId, 
                    MAX(i.inventory_name) as description, 
                    MAX(i.item_class) as itemClass, 
                    MAX(i.item_status) as itemStatus,
                    MAX(i.base_unit) as baseUnit,
                    MAX(i.default_price) as price,
                    SUM(CASE WHEN i.default_warehouse != '__catalog__' THEN COALESCE(i.on_hand, 0) ELSE 0 END) as totalOnHand,
                    GROUP_CONCAT(DISTINCT CASE WHEN i.default_warehouse != '__catalog__' AND i.on_hand > 0 THEN i.branch_id END SEPARATOR ', ') as branches
                 FROM inventory_items i
                 ${whereClause} 
                 GROUP BY TRIM(i.inventory_id)
                 ORDER BY i.inventory_id ASC 
                 LIMIT ${limitInt} OFFSET ${offsetInt}`;

            const [rows] = await pool.query(query, params);

            const [[{ total, overallStock }]] = await pool.query(
                `SELECT 
                    COUNT(DISTINCT TRIM(i.inventory_id)) as total,
                    SUM(CASE WHEN i.default_warehouse != '__catalog__' THEN COALESCE(i.on_hand, 0) ELSE 0 END) as overallStock
                 FROM inventory_items i ${whereClause}`,
                params
            );

            // 2. Fetch sales summary from Purchase database
            const salesMap = await this.getPeriodicSalesSummary({ search, branch });

            // 3. Merge
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

            return {
                items: enriched,
                totalCount: total,
                totalStock: Number(overallStock) || 0
            };
        } catch (err) {
            console.error("[MySQL getStockItems Error]", err);
            throw err;
        }
    },

    /**
     * Fetch stock item detail from MySQL including all warehouse locations
     */
    async getStockItemDetail(inventoryId) {
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
                    last_sync as lastSync
                 FROM inventory_items 
                 WHERE TRIM(UPPER(inventory_id)) = TRIM(UPPER(?))
                 AND default_warehouse != '__catalog__'`,
                [inventoryId]
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
            })).filter(b => b.branchId);

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
    async getBranches() {
        try {
            const [rows] = await pool.execute(
                `SELECT DISTINCT branch_id FROM inventory_items WHERE branch_id IS NOT NULL AND branch_id != '' AND branch_id != '__catalog__' ORDER BY branch_id ASC`
            );

            return rows.map(r => ({
                SiteID: r.branch_id,
                Description: { value: r.branch_id }
            }));
        } catch (err) {
            console.error("[MySQL getBranches Error]", err);
            return [];
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

    /**
     * Bulk-update catalog fields on existing inventory_items rows.
     */
    async upsertInventoryItems(items) {
        if (!items.length) return;
        const CHUNK = 200;
        const now = new Date();
        const safeNum = (v) => { const n = Number(v); return (isNaN(n) ? null : n); };
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            for (let i = 0; i < items.length; i += CHUNK) {
                const chunk = items.slice(i, i + CHUNK);
                const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
                const values = chunk.flatMap(item => [
                    String(item.inventory_id || "").trim(),
                    '__catalog__',
                    item.description,
                    item.item_class,
                    safeNum(item.default_price),
                    item.item_status || 'active',
                    item.base_unit || '',
                    item.item_type || '',
                    item.posting_class || '',
                    now,
                ]);
                await connection.query(
                    `INSERT INTO inventory_items
                        (inventory_id, default_warehouse, inventory_name, item_class,
                        default_price, item_status, base_unit, type, posting_class, last_sync)
                    VALUES ${placeholders}
                    ON DUPLICATE KEY UPDATE
                        inventory_name = VALUES(inventory_name),
                        item_class     = VALUES(item_class),
                        default_price  = VALUES(default_price),
                        item_status    = VALUES(item_status),
                        base_unit      = VALUES(base_unit),
                        type           = COALESCE(NULLIF(VALUES(type),''), type),
                        posting_class  = COALESCE(NULLIF(VALUES(posting_class),''), posting_class),
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

    /**
     * Bulk upsert inventory levels.
     */
    async upsertInventoryLevels(levels) {
        if (!levels.length) return;
        const CHUNK = 200;
        const now = new Date();
        const safeNum = (v) => { const n = Number(v); return (isNaN(n) ? null : n); };
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            for (let i = 0; i < levels.length; i += CHUNK) {
                const chunk = levels.slice(i, i + CHUNK);
                const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
                const values = chunk.flatMap(l => [
                    String(l.inventory_id || "").trim(),
                    String(l.branch_id || "").trim(),
                    l.description || null,
                    l.item_class || null,
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
                        (inventory_id, default_warehouse, inventory_name, item_class,
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
        try {
            console.log(`[MySQL getSalesAnalysis] Params: branch="${branch}", periodsCount=${periods.length}`);
            if (periods.length === 0) return { data: [], metrics: {} };

            // periods = [{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', key: 'P1' }, ...]
            const allDates = periods.flatMap(p => [p.start, p.end]);
            const overallStart = allDates.reduce((a, b) => a < b ? a : b);
            const overallEnd = allDates.reduce((a, b) => a > b ? a : b);

            const whereClauses = ["s.document_date >= ?", "s.document_date <= ?"];
            const params = [overallStart, overallEnd];

            if (branch && branch !== "All Branches") {
                whereClauses.push("TRIM(UPPER(s.branch_name)) = TRIM(UPPER(?))");
                params.push(branch);
            }

            const wherePart = `WHERE ${whereClauses.join(" AND ")}`;

            const periodCases = periods.map(p => 
                `SUM(CASE WHEN s.document_date >= '${p.start}' AND s.document_date <= '${p.end}' THEN s.qty ELSE 0 END) as qty_${p.key},
                 SUM(CASE WHEN s.document_date >= '${p.start}' AND s.document_date <= '${p.end}' THEN s.total_amount ELSE 0 END) as sales_${p.key}`
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
                    const q = Number(r[`qty_${p.key}`]) || 0;
                    const s = Number(r[`sales_${p.key}`]) || 0;
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
     * Aggregate periodic sales by inventory_id for a given branch/search filter.
     * Returns Map<inventory_id_upper, { qty_sold, total_sales }>
     * Required by Dashboard Inventory API.
     */
    async getPeriodicSalesSummary({ branch = "", search = "" } = {}) {
        try {
            const whereClauses = [];
            const params = [];

            if (branch && branch !== "All Branches") {
                // Dashboard passes Branch ID (e.g. MAIN)
                whereClauses.push("UPPER(branch_name) = UPPER(?)");
                params.push(branch);
            }
            if (search) {
                whereClauses.push("(inventory_id LIKE ? OR description LIKE ?)");
                params.push(`%${search}%`, `%${search}%`);
            }

            const wherePart = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

            const [rows] = await purchasePool.query(
                `SELECT
                    UPPER(TRIM(inventory_id)) AS inventory_id,
                    SUM(qty)          AS qty_sold,
                    SUM(total_amount) AS total_sales
                 FROM product_periodic_sales
                 ${wherePart}
                 GROUP BY UPPER(TRIM(inventory_id))`,
                params
            );

            const map = new Map();
            for (const r of rows) {
                if (r.inventory_id) {
                    map.set(r.inventory_id, {
                        qty_sold: Number(r.qty_sold) || 0,
                        total_sales: Number(r.total_sales) || 0,
                    });
                }
            }
            return map;
        } catch (err) {
            console.error("[MySQL getPeriodicSalesSummary Error]", err);
            return new Map();
        }
    },
};
