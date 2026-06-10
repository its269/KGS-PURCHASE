import mysql from "mysql2/promise";
import fs from "fs";
import { resolve } from "path";

// Minimal env loader
function loadEnv() {
    const env = {};
    const files = [".env.local", ".env"];
    for (const file of files) {
        if (fs.existsSync(file)) {
            const lines = fs.readFileSync(file, "utf8").split("\n");
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("#")) continue;
                const [key, ...val] = trimmed.split("=");
                if (key) env[key.trim()] = val.join("=").trim().replace(/^['"]|['"]$/g, "");
            }
        }
    }
    return env;
}

const env = loadEnv();

async function debug() {
    console.log("=== MySQL Debug Script ===");
    console.log(`Connecting to: ${env.MYSQL_HOST}:${env.MYSQL_PORT || 3306}`);
    
    try {
        const connection = await mysql.createConnection({
            host: env.MYSQL_HOST,
            port: parseInt(env.MYSQL_PORT || "3306", 10),
            user: env.MYSQL_USER,
            password: env.MYSQL_PASSWORD,
        });

        const invDb = env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
        const purchaseDb = env.MYSQL_PURCHASE_DATABASE || "db_purchase";

        // 1. Check Inventory Items
        console.log(`\n--- Database: ${invDb} ---`);
        try {
            const [rows] = await connection.query(`SELECT COUNT(*) as count FROM \`${invDb}\`.\`inventory_items\``);
            console.log(`Total rows in inventory_items: ${rows[0].count}`);
            
            if (rows[0].count > 0) {
                const [samples] = await connection.query(`SELECT inventory_id, inventory_name, default_warehouse, on_hand FROM \`${invDb}\`.\`inventory_items\` LIMIT 5`);
                console.log("Sample rows:");
                console.table(samples);
            }
        } catch (e) {
            console.error(`Error reading ${invDb}.inventory_items:`, e.message);
        }

        // 2. Check Sales
        console.log(`\n--- Database: ${purchaseDb} ---`);
        try {
            const [rows] = await connection.query(`SELECT COUNT(*) as count FROM \`${purchaseDb}\`.\`product_periodic_sales\``);
            console.log(`Total rows in product_periodic_sales: ${rows[0].count}`);
            
            if (rows[0].count > 0) {
                const [samples] = await connection.query(`SELECT inventory_id, total_amount, document_date FROM \`${purchaseDb}\`.\`product_periodic_sales\` LIMIT 5`);
                console.log("Sample rows:");
                console.table(samples);
            }
        } catch (e) {
            console.error(`Error reading ${purchaseDb}.product_periodic_sales:`, e.message);
        }

        await connection.end();
    } catch (err) {
        console.error("\nCRITICAL: Could not connect to MySQL server.");
        console.error("Error Message:", err.message);
        console.log("\nPossible reasons:");
        console.log("1. Your local IP is not whitelisted in the server firewall.");
        console.log("2. The credentials in .env.local are incorrect.");
        console.log("3. MySQL is not configured to allow remote connections.");
    }
}

debug();
