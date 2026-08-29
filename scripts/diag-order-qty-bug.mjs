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
const ids = ["130701301101306", "130701301101312", "130313134050101", "110603002001000"];
for (const id of ids) {
    const [c] = await pool.query(
        `SELECT inventory_id, current_stock, sales_velocity, qty_sold_90, suggested_qty, coming_po,
                JSON_UNQUOTE(JSON_EXTRACT(ai_insights_json, '$.salesVelocity')) AS ai_ads
         FROM \`${pur}\`.replenishment_cache
         WHERE company_id='main' AND UPPER(TRIM(branch_id))='BACOLOD'
           AND UPPER(REPLACE(TRIM(inventory_id),' ',''))=?`,
        [id]
    );
    const [fis] = await pool.query(
        `SELECT COALESCE(SUM(on_hand),0) oh FROM \`${pur}\`.forecast_item_stock
         WHERE company_id='main' AND UPPER(TRIM(warehouse_id))='BACOLOD'
           AND UPPER(REPLACE(TRIM(inventory_id),' ',''))=?`,
        [id]
    );
    const r = c[0];
    const ads = Number(r?.sales_velocity) || 0;
    const stock = Number(fis[0]?.oh) || 0;
    const target = ads > 0 ? Math.ceil(ads * 60) : 0;
    console.log({
        id,
        cacheSuggested: Number(r?.suggested_qty) || 0,
        cacheStock: Number(r?.current_stock) || 0,
        liveStock: stock,
        ads,
        ai_ads: r?.ai_ads,
        target,
        shouldOrder: Math.max(0, target - stock),
    });
}
await pool.end();
