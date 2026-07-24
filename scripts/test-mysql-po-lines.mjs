import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

const [rows] = await pool.query(
    "SELECT DISTINCT order_nbr FROM purchase_order_details WHERE order_nbr LIKE ? LIMIT 10",
    ["%260057%"]
);
console.log("detail order_nbrs:", rows);

const [h] = await pool.query(
    "SELECT order_nbr, status, order_date FROM purchase_history WHERE order_nbr LIKE ? LIMIT 5",
    ["%260057%"]
);
console.log("header order_nbrs:", h);

await pool.end();
