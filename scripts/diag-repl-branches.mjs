import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || "db_purchase",
});

try {
    const [stale] = await pool.query(
        `SELECT branch_id AS branchId,
                MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(ai_insights_json, '$.salesLogicVersion')) AS UNSIGNED)) AS ver,
                COUNT(*) AS items,
                MAX(updated_at) AS updatedAt
         FROM replenishment_cache
         WHERE company_id = 'main' AND UPPER(TRIM(branch_id)) != 'MAIN'
         GROUP BY branch_id
         ORDER BY branch_id`
    );
    console.log("All cached retail branches:");
    console.table(stale);

    const [needRebuild] = await pool.query(
        `SELECT branch_id AS branchId,
                MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(ai_insights_json, '$.salesLogicVersion')) AS UNSIGNED)) AS ver
         FROM replenishment_cache
         WHERE company_id = 'main' AND UPPER(TRIM(branch_id)) != 'MAIN'
         GROUP BY branch_id
         HAVING ver IS NULL OR ver < 4`
    );
    console.log("Need rebuild (ver < 4):", needRebuild);

    // For top MAIN items, which branches contribute to total_branch_replenishment?
    const [top] = await pool.query(
        `SELECT inventory_id, description, total_branch_replenishment, suggested_qty, current_stock, coming_po
         FROM replenishment_cache
         WHERE company_id='main' AND branch_id='MAIN'
         ORDER BY total_branch_replenishment DESC
         LIMIT 5`
    );
    console.log("Top MAIN by total branch repl:");
    console.table(top);

    for (const row of top) {
        const [parts] = await pool.query(
            `SELECT branch_id, sales_velocity, suggested_qty, current_stock, coming_po
             FROM replenishment_cache
             WHERE company_id='main' AND UPPER(TRIM(inventory_id))=UPPER(?)
               AND UPPER(TRIM(branch_id))!='MAIN' AND COALESCE(suggested_qty,0)>0
             ORDER BY suggested_qty DESC`,
            [row.inventory_id]
        );
        console.log(`\nContributors to ${row.inventory_id}:`);
        console.table(parts);
    }
} finally {
    await pool.end();
}
