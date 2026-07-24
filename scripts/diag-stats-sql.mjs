import mysql from "mysql2/promise";
const p = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});
const companyId = "main";
const [rows] = await p.query(
    `SELECT
        COUNT(DISTINCT i.inventory_id) AS productCount,
        COALESCE(SUM(i.on_hand), 0) AS totalStock,
        COALESCE(SUM(i.on_hand * COALESCE(c.default_price, i.default_price, 0)), 0) AS totalValue,
        SUM(CASE WHEN i.on_hand > 0 AND i.on_hand < 10 THEN 1 ELSE 0 END) AS lowStockCount,
        SUM(CASE WHEN i.on_hand <= 0 THEN 1 ELSE 0 END) AS outOfStock,
        MAX(i.last_sync) AS lastSync
     FROM inventory_items i
     LEFT JOIN inventory_items c
       ON c.inventory_id = i.inventory_id AND c.company_id = i.company_id AND c.default_warehouse = '__catalog__'
     WHERE i.company_id = ?
       AND i.default_warehouse IS NOT NULL
       AND i.default_warehouse != '__catalog__'
       AND (i.branch_id IS NULL OR UPPER(i.branch_id) NOT IN ('ECOM','ECOMMERCE','E-COMMERCE','E COMMERCE'))`,
    [companyId]
);
console.log(JSON.stringify(rows[0], null, 2));
await p.end();
