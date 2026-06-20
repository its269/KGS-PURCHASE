import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";
import mysql from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BFF API Route for Data Synchronization
 * Syncs data from Acumatica ERP to the MySQL database.
 */
export async function POST(request) {
    console.log(">>> [Sync API] Starting MySQL Sync Process");
    const encoder = new TextEncoder();
    const signal = request.signal;

    const cookie = getSessionFromRequest(request);
    const syncSecret = request.headers.get("x-sync-secret");
    const isSecretValid = process.env.SYNC_SECRET && syncSecret === process.env.SYNC_SECRET;

    if (!cookie && !isSecretValid) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    
    let effectiveCookie = cookie;
    if (isSecretValid && !cookie) {
        console.log(">>> [Sync API] Secret valid. Performing system login to Acumatica...");
        try {
            const loginRes = await fetch(`${process.env.ACUMATICA_BASE_URL}/entity/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: process.env.ACUMATICA_USERNAME,
                    password: process.env.ACUMATICA_PASSWORD,
                    company: process.env.ACUMATICA_COMPANY
                })
            });
            if (!loginRes.ok) throw new Error(`Acumatica login failed: ${loginRes.status}`);
            
            // Capture all cookies (especially .ASPXAUTH and ASP.NET_SessionId)
            const setCookies = loginRes.headers.getSetCookie();
            effectiveCookie = setCookies.map(c => c.split(";")[0]).join("; ");
            console.log(">>> [Sync API] System login successful. Captured cookies.");
        } catch (loginErr) {
            console.error(">>> [Sync API] System login failed:", loginErr.message);
            return NextResponse.json({ message: "System login failed" }, { status: 500 });
        }
    }

    if (effectiveCookie === "__bypass__" && !isSecretValid) {
        return NextResponse.json({ 
            message: "Synchronization is unavailable in Bypass Mode because the Acumatica API Limit is currently reached. Please try again later when Acumatica sessions have expired." 
        }, { status: 403 });
    }

    // --- AUTO MIGRATION ---
    try {
        console.log(">>> [Sync API] Running Auto-Migrations...");
        const conn = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            port: parseInt(process.env.MYSQL_PORT || "3306", 10),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
        });
        
        const inventoryDb = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
        const purchaseDb = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";

        // Ensure Databases exist
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${inventoryDb}\``);
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${purchaseDb}\``);

        // Ensure inventory_items table exists
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${inventoryDb}\`.\`inventory_items\` (
                \`inventory_id\` VARCHAR(100) NOT NULL,
                \`default_warehouse\` VARCHAR(100) NOT NULL DEFAULT '__catalog__',
                PRIMARY KEY (\`inventory_id\`, \`default_warehouse\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Ensure product_periodic_sales table exists
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${purchaseDb}\`.\`product_periodic_sales\` (
                \`id\` VARCHAR(255) PRIMARY KEY,
                \`inventory_id\` VARCHAR(100),
                \`last_sync\` DATETIME
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Ensure vendors table exists
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${purchaseDb}\`.\`vendors\` (
                \`vendor_id\` VARCHAR(100) PRIMARY KEY,
                \`vendor_name\` VARCHAR(255),
                \`status\` VARCHAR(50),
                \`avg_lead_time\` INT DEFAULT 0,
                \`reliability_score\` DECIMAL(5,2) DEFAULT 100.00,
                \`last_sync\` DATETIME
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Ensure vendors has performance columns (for older schemas)
        const vCols = [
            { name: "avg_lead_time", def: "INT DEFAULT 0" },
            { name: "reliability_score", def: "DECIMAL(5,2) DEFAULT 100.00" }
        ];
        for (const c of vCols) {
            const [[row]] = await conn.query(
                `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS 
                 WHERE TABLE_SCHEMA=? AND TABLE_NAME='vendors' AND COLUMN_NAME=?`,
                [purchaseDb, c.name]
            );
            if (row.cnt === 0) {
                await conn.query(`ALTER TABLE \`${purchaseDb}\`.\`vendors\` ADD COLUMN \`${c.name}\` ${c.def}`);
            }
        }

        // Ensure purchase_history table exists
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${purchaseDb}\`.\`purchase_history\` (
                \`order_nbr\` VARCHAR(50) PRIMARY KEY,
                \`vendor_id\` VARCHAR(100),
                \`vendor_name\` VARCHAR(255),
                \`status\` VARCHAR(50),
                \`order_date\` DATETIME,
                \`promised_date\` DATETIME,
                \`receipt_date\` DATETIME,
                \`total_amount\` DECIMAL(18,4),
                \`last_sync\` DATETIME
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Ensure purchase_history has vendor_name column (for older schemas)
        const [[phVendorNameCol]] = await conn.query(
            `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS 
             WHERE TABLE_SCHEMA=? AND TABLE_NAME='purchase_history' AND COLUMN_NAME='vendor_name'`,
            [purchaseDb]
        );
        if (phVendorNameCol.cnt === 0) {
            await conn.query(`ALTER TABLE \`${purchaseDb}\`.\`purchase_history\` ADD COLUMN \`vendor_name\` VARCHAR(255) NULL AFTER \`vendor_id\``);
        }

        // Ensure sync_logs table exists
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${purchaseDb}\`.\`sync_logs\` (
                \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                \`timestamp\` DATETIME DEFAULT CURRENT_TIMESTAMP,
                \`mode\` VARCHAR(50),
                \`section\` VARCHAR(100),
                \`status\` VARCHAR(50),
                \`records_processed\` INT DEFAULT 0,
                \`message\` TEXT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Ensure purchase_order_details table exists
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${purchaseDb}\`.\`purchase_order_details\` (
                \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                \`order_nbr\` VARCHAR(50),
                \`line_nbr\` INT,
                \`inventory_id\` VARCHAR(100),
                \`description\` VARCHAR(255),
                \`qty\` DECIMAL(18,4),
                \`uom\` VARCHAR(50),
                \`ext_cost\` DECIMAL(18,4),
                \`last_sync\` DATETIME,
                UNIQUE KEY \`uq_po_line\` (\`order_nbr\`, \`line_nbr\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Ensure branches table exists
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${inventoryDb}\`.\`branches\` (
                \`branch_id\` VARCHAR(100) PRIMARY KEY,
                \`branch_name\` VARCHAR(255),
                \`active\` TINYINT(1) DEFAULT 1
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Ensure inventory_items columns exist
        const cols = [
            { name: "on_hand", def: "DECIMAL(18, 4) DEFAULT 0" },
            { name: "available", def: "DECIMAL(18, 4) DEFAULT 0" },
            { name: "branch_id", def: "VARCHAR(100) NULL" },
            { name: "site_id", def: "VARCHAR(100) NULL" },
            { name: "last_sync", def: "DATETIME NULL" },
            { name: "type", def: "VARCHAR(50) NULL" },
            { name: "item_type", def: "VARCHAR(50) NULL" },
            { name: "posting_class", def: "VARCHAR(100) NULL" },
            { name: "base_unit", def: "VARCHAR(50) NULL" },
            { name: "item_class", def: "VARCHAR(100) NULL" },
            { name: "default_price", def: "DECIMAL(18, 4) DEFAULT 0" },
            { name: "inventory_name", def: "VARCHAR(255) NULL" }
        ];

        for (const c of cols) {
            const [[row]] = await conn.query(
                `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS 
                 WHERE TABLE_SCHEMA=? AND TABLE_NAME='inventory_items' AND COLUMN_NAME=?`,
                [inventoryDb, c.name]
            );
            if (row.cnt === 0) {
                await conn.query(`ALTER TABLE \`${inventoryDb}\`.\`inventory_items\` ADD COLUMN \`${c.name}\` ${c.def}`);
            }
        }

        await conn.end();
        console.log(">>> [Sync API] Auto-Migrations Complete.");
    } catch (migErr) {
        console.error(">>> [Sync API] Auto-Migration Error:", migErr.message);
        // Continue anyway, maybe it's just permissions
    }

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") || "incremental";
    const options = {
        inventory: searchParams.get("inventory") === "true",
        sales: searchParams.get("sales") === "true",
        mode: mode,
        startDate: searchParams.get("startDate"),
        endDate: searchParams.get("endDate"),
    };

    const stream = new ReadableStream({
        async start(controller) {
            const send = (data) => {
                if (signal.aborted) return;
                controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
            };

            const keepAlive = setInterval(() => {
                if (!signal.aborted) {
                    try { controller.enqueue(encoder.encode(JSON.stringify({ ping: true }) + "\n")); } catch { }
                }
            }, 15000);
            const finish = () => { clearInterval(keepAlive); controller.close(); };

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

            try {
                const ACU_BASE = `${process.env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;
                const isDelta = options.mode === "delta" || options.mode === "incremental";
                const todayStr = new Date().toISOString().split('T')[0];

                await MySqlService.logSyncEvent(options.mode, "All", "started", 0, `Sync started via API`);

                // Get last sync timestamps for incremental mode
                let lastInvSync = null;
                let lastSalesSync = null;
                if (isDelta) {
                    lastInvSync = await MySqlService.getLastInventorySyncTime();
                    lastSalesSync = await MySqlService.getLastSalesSyncTime();
                    
                    // Add 5-minute safety overlap buffer if timestamp exists
                    // Also format to ISO without milliseconds for better OData compatibility
                    const formatOData = (date) => date.toISOString().replace(/\.\d{3}/, "");

                    if (lastInvSync) {
                        const d = new Date(new Date(lastInvSync).getTime() - (5 * 60 * 1000));
                        lastInvSync = formatOData(d);
                    }
                    if (lastSalesSync) {
                        const d = new Date(new Date(lastSalesSync).getTime() - (5 * 60 * 1000));
                        lastSalesSync = formatOData(d);
                    }
                }

                // 1. BRANCHES (Always fast, sync every time)
                send({ section: "Inventory", details: "Updating branches...", progress: 5 });
                try {
                    const branches = await AcumaticaService.getRealBranches(effectiveCookie);
                    if (branches.length > 0) {
                        await MySqlService.upsertBranches(branches.map(b => ({
                            branch_id: String(b.BranchID).trim(),
                            branch_name: String(b.Description || b.BranchID).trim(), active: true
                        })));
                    }
                } catch (e) {
                    await MySqlService.logSyncEvent(options.mode, "Branches", "error", 0, e.message);
                }

                // 1.5 VENDORS (Sync every time or if inventory/sales is selected)
                if (options.inventory || options.sales) {
                    send({ section: "Suppliers", details: "Updating vendor directory...", progress: 7 });
                    try {
                        const url = `${ACU_BASE}/Vendor?$top=1000`;
                        const res = await AcumaticaService.fetchWithRetry(url, effectiveCookie);
                        const data = await res.json();
                        const vendors = data.value || [];
                        if (vendors.length > 0) {
                            const vendorRows = vendors.map(v => ({
                                vendor_id: String(getF(v, "VendorID")).trim(),
                                vendor_name: String(getF(v, "VendorName")).trim(),
                                status: String(getF(v, "Status")).trim(),
                                last_sync: new Date()
                            }));
                            await MySqlService.upsertVendors(vendorRows);
                            await MySqlService.logSyncEvent(options.mode, "Suppliers", "completed", vendorRows.length);
                        }
                    } catch (e) {
                        console.error(">>> [Sync API] Vendor sync error:", e.message);
                        await MySqlService.logSyncEvent(options.mode, "Suppliers", "error", 0, e.message);
                    }
                }

                // 2. INVENTORY
                if (options.inventory) {
                    const filterArr = [];
                    if (isDelta && lastInvSync) {
                        filterArr.push(`LastModified gt datetimeoffset'${lastInvSync}'`);
                        send({ section: "Inventory", details: `Incremental Sync: Fetching changes since ${lastInvSync}...`, progress: 10 });
                    } else {
                        send({ section: "Inventory", details: "Full Daily Refresh: Scanning all items...", progress: 10 });
                    }

                    const filterStr = filterArr.length > 0 ? `&$filter=${filterArr.join(" and ")}` : "";
                    let skip = 0, totalSynced = 0, top = 50;
                    
                    while (!signal.aborted) {
                        let items = [];
                        try {
                            const url = `${ACU_BASE}/StockItem?$expand=WarehouseDetails&$top=${top}&$skip=${skip}${filterStr}`;
                            console.log(`>>> [Sync API] Fetching StockItems: skip=${skip}`);
                            const res = await AcumaticaService.fetchWithRetry(url, effectiveCookie);
                            const data = await res.json();
                            items = data.value || (Array.isArray(data) ? data : []);
                        } catch (fetchErr) {
                            console.error(`>>> [Sync API] Inventory Fetch Error at skip ${skip}:`, fetchErr.message);
                            send({ section: "Inventory", details: `Error fetching batch at ${skip}: ${fetchErr.message}. Retrying...`, progress: 10 });
                            // Optional: break or continue. Let's try to break to avoid infinite loop on persistent error.
                            throw fetchErr; 
                        }

                        if (items.length === 0) break;

                        const levels = [];
                        const catalogs = [];
                        for (const item of items) {
                            try {
                                const invId = String(getF(item, "InventoryID")).trim();
                                if (!invId) continue;
                                const desc = String(getF(item, "Description")).trim();
                                const itemClass = String(getF(item, "ItemClass")).trim();
                                const price = parseFloat(getF(item, "DefaultPrice") || 0);
                                const status = String(getF(item, "ItemStatus") || "Active");
                                const uom = String(getF(item, "BaseUnit") || "");
                                const itemType = String(getF(item, "ItemType") || "");
                                const postingClass = String(getF(item, "PostingClass") || "");

                                catalogs.push({
                                    inventory_id: invId, description: desc, item_class: itemClass,
                                    default_price: price,
                                    item_status: status,
                                    base_unit: uom,
                                    item_type: itemType,
                                    posting_class: postingClass
                                });

                                let wds = item.WarehouseDetails || [];
                                if (wds && !Array.isArray(wds) && wds.value) wds = wds.value;
                                if (!Array.isArray(wds)) wds = [];

                                if (wds.length > 0) {
                                    for (const wh of wds) {
                                        const whId = String(getAny(wh, "WarehouseID", "SiteID")).trim();
                                        if (whId) levels.push({
                                            inventory_id: invId, branch_id: whId, site_id: whId,
                                            on_hand: Number(getAny(wh, "QtyOnHand") || 0),
                                            available: Number(getAny(wh, "QtyAvailable") || 0),
                                            description: desc, 
                                            item_class: itemClass,
                                            default_price: price,
                                            item_status: status,
                                            base_unit: uom,
                                            item_type: itemType,
                                            posting_class: postingClass
                                        });
                                    }
                                }
                            } catch (itemErr) {
                                console.error(`>>> [Sync API] Item Processing Error:`, itemErr);
                            }
                        }

                        if (catalogs.length > 0) {
                            try {
                                console.log(`>>> [Sync API] Upserting ${catalogs.length} items and ${levels.length} levels to MySQL...`);
                                await MySqlService.upsertInventoryItems(catalogs);
                                await MySqlService.upsertInventoryLevels(levels);
                            } catch (dbErr) {
                                console.error(`>>> [Sync API] Database Upsert Error:`, dbErr.message);
                                throw dbErr;
                            }
                        }
                        totalSynced += items.length; skip += items.length;
                        const invProgress = isDelta ? Math.min(99, Math.floor(totalSynced / 5)) : Math.min(99, Math.floor(totalSynced / 30));
                        send({ section: "Inventory", details: `Processed ${totalSynced} items...`, progress: Math.max(10, invProgress), count: totalSynced });
                        if (items.length < top) break;
                    }
                    console.log(`>>> [Sync API] Inventory sync complete. Total: ${totalSynced}`);
                    await MySqlService.logSyncEvent(options.mode, "Inventory", "completed", totalSynced);
                    send({ section: "Inventory", status: "done", details: `Inventory sync complete.`, progress: 100 });
                }

                // 3. SALES
                const affectedInventoryIds = new Set();
                if (options.sales) {
                    const filterArr = [];
                    if (isDelta && lastSalesSync) {
                        filterArr.push(`LastModifiedDateTime gt datetimeoffset'${lastSalesSync}'`);
                        send({ section: "Sales history", details: `Incremental Sync: Fetching changes since ${lastSalesSync}...`, progress: 10 });
                    } else {
                        let sStart = options.startDate || "2024-01-01";
                        filterArr.push(`Date ge datetimeoffset'${sStart}T00:00:00Z' and Date le datetimeoffset'${(options.endDate || todayStr)}T23:59:59Z'`);
                        send({ section: "Sales history", details: `Full Sync: Range ${sStart} to ${options.endDate || todayStr}`, progress: 10 });
                    }

                    const filterStr = `$filter=${filterArr.join(" and ")}`;
                    let sSkip = 0, sTotal = 0;
                    while (!signal.aborted) {
                        let invoices = [];
                        try {
                            const url = `${ACU_BASE}/Invoice?$expand=Details&$top=50&$skip=${sSkip}&${filterStr}`;
                            console.log(`>>> [Sync API] Fetching Invoices: skip=${sSkip}`);
                            const res = await AcumaticaService.fetchWithRetry(url, effectiveCookie);
                            const data = await res.json();
                            invoices = data.value || [];
                        } catch (salesFetchErr) {
                            console.error(`>>> [Sync API] Sales Fetch Error at skip ${sSkip}:`, salesFetchErr.message);
                            send({ section: "Sales history", details: `Error fetching batch at ${sSkip}: ${salesFetchErr.message}`, progress: 10 });
                            throw salesFetchErr;
                        }

                        if (invoices.length === 0) break;

                        const salesRows = [];
                        for (const inv of invoices) {
                            try {
                                const refNbr = getF(inv, "ReferenceNbr");
                                const branchName = getF(inv, "Branch");
                                const docDate = getF(inv, "Date");
                                
                                let details = inv.Details || inv.Transactions || [];
                                if (details.value) details = details.value;
                                if (!Array.isArray(details)) details = [];
                                
                                for (const line of details) {
                                    const invId = getF(line, "InventoryID");
                                    if (!invId) continue;
                                    if (options.mode === "delta") affectedInventoryIds.add(invId);
                                    salesRows.push({
                                        id: `${refNbr}-${getF(line, "LineNbr")}`,
                                        branch_name: branchName,
                                        order_type: getF(inv, "Type"),
                                        financial_period: getF(inv, "PostPeriod"),
                                        document_date: docDate ? docDate.split('T')[0] : null,
                                        description: getAny(line, "TransactionDescription", "Description"),
                                        qty: parseFloat(getF(line, "Qty") || 0),
                                        total_amount: parseFloat(getF(line, "Amount") || 0),
                                        inventory_id: invId,
                                        last_sync: new Date(),
                                    });
                                }
                            } catch (lineErr) {
                                console.error(`>>> [Sync API] Sales Line Processing Error:`, lineErr);
                            }
                        }
                        if (salesRows.length > 0) {
                            try {
                                await MySqlService.upsertPeriodicSales(salesRows);
                            } catch (salesDbErr) {
                                console.error(`>>> [Sync API] Sales DB Upsert Error:`, salesDbErr.message);
                                throw salesDbErr;
                            }
                        }
                        sTotal += invoices.length; sSkip += invoices.length;
                        const salesProg = Math.min(95, 10 + Math.floor(sTotal / 2));
                        send({ section: "Sales history", details: `Synced ${sTotal} records...`, progress: salesProg, count: sTotal });
                        if (invoices.length < 100) break;
                    }
                    await MySqlService.logSyncEvent(options.mode, "Sales history", "completed", sTotal);
                    send({ section: "Sales history", status: "done", details: "Sales sync complete.", progress: 100 });

                    // 3.5 PURCHASE ORDERS (Incoming PO Details)
                    send({ section: "Incoming PO", details: "Updating purchase order details...", progress: 50 });
                    try {
                        let poStart = options.startDate || "2024-01-01";
                        const poFilter = `Date ge datetimeoffset'${poStart}T00:00:00Z' and Status ne 'Cancelled'`;
                        let poSkip = 0;
                        let poTotal = 0;
                        while (!signal.aborted) {
                            const url = `${ACU_BASE}/PurchaseOrder?$expand=Details&$top=50&$skip=${poSkip}&$filter=${encodeURIComponent(poFilter)}`;
                            const res = await AcumaticaService.fetchWithRetry(url, effectiveCookie);
                            const data = await res.json();
                            const orders = data.value || [];
                            if (orders.length === 0) break;

                            const historyRows = [];
                            const lineRows = [];
                            for (const o of orders) {
                                historyRows.push({
                                    order_nbr: getF(o, "OrderNbr"),
                                    vendor_id: getF(o, "VendorID"),
                                    vendor_name: getF(o, "VendorName"),
                                    status: getF(o, "Status"),
                                    order_date: getF(o, "Date"),
                                    promised_date: getF(o, "PromisedOn"),
                                    receipt_date: null, // Would come from receipt sync if implemented
                                    total_amount: parseFloat(getF(o, "OrderTotal") || 0)
                                });

                                let details = o.Details || o.Transactions || [];
                                if (details.value) details = details.value;
                                if (!Array.isArray(details)) details = [];

                                for (const d of details) {
                                    lineRows.push({
                                        order_nbr: getF(o, "OrderNbr"),
                                        line_nbr: parseInt(getF(d, "LineNbr") || 0),
                                        inventory_id: getF(d, "InventoryID"),
                                        description: getAny(d, "LineDescription", "Description"),
                                        qty: parseFloat(getF(d, "OrderQty") || 0),
                                        uom: getF(d, "UOM"),
                                        ext_cost: parseFloat(getF(d, "ExtendedCost") || 0),
                                        last_sync: new Date()
                                    });
                                }
                            }
                            if (historyRows.length > 0) await MySqlService.upsertPurchaseHistory(historyRows);
                            if (lineRows.length > 0) await MySqlService.upsertPurchaseOrderDetails(lineRows);

                            poTotal += orders.length;
                            poSkip += orders.length;
                            if (orders.length < 50) break;
                        }
                        await MySqlService.logSyncEvent(options.mode, "Incoming PO", "completed", poTotal);
                        send({ section: "Incoming PO", status: "done", details: "Purchase order sync complete.", progress: 100 });
                    } catch (poErr) {
                        console.error(">>> [Sync API] PO sync error:", poErr.message);
                        await MySqlService.logSyncEvent(options.mode, "Incoming PO", "error", 0, poErr.message);
                    }
                }

                // 4. SMART DELTA REFRESH (Only for items sold today)
                if (options.mode === "delta" && affectedInventoryIds.size > 0) {
                    send({ section: "Inventory", details: `Updating stocks for ${affectedInventoryIds.size} sold items...`, progress: 95 });
                    const idList = Array.from(affectedInventoryIds);
                    const idChunks = [];
                    for (let i = 0; i < idList.length; i += 10) idChunks.push(idList.slice(i, i + 10));

                    for (const batch of idChunks) {
                        const filter = batch.map(id => `InventoryID eq '${id}'`).join(" or ");
                        const url = `${ACU_BASE}/StockItem?$expand=WarehouseDetails&$filter=${filter}`;
                        const res = await AcumaticaService.fetchWithRetry(url, effectiveCookie);
                        const data = await res.json();
                        const items = data.value || [];
                        const levels = [];
                        for (const item of items) {
                            const invId = String(getF(item, "InventoryID")).trim();
                            let wds = item.WarehouseDetails || [];
                            if (wds.value) wds = wds.value;
                            if (Array.isArray(wds)) {
                                for (const wh of wds) {
                                    const whId = String(getAny(wh, "WarehouseID", "SiteID")).trim();
                                    if (whId) levels.push({
                                        inventory_id: invId, branch_id: whId, site_id: whId,
                                        on_hand: Number(getAny(wh, "QtyOnHand") || 0),
                                        available: Number(getAny(wh, "QtyAvailable") || 0),
                                        description: String(getF(item, "Description")),
                                        item_class: String(getF(item, "ItemClass"))
                                    });
                                }
                            }
                        }
                        if (levels.length > 0) await MySqlService.upsertInventoryLevels(levels);
                    }
                    await MySqlService.logSyncEvent(options.mode, "Smart Delta", "completed", idList.length);
                    send({ section: "Inventory", status: "done", details: "Stock refresh complete.", progress: 100 });
                }

                // 5. FINAL ENRICHMENT (Optional but recommended for full data accuracy)
                if (options.sales || options.inventory) {
                    send({ section: "Data Enrichment", details: "Filling missing categories...", progress: 98 });
                    try {
                        await MySqlService.enrichSalesData();
                        await MySqlService.validateSalesIntegrity();
                        
                        // New: Calculate Vendor Performance
                        send({ section: "Data Enrichment", details: "Calculating vendor performance...", progress: 99 });
                        const vCount = await MySqlService.calculateAndStoreVendorPerformance();
                        await MySqlService.logSyncEvent(options.mode, "Suppliers Performance", "completed", vCount);
                    } catch (e) {
                        console.error(">>> [Sync API] Enrichment error:", e);
                        await MySqlService.logSyncEvent(options.mode, "Data Enrichment", "error", 0, e.message);
                    }
                    send({ section: "Data Enrichment", status: "done", details: "Enrichment complete.", progress: 100 });
                }

                await MySqlService.logSyncEvent(options.mode, "All", "completed", 0, "Sync finished successfully");
                send({ status: "complete", message: "Sync completed successfully" });
                finish();
            } catch (err) {
                console.error(">>> [Sync Error]", err);
                await MySqlService.logSyncEvent(options.mode, "All", "error", 0, err.message);
                send({ status: "error", message: err?.message || String(err) || "An unknown sync error occurred" });
                finish();
            }
        }
    });

    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

/**
 * GET handler to fetch recent sync logs
 */
export async function GET(request) {
    try {
        const cookie = getSessionFromRequest(request);
        if (!cookie) return Response.json({ message: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get("limit") || "20");

        const logs = await MySqlService.getSyncLogs(limit);
        return Response.json(logs);
    } catch (err) {
        console.error("[GET Sync Logs Error]", err);
        return Response.json({ message: "Internal server error" }, { status: 500 });
    }
}
