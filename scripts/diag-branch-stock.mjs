import mysql from "mysql2/promise";

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
});

const [[wh]] = await pool.query(
    `SELECT COUNT(*) c FROM inventory_items WHERE default_warehouse != '__catalog__' AND company_id='main'`
);
const [[cat]] = await pool.query(
    `SELECT COUNT(*) c FROM inventory_items WHERE default_warehouse = '__catalog__' AND company_id='main'`
);

const [iloiloCat] = await pool.query(
    `SELECT inventory_id, on_hand, branch_id, default_warehouse FROM inventory_items
     WHERE company_id='main' AND branch_id='ILOILO' LIMIT 10`
);

const [iloiloWh] = await pool.query(
    `SELECT inventory_id, on_hand, branch_id, default_warehouse FROM inventory_items
     WHERE company_id='main' AND default_warehouse != '__catalog__' AND branch_id='ILOILO' LIMIT 10`
);

const [branchWh] = await pool.query(
    `SELECT branch_id, COUNT(*) c, SUM(on_hand) stock FROM inventory_items
     WHERE company_id='main' AND default_warehouse != '__catalog__'
     GROUP BY branch_id ORDER BY stock DESC LIMIT 15`
);

const [branchCat] = await pool.query(
    `SELECT branch_id, COUNT(*) c, SUM(on_hand) stock FROM inventory_items
     WHERE company_id='main' AND default_warehouse = '__catalog__' AND branch_id IS NOT NULL
     GROUP BY branch_id ORDER BY stock DESC LIMIT 15`
);

console.log({ warehouseRows: wh.c, catalogRows: cat.c });
console.log("ILOILO catalog-style:", iloiloCat);
console.log("ILOILO warehouse-style:", iloiloWh);
console.log("branches warehouse:", branchWh);
console.log("branches catalog:", branchCat.slice(0, 8));

await pool.end();
