/**
 * End-to-end sync test: login via BFF, trigger sync, watch output.
 * Usage: node migrations/test-sync.mjs
 */
import fs from "fs";

const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").reduce((acc, line) => {
        const [k, ...v] = line.split("=");
        if (k && !k.trim().startsWith("#")) acc[k.trim()] = v.join("=").trim().replace(/^['"]|['"]$/g, "");
        return acc;
    }, {});

const BASE = "http://localhost:3000";

async function main() {
    // 1. Login via BFF
    console.log("1. Logging in via BFF...");
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: env.ACU_USERNAME, password: env.ACU_PASSWORD }),
    });
    if (!loginRes.ok) {
        const t = await loginRes.text();
        console.error("BFF login failed:", loginRes.status, t.slice(0, 300));
        process.exit(1);
    }
    const loginData = await loginRes.json();
    console.log("   Login response:", JSON.stringify(loginData).slice(0, 200));

    // Extract session cookie
    const sessionCookie = (loginRes.headers.getSetCookie?.() || [])
        .map(c => c.split(";")[0].trim()).join("; ");
    console.log("   Session cookie:", sessionCookie.slice(0, 80));

    // 2. Trigger inventory sync (small test: just inventory, no sales)
    console.log("\n2. Triggering sync...");
    const syncRes = await fetch(`${BASE}/api/sync?inventory=true&sales=false&mode=incremental`, {
        method: "POST",
        headers: { "Cookie": sessionCookie },
    });
    if (!syncRes.ok) {
        console.error("Sync request failed:", syncRes.status, await syncRes.text());
        process.exit(1);
    }

    // 3. Read NDJSON stream
    console.log("3. Reading sync stream...");
    const reader = syncRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    let lastProgress = 0;

    while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) buffer += decoder.decode(value, { stream: !done });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.ping) { process.stdout.write("."); continue; }
                if (msg.section && msg.progress !== lastProgress) {
                    lastProgress = msg.progress;
                    console.log(`   [${msg.section}] ${msg.progress}% — ${msg.details || msg.status || ""}`);
                }
                if (msg.status === "complete") {
                    console.log("\n   COMPLETE:", msg.message);
                }
                if (msg.status === "error") {
                    console.error("\n   ERROR:", msg.message);
                }
            } catch { }
        }
    }
    console.log("\nSync stream ended.");
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
