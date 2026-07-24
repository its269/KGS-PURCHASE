import mysql from "mysql2/promise";

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});

const branch = "ILOILO";

const [[stats]] = await pool.query(
    `SELECT
        COUNT(DISTINCT i.inventory_id) as products,
        SUM(COALESCE(i.on_hand, 0)) as totalStock,
        SUM(COALESCE(i.on_hand, 0) * COALESCE(c.default_price, i.default_price, 0)) as totalValue,
        SUM(CASE WHEN i.on_hand <= 0 THEN 1 ELSE 0 END) as outOfStock
     FROM inventory_items i
     LEFT JOIN inventory_items c
       ON c.inventory_id = i.inventory_id AND c.company_id = i.company_id AND c.default_warehouse = '__catalog__'
     WHERE i.company_id = 'main'
       AND i.default_warehouse != '__catalog__'
       AND i.branch_id = ?`,
    [branch]
);

const [items] = await pool.query(
    `SELECT i.inventory_id, COALESCE(c.inventory_name, i.inventory_name) AS name,
            i.on_hand, COALESCE(c.item_class, i.item_class) AS category
     FROM inventory_items i
     LEFT JOIN inventory_items c
       ON c.inventory_id = i.inventory_id AND c.company_id = i.company_id AND c.default_warehouse = '__catalog__'
     WHERE i.company_id = 'main' AND i.branch_id = ?
       AND i.default_warehouse != '__catalog__'
       AND i.inventory_id IN ('130421440330127', '130425214205127')`,
    [branch]
);

const [[wh]] = await pool.query(
    `SELECT COUNT(*) c FROM inventory_items WHERE default_warehouse != '__catalog__'`
);

console.log({ warehouseRows: wh.c, iloiloStats: stats, sampleItems: items });
await pool.end();
