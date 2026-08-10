import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultForecastPeriods } from "../lib/forecast-generator.js";

test("last 3 months covers the same 90-day span as Last 3 Months Sales (Aug 2026 → May–Aug)", () => {
    const p = getDefaultForecastPeriods(new Date(2026, 7, 10));
    assert.equal(p.last3Start, "2026-05-01");
    assert.equal(p.last3End, "2026-08-31");
    assert.equal(p.last3Label, "May – Aug 2026");
});

test("last year same quarter stays the upcoming quarter a year earlier", () => {
    const p = getDefaultForecastPeriods(new Date(2026, 7, 10));
    assert.equal(p.lastYearStart, "2025-10-01");
    assert.equal(p.lastYearEnd, "2025-12-31");
    assert.equal(p.lastYearLabel, "Oct – Dec 2025");
});

test("January 90-day span starts in October (Oct–Jan)", () => {
    const p = getDefaultForecastPeriods(new Date(2027, 0, 15));
    assert.equal(p.last3Start, "2026-10-01");
    assert.equal(p.last3End, "2027-01-31");
});
