import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { SQL_NET_QTY } from "../lib/sales-velocity.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const id = "110102104001000"; // M21 Yellow
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

try {
    const [byBranch] = await pool.query(
        `SELECT TRIM(branch_name) AS branch_name,
                ROUND(SUM(${SQL_NET_QTY}),1) AS net90,
                ROUND(SUM(${SQL_NET_QTY})/90,2) AS ads
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
           AND document_date <= CURDATE()
         GROUP BY TRIM(branch_name)
         HAVING SUM(${SQL_NET_QTY}) > 0
         ORDER BY net90 DESC`,
        [id]
    );
    console.log("True net 90d sales by invoice branch for M21 Yellow:");
    console.table(byBranch);

    const [netAll] = await pool.query(
        `SELECT ROUND(SUM(${SQL_NET_QTY}),1) AS net90, ROUND(SUM(${SQL_NET_QTY})/90,2) AS ads
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
        [id]
    );
    console.log("Network total:", netAll[0]);
} finally {
    await pool.end();
}
