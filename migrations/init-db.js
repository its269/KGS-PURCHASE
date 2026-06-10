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

async function run() {
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: parseInt(process.env.MYSQL_PORT || "3306", 10),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        multipleStatements: true,
    });

    console.log(`Connected to MySQL at ${process.env.MYSQL_HOST}`);

    try {
        await connection.query("CREATE DATABASE IF NOT EXISTS db_purchase");
        console.log("Database db_purchase ensured.");

        const sql = readFileSync(resolve(__dirname, "003_setup_db_purchase_tables.sql"), "utf8");
        await connection.query(sql);
        console.log("Successfully created tables in db_purchase (inventory_items, branches, product_periodic_sales).");

    } catch (err) {
        console.error("Error during DB initialization:", err);
    } finally {
        await connection.end();
    }
}

run();
