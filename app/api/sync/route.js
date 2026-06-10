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

    if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    
    if (cookie === "__bypass__") {
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

        // Ensure inventory_items columns
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
            { name: "inventory_name", def: "VARCHAR(255) NULL" },
            { name: "default_warehouse", def: "VARCHAR(100) NOT NULL DEFAULT '__catalog__'" }
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

        // Ensure Unique Key
        const [[idx]] = await conn.query(
            `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS 
             WHERE TABLE_SCHEMA=? AND TABLE_NAME='inventory_items' AND INDEX_NAME='uq_inv_warehouse'`,
            [inventoryDb]
        );
        if (idx.cnt === 0) {
            await conn.query(`ALTER TABLE \`${inventoryDb}\`.\`inventory_items\` ADD UNIQUE KEY \`uq_inv_warehouse\` (\`inventory_id\`, \`default_warehouse\`)`);
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
                return (val?.value !== undefined ? val.value : val) ?? "";
            };

            const getAny = (obj, ...keys) => {
                for (const k of keys) {
                    const v = getF(obj, k);
                    if (v !== "" && v !== null && v !== undefined) return v;
                }
                return "";
            };

            try {
                const ACU_BASE = "https://accounting.holocrontrackertrading.com/ERP/entity/Default/20.200.001";
                const isDelta = options.mode === "delta" || options.mode === "incremental";
                const todayStr = new Date().toISOString().split('T')[0];

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
                    const branches = await AcumaticaService.getRealBranches(cookie);
                    if (branches.length > 0) {
                        await MySqlService.upsertBranches(branches.map(b => ({
                            branch_id: String(b.BranchID).trim(),
                            branch_name: String(b.Description || b.BranchID).trim(), active: true
                        })));
                    }
                } catch (e) { }

                // 2. INVENTORY
                if (options.inventory) {
                    const filterArr = [];
                    if (isDelta && lastInvSync) {
                        filterArr.push(`LastModifiedDateTime gt datetimeoffset'${lastInvSync}'`);
                        send({ section: "Inventory", details: `Incremental Sync: Fetching changes since ${lastInvSync}...`, progress: 10 });
                    } else {
                        send({ section: "Inventory", details: "Full Daily Refresh: Scanning all items...", progress: 10 });
                    }

                    const filterStr = filterArr.length > 0 ? `&$filter=${filterArr.join(" and ")}` : "";
                    let skip = 0, totalSynced = 0, top = 100;
                    
                    while (!signal.aborted) {
                        let items = [];
                        try {
                            const url = `${ACU_BASE}/StockItem?$expand=WarehouseDetails&$top=${top}&$skip=${skip}${filterStr}`;
                            console.log(`>>> [Sync API] Fetching StockItems: skip=${skip}`);
                            const res = await AcumaticaService.fetchWithRetry(url, cookie);
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
                            const url = `${ACU_BASE}/Invoice?$expand=Details&$top=100&$skip=${sSkip}&${filterStr}`;
                            console.log(`>>> [Sync API] Fetching Invoices: skip=${sSkip}`);
                            const res = await AcumaticaService.fetchWithRetry(url, cookie);
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
                                
                                let details = inv.Details || [];
                                if (details.value) details = details.value;
                                
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
                    send({ section: "Sales history", status: "done", details: "Sales sync complete.", progress: 100 });
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
                        const res = await AcumaticaService.fetchWithRetry(url, cookie);
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
                    send({ section: "Inventory", status: "done", details: "Stock refresh complete.", progress: 100 });
                }

                // 5. FINAL ENRICHMENT (Optional but recommended for full data accuracy)
                if (options.sales || options.inventory) {
                    send({ section: "Data Enrichment", details: "Filling missing categories...", progress: 98 });
                    try {
                        await MySqlService.enrichSalesData();
                    } catch (e) {
                        console.error(">>> [Sync API] Enrichment error:", e);
                    }
                    send({ section: "Data Enrichment", status: "done", details: "Enrichment complete.", progress: 100 });
                }

                send({ status: "complete", message: "Sync completed successfully" });
                finish();
            } catch (err) {
                console.error(">>> [Sync Error]", err);
                send({ status: "error", message: err?.message || String(err) || "An unknown sync error occurred" });
                finish();
            }
        }
    });

    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
