import { TextDecoder } from 'util';

async function run() {
    const BASE = "http://localhost:3000";
    const sessionCookie = "acu_session=c033621c-a6ad-43de-9a8b-de94bb9df851";
    console.log("Retrying Sync with existing session:", sessionCookie);

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
        const text = decoder.decode(value, { stream: true });
        console.log(text.trim());
    }
    console.log("Sync script finished.");
}

run().catch(console.error);
