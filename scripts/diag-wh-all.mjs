import mysql from "mysql2/promise";

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});

const [[allWh]] = await pool.query(
    `SELECT COUNT(*) c FROM inventory_items WHERE default_warehouse != '__catalog__'`
);
const [samples] = await pool.query(
    `SELECT inventory_id, company_id, default_warehouse, branch_id, on_hand
     FROM inventory_items WHERE default_warehouse != '__catalog__' LIMIT 5`
);
const [companies] = await pool.query(
    `SELECT company_id, COUNT(*) c FROM inventory_items
     WHERE default_warehouse != '__catalog__' GROUP BY company_id`
);
const [iloilo] = await pool.query(
    `SELECT COUNT(*) c, SUM(on_hand) stock FROM inventory_items
     WHERE default_warehouse != '__catalog__' AND branch_id='ILOILO'`
);

console.log({ allWh: allWh.c, companies, iloilo: iloilo[0], samples });
await pool.end();
