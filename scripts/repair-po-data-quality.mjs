/**
 * One-shot data quality repair for Purchase Orders:
 * - backfill blank vendor names
 * - repair header amounts from line extended costs
 */
import dotenv from "dotenv";
import fs from "fs";
import mysql from "mysql2/promise";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

const [fromVendors] = await pool.query(`
  UPDATE purchase_history h
  INNER JOIN vendors v ON v.vendor_id COLLATE utf8mb4_unicode_ci = h.vendor_id
  SET h.vendor_name = v.vendor_name
  WHERE (h.vendor_name IS NULL OR TRIM(h.vendor_name) = '')
    AND v.vendor_name IS NOT NULL AND TRIM(v.vendor_name) != ''
`);
console.log("vendor from vendors table:", fromVendors.affectedRows);

const [fromSibling] = await pool.query(`
  UPDATE purchase_history h
  INNER JOIN (
    SELECT vendor_id, MAX(NULLIF(TRIM(vendor_name), '')) AS vendor_name
    FROM purchase_history
    WHERE vendor_id IS NOT NULL AND TRIM(COALESCE(vendor_name, '')) != ''
    GROUP BY vendor_id
  ) src ON src.vendor_id COLLATE utf8mb4_unicode_ci = h.vendor_id
  SET h.vendor_name = src.vendor_name
  WHERE (h.vendor_name IS NULL OR TRIM(h.vendor_name) = '')
    AND src.vendor_name IS NOT NULL
`);
console.log("vendor from sibling POs:", fromSibling.affectedRows);

const [amounts] = await pool.query(`
  UPDATE purchase_history h
  INNER JOIN (
    SELECT order_nbr, SUM(ext_cost) AS line_total
    FROM purchase_order_details
    GROUP BY order_nbr
    HAVING SUM(ext_cost) > 0
  ) x ON x.order_nbr COLLATE utf8mb4_unicode_ci = h.order_nbr COLLATE utf8mb4_unicode_ci
  SET h.total_amount = x.line_total
  WHERE h.total_amount IS NULL OR h.total_amount = 0
`);
console.log("amounts repaired from lines:", amounts.affectedRows);

const [holdFix] = await pool.query(
  `UPDATE purchase_history SET status = 'On Hold' WHERE status = 'Hold'`
);
const [canceledFix] = await pool.query(
  `UPDATE purchase_history SET status = 'Cancelled' WHERE status = 'Canceled'`
);
console.log("status aliases fixed:", {
  hold: holdFix.affectedRows,
  canceled: canceledFix.affectedRows,
});

const [[blank]] = await pool.query(`
  SELECT COUNT(*) cnt FROM purchase_history
  WHERE status IN ('Open','On Hold','Pending Approval')
    AND DATE(order_date) >= '2026-01-01'
    AND (vendor_name IS NULL OR TRIM(vendor_name)='')
`);
const [[zeroQty]] = await pool.query(`
  SELECT COUNT(*) cnt FROM purchase_history h
  WHERE h.status IN ('Open','On Hold','Pending Approval')
    AND DATE(h.order_date) >= '2026-01-01' AND DATE(h.order_date) <= '2026-09-10'
    AND NOT EXISTS (
      SELECT 1 FROM purchase_order_details d
      WHERE d.order_nbr COLLATE utf8mb4_unicode_ci = h.order_nbr COLLATE utf8mb4_unicode_ci AND d.qty > 0
    )
`);
const [[listCount]] = await pool.query(`
  SELECT COUNT(*) cnt FROM purchase_history h
  WHERE h.status IN ('Open','On Hold','Pending Approval')
    AND DATE(h.order_date) >= '2026-01-01' AND DATE(h.order_date) <= '2026-09-10'
    AND EXISTS (
      SELECT 1 FROM purchase_order_details d
      WHERE d.order_nbr COLLATE utf8mb4_unicode_ci = h.order_nbr COLLATE utf8mb4_unicode_ci AND d.qty > 0
    )
`);
console.log({ activeBlankVendor: blank.cnt, emptyDraftsHidden: zeroQty.cnt, activeWithQtyShown: listCount.cnt });

const [sofie] = await pool.query(`
  SELECT order_nbr, status, total_amount FROM purchase_history
  WHERE vendor_id='VM000055' AND status='Open'
    AND DATE(order_date) >= '2026-01-01' AND DATE(order_date) <= '2026-09-10'
  ORDER BY order_date DESC
`);
console.log("Softie Open:", sofie);

await pool.end();
