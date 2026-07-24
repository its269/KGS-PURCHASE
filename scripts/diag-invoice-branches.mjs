import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

const itemId = process.argv[2] || null;

const [branches] = await pool.query(
    `SELECT branch_name, order_type, COUNT(*) c, SUM(ABS(qty)) qty
     FROM \`${pur}\`.product_periodic_sales
     WHERE order_type = 'Invoice'
       AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
     GROUP BY branch_name, order_type
     ORDER BY c DESC`
);
console.log("Invoice rows by branch (90d):");
console.table(branches);

const [iloiiloLike] = await pool.query(
    `SELECT branch_name, order_type, COUNT(*) c
     FROM \`${pur}\`.product_periodic_sales
     WHERE UPPER(branch_name) LIKE '%ILOI%'
     GROUP BY branch_name, order_type`
);
console.log("\nILOILO-like branch names:");
console.table(iloiiloLike);

if (itemId) {
    const [rows] = await pool.query(
        `SELECT branch_name, order_type, document_date, qty
         FROM \`${pur}\`.product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = UPPER(TRIM(?))
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         ORDER BY document_date DESC LIMIT 20`,
        [itemId]
    );
    console.log(`\nSales for ${itemId}:`);
    console.table(rows);
}

await pool.end();
