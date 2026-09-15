import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || "3306", 10),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});

try {
  const [rows] = await pool.query(
    `SELECT id, inventory_id, inventory_name,
            brochure_url,
            CHAR_LENGTH(IFNULL(brochure_url,'')) AS brochure_len,
            (brochure_url LIKE '%|%' OR brochure_url LIKE '[%') AS multi_hint
     FROM product_inventory_items
     WHERE deleted_at IS NULL
       AND (
         inventory_name LIKE '%Puma%'
         OR inventory_name LIKE '%IECHO%'
         OR inventory_name LIKE '%K-SIGN%'
         OR inventory_name LIKE '%Styro%'
       )
     ORDER BY inventory_name, id
     LIMIT 30`,
  );
  console.log("items", JSON.stringify(rows, null, 2));

  const [tables] = await pool.query("SHOW TABLES LIKE 'product_inventory_%'");
  console.log(
    "tables",
    tables.map((t) => Object.values(t)[0]),
  );

  try {
    const [atts] = await pool.query(
      `SELECT a.id, a.category, a.file_name, LEFT(a.file_url,100) AS file_url,
              p.inventory_id, p.inventory_name
       FROM product_inventory_attachments a
       INNER JOIN product_inventory_items p ON p.id = a.inventory_item_id
       WHERE p.deleted_at IS NULL
         AND (
           p.inventory_name LIKE '%Puma%'
           OR p.inventory_name LIKE '%IECHO%'
           OR a.file_url LIKE '%.pdf%'
           OR a.category LIKE '%brochure%'
         )
       ORDER BY a.id DESC
       LIMIT 40`,
    );
    console.log("attachments", JSON.stringify(atts, null, 2));
  } catch (e) {
    console.log("attachments_err", e.message);
  }
} finally {
  await pool.end();
}
