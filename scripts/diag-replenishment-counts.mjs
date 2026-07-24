import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const BASE = "http://localhost:3000";
const user = process.env.ACU_USERNAME || process.env.ACUMATICA_USERNAME;
const pass = process.env.ACU_PASSWORD || process.env.ACUMATICA_PASSWORD;

const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
});
const cookie = (login.headers.get("set-cookie") || "").match(/acu_session=([^;]+)/)?.[1];
const headers = { Cookie: `acu_session=${cookie}` };

const branches = ["MAIN", "CEBU", "BACOLOD", "DAVAO", "SKYTECHMNL", "TECH-CEBU", "MNL-MRILAO", "CDO", "ILOILO"];
for (const b of branches) {
    const res = await fetch(`${BASE}/api/replenishment?branch=${encodeURIComponent(b)}`, { headers });
    const data = await res.json();
    console.log(`${b.padEnd(14)} recs=${data.recommendations?.length ?? 0} excluded=${data.meta?.excluded ?? false}`);
}
