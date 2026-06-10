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

async function run() {
    const BASE = "http://localhost:3000";
    console.log("Logging in...");
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: env.ACU_USERNAME, password: env.ACU_PASSWORD }),
    });

    if (!loginRes.ok) {
        console.error("Login failed:", await loginRes.text());
        return;
    }

    const cookies = loginRes.headers.getSetCookie();
    const sessionCookie = cookies.find(c => c.startsWith("acu_session="));
    console.log("Logged in. Session:", sessionCookie);

    console.log("Triggering Sync (PO only)...");
    const syncRes = await fetch(`${BASE}/api/sync?inventory=true&sales=false&mode=delta`, {
        method: "POST",
        headers: { "Cookie": sessionCookie }
    });

    if (!syncRes.ok) {
        console.error("Sync failed:", await syncRes.text());
        return;
    }

    const reader = syncRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        console.log(text.trim());
    }
    console.log("Sync script finished.");
}

run().catch(console.error);
