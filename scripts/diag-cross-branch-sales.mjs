import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";
import { SQL_NET_QTY, SQL_GROSS_QTY } from "../lib/sales-velocity.js";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const branch = process.argv[2] || "ILOILO";
const inv = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
const pur = process.env.MYSQL_PURCHASE_DATABASE || "db_purchase";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
});

const [[dates]] = await pool.query(`SELECT CURDATE() today, DATE_SUB(CURDATE(), INTERVAL 90 DAY) start90`);

console.log(`MySQL today: ${dates.today}, 90d start: ${dates.start90}`);
console.log(`Branch: ${branch}\n`);

const [sameBranch] = await pool.query(
    `SELECT branch_name, COUNT(DISTINCT UPPER(TRIM(inventory_id))) items,
            SUM(CASE WHEN order_type IN ('Invoice','Debit Memo') THEN ABS(qty) ELSE 0 END) gross
     FROM \`${pur}\`.product_periodic_sales
     WHERE document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND TRIM(UPPER(branch_name)) = TRIM(UPPER(?))
     GROUP BY branch_name`,
    [branch]
);
console.log("Sales at same branch_name (90d):");
console.table(sameBranch);

const [crossBranch] = await pool.query(
    `SELECT s.branch_name AS sold_at, COUNT(DISTINCT UPPER(TRIM(s.inventory_id))) items,
            SUM(CASE WHEN s.order_type IN ('Invoice','Debit Memo') THEN ABS(s.qty) ELSE 0 END) gross
     FROM \`${pur}\`.product_periodic_sales s
     INNER JOIN \`${inv}\`.inventory_items i
       ON UPPER(TRIM(s.inventory_id)) = UPPER(TRIM(i.inventory_id))
      AND UPPER(TRIM(i.branch_id)) = UPPER(TRIM(?))
      AND i.default_warehouse != '__catalog__'
      AND i.company_id = 'main'
     WHERE s.document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND s.order_type IN ('Invoice','Debit Memo')
     GROUP BY s.branch_name
     ORDER BY gross DESC
     LIMIT 15`,
    [branch]
);
console.log(`\nInvoice/debit sales for items stocked at ${branch}, by sold_at branch:`);
console.table(crossBranch);

const [network] = await pool.query(
    `SELECT COUNT(DISTINCT UPPER(TRIM(s.inventory_id))) items,
            SUM(CASE WHEN s.order_type IN ('Invoice','Debit Memo') THEN ABS(s.qty) ELSE 0 END) gross
     FROM \`${pur}\`.product_periodic_sales s
     INNER JOIN \`${inv}\`.inventory_items i
       ON UPPER(TRIM(s.inventory_id)) = UPPER(TRIM(i.inventory_id))
      AND UPPER(TRIM(i.branch_id)) = UPPER(TRIM(?))
      AND i.default_warehouse != '__catalog__'
      AND i.company_id = 'main'
     WHERE s.document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND s.order_type IN ('Invoice','Debit Memo')`,
    [branch]
);
console.log(`\nNetwork gross for ${branch} catalog (any invoice branch):`, network[0]);

await pool.end();
