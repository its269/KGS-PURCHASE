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
const db = env.MYSQL_PURCHASE_DATABASE || 'db_purchase';
const pool = mysql.createPool({
    host: env.MYSQL_HOST,
    port: parseInt(env.MYSQL_PORT || '3306'),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: db
});

const [stats] = await pool.query(`
    SELECT COUNT(*) total,
        SUM(receipt_date IS NULL) no_receipt,
        SUM(promised_date IS NULL) no_promised,
        SUM(status IN ('Closed','Completed')) closed
    FROM purchase_history
`);

const [perfAll] = await pool.query(`
    SELECT vendor_id,
        ROUND((SUM(CASE WHEN receipt_date <= promised_date THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as reliability_score
    FROM purchase_history
    WHERE status IN ('Closed', 'Completed') AND promised_date IS NOT NULL AND receipt_date IS NOT NULL
    GROUP BY vendor_id
`);
const perfMap = Object.fromEntries(perfAll.map(r => [r.vendor_id, r.reliability_score]));

const [perf] = await pool.query(`
    SELECT vendor_id, COUNT(*) as total_orders,
        SUM(CASE WHEN receipt_date > promised_date THEN 1 ELSE 0 END) as late_orders,
        ROUND((SUM(CASE WHEN receipt_date <= promised_date THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as reliability_score
    FROM purchase_history
    WHERE status IN ('Closed', 'Completed') AND promised_date IS NOT NULL AND receipt_date IS NOT NULL
    GROUP BY vendor_id
    ORDER BY total_orders DESC
    LIMIT 30
`);

const [vendorScores] = await pool.query(`
    SELECT vendor_id, reliability_score, avg_lead_time
    FROM vendors
    WHERE reliability_score IS NOT NULL AND reliability_score NOT IN (0, 100)
    LIMIT 20
`);

const [allScoreDist] = await pool.query(`
    SELECT reliability_score, COUNT(*) cnt
    FROM vendors
    GROUP BY reliability_score
    ORDER BY cnt DESC
    LIMIT 20
`);

const [samplePO] = await pool.query(`
    SELECT order_nbr, vendor_id, status, order_date, promised_date, receipt_date
    FROM purchase_history
    LIMIT 10
`);

const [page1Vendors] = await pool.query(`
    SELECT vendor_id, vendor_name, reliability_score
    FROM vendors
    ORDER BY vendor_name ASC
    LIMIT 15
`);

console.log('purchase_history stats:', stats[0]);
console.log('score distribution:', allScoreDist);
console.log('non-binary stored scores:', vendorScores);
console.log('live perf (with receipt+promised):', perf.slice(0, 5));
console.log('sample PO rows:', samplePO.slice(0, 3));
console.log('\n--- Page 1 vendors (what UI shows) ---');
for (const v of page1Vendors) {
    const live = perfMap[v.vendor_id];
    const stored = v.reliability_score;
    const api = live ?? (stored ?? 100);
    console.log(`${v.vendor_id} | ${String(v.vendor_name).slice(0, 35)} | live: ${live ?? 'none'} | stored: ${stored} | api: ${api}`);
}

await pool.end();
