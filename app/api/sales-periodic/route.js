import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";

// Robust field extractor helpers
const getF = (obj, k) => {
    if (!obj) return "";
    const key = Object.keys(obj).find(i => i.toLowerCase() === k.toLowerCase());
    if (!key) return "";
    const val = obj[key];
    if (val === null || val === undefined) return "";
    if (Array.isArray(val)) return val; // FIX: Return arrays directly (for Details/Transactions)
    if (typeof val === "object") return val.value ?? "";
    return val;
};

const getAny = (obj, ...keys) => {
    for (const k of keys) {
        const v = getF(obj, k);
        if (v !== "" && v !== null && v !== undefined) return v;
    }
    return "";
};

const ACU_BASE = `${process.env.ACUMATICA_BASE_URL}/entity/Default/20.200.001`;

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const branch = searchParams.get("branch") || "";
        const asOfStr = searchParams.get("asOfDate") || new Date().toISOString().split('T')[0];
        const page = parseInt(searchParams.get("page") || "1");
        const pageSize = parseInt(searchParams.get("pageSize") || "15");

        const asOf = new Date(asOfStr);
        if (isNaN(asOf.getTime())) {
            return NextResponse.json({ message: "Invalid As of Date" }, { status: 400 });
        }

        // Calculate three 30-day periods
        const periods = [];
        const labels = ["Last 30 Days", "31-60 Days Ago", "61-90 Days Ago"];
        
        for (let i = 0; i < 3; i++) {
            const end = new Date(asOf);
            end.setDate(asOf.getDate() - (i * 30));
            const start = new Date(end);
            start.setDate(end.getDate() - 29);

            const startStr = start.toISOString().split('T')[0];
            const endStr = end.toISOString().split('T')[0];

            periods.push({
                key: `P${i + 1}`,
                label: labels[i],
                range: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
                start: startStr,
                end: endStr
            });
        }

        // --- Try MySQL first ---
        try {
            console.log(`[Sales Periodic API] Fetching 90-day analysis from MySQL as of ${asOfStr}`);
            const mysqlResult = await MySqlService.getSalesAnalysis({
                branch,
                periods
            });

            if (mysqlResult && mysqlResult.data && mysqlResult.data.length > 0) {
                return NextResponse.json({
                    ...mysqlResult,
                    months: periods.map(p => ({ key: p.key, label: p.label, range: p.range })),
                    pagination: {
                        totalItems: mysqlResult.data.length,
                        totalPages: Math.ceil(mysqlResult.data.length / pageSize)
                    },
                    source: "mysql"
                });
            }
        } catch (mysqlErr) {
            console.error("[Sales Periodic API] MySQL Error, will try Acumatica fallback:", mysqlErr.message);
        }

        // --- Fallback: fetch live from Acumatica ---
        const cookie = getSessionFromRequest(request);
        if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

        if (cookie === "__bypass__") {
            return NextResponse.json({
                data: [],
                months: periods.map(p => ({ key: p.key, label: p.label, range: p.range })),
                metrics: { totalRevenue: 0, uniqueProducts: 0, totalQtySold: 0 },
                pagination: { totalItems: 0, totalPages: 0 },
                source: "mysql-bypass-empty"
            });
        }

        console.log(`[Sales Periodic API] Fallback: Live fetch from Acumatica for 90 days`);
        
        // Fetch full 90-day range
        const overallStart = periods[2].start;
        const overallEnd = periods[0].end;

        const filter = `$filter=Date ge datetimeoffset'${overallStart}T00:00:00Z' and Date le datetimeoffset'${overallEnd}T23:59:59Z'`;
        
        let rawInvoices = [];
        let skip = 0;
        while (true) {
            const url = `${ACU_BASE}/SalesInvoice?$expand=Details&$top=100&$skip=${skip}&${filter}&$orderby=Date desc`;
            const res = await AcumaticaService.fetchWithRetry(url, cookie);
            const data = await res.json();
            const val = data.value || (Array.isArray(data) ? data : []);
            rawInvoices = rawInvoices.concat(val);
            if (val.length < 100) break;
            skip += 100;
        }

        // Aggregation logic for live fetch
        const grouped = {};
        let totalRevenue = 0;
        let totalQtySold = 0;

        for (const inv of rawInvoices) {
            const dateStr = getAny(inv, "Date", "DocumentDate");
            if (!dateStr) continue;
            const docDate = new Date(dateStr).toISOString().split('T')[0];

            const hBranch = getAny(inv, "Branch", "BranchID", "SiteID", "LinkBranch");
            const rawDetails = inv.Details || inv.Transactions || inv.DocumentDetails || inv.value || [];
            const details = Array.isArray(rawDetails) ? rawDetails : (rawDetails.value || []);

            for (const line of details) {
                const invId = String(getAny(line, "InventoryID")).trim();
                if (!invId) continue;

                const lBranch = String(getAny(line, "BranchID") || hBranch || "").trim();
                if (branch && branch !== "All Branches" && lBranch !== branch) continue;

                const groupKey = `${invId}|${lBranch}`;
                if (!grouped[groupKey]) {
                    grouped[groupKey] = {
                        inventoryId: invId,
                        branchName: lBranch,
                        description: getAny(line, "Description") || "—",
                        monthlyData: {},
                        totalQty: 0,
                        totalSales: 0
                    };
                    periods.forEach(p => { grouped[groupKey].monthlyData[p.key] = { qty: 0, sales: 0 }; });
                }

                let qty = Math.abs(Number(getAny(line, "Qty") || 0));
                let sales = Math.abs(Number(getAny(line, "Amount") || 0));

                // Assign to period
                const period = periods.find(p => docDate >= p.start && docDate <= p.end);
                if (period && grouped[groupKey].monthlyData[period.key]) {
                    grouped[groupKey].monthlyData[period.key].qty += qty;
                    grouped[groupKey].monthlyData[period.key].sales += sales;
                    grouped[groupKey].totalQty += qty;
                    grouped[groupKey].totalSales += sales;
                    totalRevenue += sales;
                    totalQtySold += qty;
                }
            }
        }

        const finalResults = Object.values(grouped).sort((a, b) => b.totalSales - a.totalSales);

        return NextResponse.json({
            data: finalResults,
            months: periods.map(p => ({ key: p.key, label: p.label, range: p.range })),
            metrics: { totalRevenue, uniqueProducts: finalResults.length, totalQtySold },
            pagination: {
                totalItems: finalResults.length,
                totalPages: Math.ceil(finalResults.length / pageSize)
            },
            source: "acumatica"
        });

    } catch (err) {
        console.error("[Periodic Sales API Error]", err);
        return NextResponse.json({ message: "Error processing sales" }, { status: 500 });
    }
}
