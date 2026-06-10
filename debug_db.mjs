import mysql from 'mysql2/promise';
import fs from 'fs';

const loadEnv = (p) => {
    if (!fs.existsSync(p)) return {};
    return fs.readFileSync(p, 'utf8').split('\n').reduce((acc, l) => {
        const [k, ...v] = l.split('=');
        if (k && !k.trim().startsWith('#')) {
            let val = v.join('=').trim();
            if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) val = val.slice(1, -1);
            acc[k.trim()] = val;
        }
        return acc;
    }, {});
};

const env = { ...loadEnv('.env'), ...loadEnv('.env.local') };

async function check() {
    const c = await mysql.createConnection({
        host: env.MYSQL_HOST,
        port: parseInt(env.MYSQL_PORT || '3306'),
        user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD,
        database: env.MYSQL_PURCHASE_DATABASE || 'db_purchase'
    });

    const [history] = await c.query('SELECT COUNT(*) as count FROM purchase_history');
    console.log('Purchase History count:', history[0].count);

    const [inventory] = await c.query('SELECT COUNT(*) as count FROM inventory_items');
    console.log('Inventory Items count:', inventory[0].count);

    if (inventory[0].count > 0) {
        const [samples] = await c.query('SELECT inventory_id, inventory_name, branch_id, on_hand, last_sync FROM inventory_items LIMIT 5');
        console.log('Sample inventory:', samples);
    }

    if (history[0].count > 0) {
        const [samples] = await c.query('SELECT * FROM purchase_history LIMIT 5');
        console.log('Sample history:', samples);
    }

    const [perf] = await c.query(`
        SELECT 
            vendor_id,
            COUNT(*) as total_orders,
            SUM(CASE WHEN receipt_date > promised_date THEN 1 ELSE 0 END) as late_orders,
            ROUND(
                (SUM(CASE WHEN receipt_date <= promised_date THEN 1 ELSE 0 END) / COUNT(*)) * 100, 
                1
            ) as reliability_score
        FROM purchase_history
        WHERE status IN ('Closed', 'Completed') AND promised_date IS NOT NULL AND receipt_date IS NOT NULL
        GROUP BY vendor_id
    `);
    console.log('Performance scores calculated:', perf);

    await c.end();
}

check().catch(console.error);
