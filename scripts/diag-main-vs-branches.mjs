import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const id = process.argv[2] || "130202101103800";
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

try {
    const [branches] = await pool.query(
        `SELECT branch_id, sales_velocity, qty_sold_90, suggested_qty, current_stock, sales_scope
         FROM replenishment_cache
         WHERE company_id = 'main' AND UPPER(TRIM(inventory_id)) = ?
         ORDER BY CAST(sales_velocity AS DECIMAL(18,6)) DESC`,
        [id]
    );
    console.log("Per-branch cache velocity:");
    console.table(branches);

    const retail = branches.filter((b) => String(b.branch_id).toUpperCase() !== "MAIN");
    const sumAds = retail.reduce((s, b) => s + (Number(b.sales_velocity) || 0), 0);
    const sumQty = retail.reduce((s, b) => s + (Number(b.qty_sold_90) || 0), 0);
    const sumSuggested = retail.reduce((s, b) => s + (Number(b.suggested_qty) || 0), 0);
    const main = branches.find((b) => String(b.branch_id).toUpperCase() === "MAIN");
    console.log({
        sumBranchAds: +sumAds.toFixed(1),
        sumBranchQty90: sumQty,
        sumSuggested,
        mainAds: Number(main?.sales_velocity) || 0,
        mainQty: Number(main?.qty_sold_90) || 0,
        mainTotalBranchRepl: null,
    });

    const [lines] = await pool.query(
        `SELECT id, document_date, qty, total_amount, order_type
         FROM product_periodic_sales
         WHERE UPPER(TRIM(inventory_id)) = ?
           AND UPPER(TRIM(branch_name)) = 'ILOILO'
           AND order_type = 'Invoice'
           AND document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         ORDER BY ABS(qty) DESC
         LIMIT 15`,
        [id]
    );
    console.log("Largest Iloilo invoice lines:");
    console.table(lines);

    // If SI-CM and CM- share same ref number, they are duplicates
    const [overlap] = await pool.query(
        `SELECT
            REPLACE(REPLACE(si.id, 'SI-', ''), CONCAT('-', SUBSTRING_INDEX(si.id, '-', -1)), '') AS ref_guess,
            si.id AS si_id,
            cm.id AS cm_id,
            si.qty AS si_qty,
            cm.qty AS cm_qty,
            si.branch_name
         FROM product_periodic_sales si
         JOIN product_periodic_sales cm
           ON cm.order_type = 'Credit Memo'
          AND cm.id LIKE 'CM-%'
          AND UPPER(TRIM(cm.inventory_id)) = UPPER(TRIM(si.inventory_id))
          AND ABS(cm.qty) = ABS(si.qty)
          AND cm.document_date = si.document_date
          AND TRIM(cm.branch_name) = TRIM(si.branch_name)
         WHERE UPPER(TRIM(si.inventory_id)) = ?
           AND si.order_type = 'Credit Memo'
           AND si.id LIKE 'SI-%'
           AND si.document_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         LIMIT 20`,
        [id]
    );
    console.log("SI Credit Memo rows with matching CM same day/qty/branch:", overlap.length);
    console.table(overlap.slice(0, 8));
} finally {
    await pool.end();
}
