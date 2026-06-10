import mysql from 'mysql2/promise';
import fs from 'fs';
import { resolve } from 'path';

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

const run = async () => {
    const c = await mysql.createConnection({
        host: env.MYSQL_HOST,
        port: parseInt(env.MYSQL_PORT || '3306'),
        user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD,
        multipleStatements: true
    });
    const sql = fs.readFileSync('migrations/004_supplier_performance.sql', 'utf8');
    await c.query(sql);
    console.log('Migration 004 applied: supplier_performance and purchase_history created.');
    await c.end();
};

run().catch(console.error);
