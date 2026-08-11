import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";
import { getDefaultForecastPeriods, isValidYmd, rangeFromMonthInputs } from "@/lib/forecast-generator";
import { refreshForecastSales } from "@/lib/refresh-forecast-sales";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function POST(request) {
    try {
        const cookie = getSessionFromRequest(request);
        if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const defaults = getDefaultForecastPeriods();
        const last3 = rangeFromMonthInputs(body.last3From, body.last3To)
            || (isValidYmd(body.last3Start) && isValidYmd(body.last3End)
                ? { start: body.last3Start, end: body.last3End }
                : { start: defaults.last3Start, end: defaults.last3End });
        const lastYear = rangeFromMonthInputs(body.lyFrom, body.lyTo)
            || (isValidYmd(body.lastYearStart) && isValidYmd(body.lastYearEnd)
                ? { start: body.lastYearStart, end: body.lastYearEnd }
                : { start: defaults.lastYearStart, end: defaults.lastYearEnd });

        const result = await refreshForecastSales({
            last3Start: last3.start,
            last3End: last3.end,
            lastYearStart: lastYear.start,
            lastYearEnd: lastYear.end,
            cookie,
            force: true,
        });

        return NextResponse.json(result, NO_STORE);
    } catch (err) {
        console.error("[Forecast sales-backfill]", err);
        return NextResponse.json({ message: err.message || "Sales backfill failed" }, { status: 500 });
    }
}
