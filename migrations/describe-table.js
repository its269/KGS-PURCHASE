import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
    if (!existsSync(filePath)) return;
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq === -1) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
    }
}
loadEnvFile(resolve(__dirname, "../.env.local"));
loadEnvFile(resolve(__dirname, "../.env"));

const c = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306"),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE,
});

// All columns
const [cols] = await c.query("DESCRIBE inventory_items");
console.log("\n=== inventory_items columns ===");
cols.forEach(r => console.log(`  ${r.Field} - ${r.Type}  default=${r.Default}`));

// Row count
const [[{ total }]] = await c.query("SELECT COUNT(*) as total FROM inventory_items");
console.log(`\n=== Row count: ${total} ===`);

// on_hand stats
if (total > 0) {
    const [[stats]] = await c.query(
        `SELECT 
            SUM(CASE WHEN on_hand > 0 THEN 1 ELSE 0 END) as rows_with_stock,
            SUM(CASE WHEN on_hand = 0 OR on_hand IS NULL THEN 1 ELSE 0 END) as rows_empty,
            MAX(on_hand) as max_on_hand,
            COUNT(DISTINCT default_warehouse) as branch_count
         FROM inventory_items`
    );
    console.log("\n=== on_hand stats ===");
    console.log(`  Rows with stock (on_hand > 0): ${stats.rows_with_stock}`);
    console.log(`  Rows with 0/null on_hand:      ${stats.rows_empty}`);
    console.log(`  Max on_hand value:             ${stats.max_on_hand}`);
    console.log(`  Distinct branches:             ${stats.branch_count}`);

    // Sample rows
    const [sample] = await c.query(
        "SELECT inventory_id, inventory_name, default_warehouse, on_hand, available FROM inventory_items LIMIT 5"
    );
    console.log("\n=== Sample rows ===");
    console.table(sample);
}

await c.end();

