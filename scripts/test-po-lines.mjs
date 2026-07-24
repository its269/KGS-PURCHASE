import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const base = process.env.ACUMATICA_BASE_URL;
const user = process.env.ACUMATICA_USERNAME || process.env.ACU_USERNAME;
const pass = process.env.ACUMATICA_PASSWORD || process.env.ACU_PASSWORD;
const company = process.env.ACUMATICA_COMPANY || process.env.ACU_COMPANY;

const loginRes = await fetch(`${base}/entity/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: user, password: pass, company }),
});
const cookies = (loginRes.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");

function parseOrderNbr(full) {
    const m = full.match(/^([A-Z]+)(\d+)$/);
    if (m) return { orderType: m[1], orderNbr: m[2] };
    return { orderType: null, orderNbr: full };
}

const testOrders = ["MNLP260480", "DVOP260057", "MPO260308"];

for (const full of testOrders) {
    const { orderType, orderNbr } = parseOrderNbr(full);
    const filters = [
        `OrderNbr eq '${full}'`,
        orderType ? `OrderType eq '${orderType}' and OrderNbr eq '${orderNbr}'` : null,
        orderType ? `OrderType eq '${orderType}'` : null,
    ].filter(Boolean);

    for (const f of filters) {
        const url = `${base}/entity/Default/20.200.001/PurchaseOrder?$expand=Details&$top=1&$filter=${encodeURIComponent(f)}`;
        const res = await fetch(url, { headers: { Cookie: cookies, Accept: "application/json" } });
        const data = await res.json();
        let details = data.value?.[0]?.Details || [];
        if (details?.value) details = details.value;
        const count = data.value?.length ?? 0;
        const lines = Array.isArray(details) ? details.length : 0;
        if (count > 0) {
            const po = data.value[0];
            console.log(`\n${full} FOUND with filter: ${f}`);
            console.log("  API OrderNbr:", po.OrderNbr?.value ?? po.OrderNbr);
            console.log("  API OrderType:", po.OrderType?.value ?? po.OrderType);
            console.log("  Lines:", lines);
            if (lines > 0) {
                const line = details[0];
                console.log("  Sample:", line.InventoryID?.value ?? line.InventoryID, line.LineDescription?.value ?? line.LineDescription);
            }
            break;
        }
    }
}
