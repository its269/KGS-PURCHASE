import dotenv from "dotenv";
import mysql from "mysql2/promise";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

const [bad] = await pool.query(
    `SELECT inventory_id, description, current_stock, sales_velocity, qty_sold_90,
            suggested_qty, days_remaining, priority_level, coming_po, updated_at
     FROM \`${pur}\`.replenishment_cache
     WHERE company_id = 'main' AND UPPER(TRIM(branch_id)) = 'BACOLOD'
       AND COALESCE(suggested_qty, 0) = 0
       AND COALESCE(sales_velocity, 0) > 0
       AND current_stock < CEILING(sales_velocity * 60)
     ORDER BY sales_velocity DESC
     LIMIT 15`
);
console.log("Cache rows where suggested=0 but stock < 60-day target (BUG candidates):");
console.table(bad);
console.log("count sample", bad.length);

const [[cnt]] = await pool.query(
    `SELECT COUNT(*) AS n
     FROM \`${pur}\`.replenishment_cache
     WHERE company_id = 'main' AND UPPER(TRIM(branch_id)) = 'BACOLOD'
       AND COALESCE(suggested_qty, 0) = 0
       AND COALESCE(sales_velocity, 0) > 0
       AND current_stock < CEILING(sales_velocity * 60)`
);
console.log("Total BACOLOD bug-candidate rows:", cnt.n);

await pool.end();
