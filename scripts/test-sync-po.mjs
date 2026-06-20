import dotenv from 'dotenv';
import { AcumaticaService } from '../services/acumatica.js';
import { MySqlService } from '../services/mysql.js';

dotenv.config({ path: '../.env.local' });

// Bypass SSL errors
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Helper functions same as in route.js
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

async function main() {
  console.log('Logging in to Acumatica...');
  const loginUrl = `${process.env.ACUMATICA_BASE_URL}/entity/auth/login`;
  
  const loginRes = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: process.env.ACUMATICA_USERNAME,
      password: process.env.ACUMATICA_PASSWORD,
      company: process.env.ACUMATICA_COMPANY
    })
  });

  if (!loginRes.ok) {
    console.error('Login failed:', loginRes.status);
    return;
  }

  const cookie = loginRes.headers.getSetCookie().join('; ');
  console.log('Login successful.');

  try {
    // We will sync orders starting from 2026-01-01 to keep it fast
    const poStart = "2026-01-01";
    const poFilter = `Date ge datetimeoffset'${poStart}T00:00:00Z' and Status ne 'Cancelled'`;
    const ACU_BASE = `${process.env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;
    
    // Fetch top 5 orders
    const url = `${ACU_BASE}/PurchaseOrder?$expand=Details&$top=5&$skip=0&$filter=${encodeURIComponent(poFilter)}`;
    console.log('Fetching orders from Acumatica:', url);
    const res = await AcumaticaService.fetchWithRetry(url, cookie);
    const data = await res.json();
    const orders = data.value || [];
    console.log(`Fetched ${orders.length} orders.`);

    if (orders.length === 0) {
      console.log('No orders to sync.');
      return;
    }

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
            receipt_date: null,
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

    console.log(`Upserting ${historyRows.length} history rows...`);
    await MySqlService.upsertPurchaseHistory(historyRows);

    console.log(`Upserting ${lineRows.length} line details rows...`);
    await MySqlService.upsertPurchaseOrderDetails(lineRows);
    console.log('Sync finished successfully.');

    // Query database to check the inserted details
    console.log('\nChecking DB for details of synced orders...');
    const syncedOrderNumbers = historyRows.map(h => h.order_nbr);
    for (const orderNbr of syncedOrderNumbers) {
      const ordersResult = await MySqlService.getPurchaseOrders({ page: 1, pageSize: 5, search: orderNbr });
      const matchedOrder = ordersResult.orders.find(o => o.orderNbr === orderNbr);
      if (matchedOrder) {
        console.log(`Order ${orderNbr} (Status: ${matchedOrder.status}):`);
        console.log(`  Lines count: ${matchedOrder.lines?.length}`);
        matchedOrder.lines?.forEach(line => {
          console.log(`    Line - Item ID: ${line.inventoryId}, Desc: "${line.description}", Qty: ${line.qty} ${line.uom}, Ext Cost: ${line.extCost}`);
        });
      } else {
        console.log(`Could not find order ${orderNbr} in DB.`);
      }
    }

  } catch (err) {
    console.error('Error during test-sync:', err);
  } finally {
    // Logout
    await fetch(`${process.env.ACUMATICA_BASE_URL}/entity/auth/logout`, {
      method: 'POST',
      headers: { 'Cookie': cookie }
    });
    process.exit(0);
  }
}

main();
