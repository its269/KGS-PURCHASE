/**
 * Read-only: what Product Directory may have touched in db_kelin_inventory.
 * Does NOT modify product_inventory_items (KelinConnect).
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const dbName = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || "3306", 10),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: dbName,
});

try {
  console.log("DB=", dbName);

  const [tables] = await pool.query("SHOW TABLES LIKE 'kc_cms_media_sort'");
  console.log("kc_cms_media_sort_exists=", tables.length > 0);
  if (tables.length > 0) {
    const [cnt] = await pool.query("SELECT COUNT(*) AS c FROM kc_cms_media_sort");
    console.log("kc_cms_media_sort_rows=", cnt[0].c);
  }

  const [tot] = await pool.query(
    "SELECT COUNT(*) AS c FROM product_inventory_items WHERE deleted_at IS NULL",
  );
  console.log("product_inventory_items_active=", tot[0].c);

  const [dupSummary] = await pool.query(`
    SELECT COUNT(*) AS duplicate_keys, COALESCE(SUM(c - 1), 0) AS extra_rows
    FROM (
      SELECT inventory_id, COUNT(*) AS c
      FROM product_inventory_items
      WHERE deleted_at IS NULL
      GROUP BY inventory_id
      HAVING COUNT(*) > 1
    ) t
  `);
  console.log("duplicate_summary=", JSON.stringify(dupSummary[0]));

  const [dups] = await pool.query(`
    SELECT inventory_id, COUNT(*) AS c
    FROM product_inventory_items
    WHERE deleted_at IS NULL
    GROUP BY inventory_id
    HAVING COUNT(*) > 1
    ORDER BY c DESC
    LIMIT 5
  `);
  console.log("top_duplicate_inventory_ids=", JSON.stringify(dups));

  const [sample] = await pool.query(
    `SELECT id, inventory_id, created_on
     FROM product_inventory_items
     WHERE inventory_id = ? AND deleted_at IS NULL
     ORDER BY id
     LIMIT 8`,
    ["2000000UNSSE01"],
  );
  console.log("sample_2000000UNSSE01=", JSON.stringify(sample));
} finally {
  await pool.end();
}
