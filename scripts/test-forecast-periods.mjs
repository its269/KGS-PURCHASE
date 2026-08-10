import assert from "node:assert/strict";
import test from "node:test";
import { forecastSoldQty, getDefaultForecastPeriods } from "../lib/forecast-generator.js";
import {
    buildForecastPoStatusFilters,
    openPoHeaderStatuses,
    openPoPrefixMatch,
    openPoPrefixesForDestinations,
    orderNbrFilters,
    poLineOpenQty,
    sqlMatchOpenPoForBranch,
    sqlPoLineOpenQty,
    sqlPoLineOrderQty,
} from "../lib/open-po-match.js";

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

test("forecast sold qty prefers invoices and falls back to historical qty", () => {
    assert.equal(forecastSoldQty(5404, 12696), 5404);
    assert.equal(forecastSoldQty(0, 12696), 12696);
    assert.equal(forecastSoldQty(0, 0), 0);
    assert.equal(forecastSoldQty(null, 20), 20);
});

test("Coming PO prefixes follow the retail branch, not related warehouses only", () => {
    assert.deepEqual(openPoPrefixesForDestinations(["NAGA"]), ["NAGP"]);
    assert.deepEqual(openPoPrefixesForDestinations(["MANILA", "WH1", "MNL-MRILAO"]), ["MNLP"]);
    assert.deepEqual(openPoPrefixesForDestinations(["MAIN", "MAIN WH11"]), ["MPO"]);
    assert.deepEqual(openPoPrefixesForDestinations(["ECOMMERCE", "ECOM"]), ["ECMP"]);
    assert.deepEqual(openPoPrefixesForDestinations(["MNL-MRILAO"]), []);
    const naga = openPoPrefixMatch("h", "d", ["NAGA"]);
    assert.equal(naga.params[0], "NAGP%");
    assert.match(naga.clause, /warehouse_id/);
    assert.match(naga.clause, /LIKE \?/);
});

test("Coming PO open qty matches Acumatica Order/Open Qty (qty on receipts), not the Completed flag", () => {
    assert.equal(poLineOpenQty({ orderQty: 500, receivedQty: 268, completed: false }), 232);
    assert.equal(poLineOpenQty({ orderQty: 100, receivedQty: 0, completed: false }), 100);
    assert.equal(poLineOpenQty({ orderQty: 12, receivedQty: 0, completed: true }), 12);
    assert.equal(poLineOpenQty({ orderQty: 24, receivedQty: 24, completed: true }), 0);
    assert.equal(poLineOpenQty({ orderQty: 12, receivedQty: 1, completed: true }), 11);
});

test("Coming PO branch match includes PO-number prefix even when warehouse is filled", () => {
    const match = sqlMatchOpenPoForBranch({ detailsAlias: "d", headerAlias: "h", destinations: ["ECOMMERCE", "ECOM"] });
    assert.match(match.clause, /warehouse_id/);
    assert.match(match.clause, /purchase_order_dest/);
    assert.ok(match.params.includes("ECMP%"));
    assert.match(match.clause, /h\.order_nbr/);
    assert.equal(sqlPoLineOpenQty("d").includes("received_qty"), true);
    assert.equal(sqlPoLineOpenQty("d").includes("line_completed"), false);
});

test("Forecast Coming PO includes On Hold and uses Acumatica Order Qty", () => {
    const replenish = openPoHeaderStatuses();
    assert.ok(replenish.includes("Open"));
    assert.equal(replenish.includes("On Hold"), false);
    const forecast = openPoHeaderStatuses({ includeOnHold: true });
    assert.ok(forecast.includes("On Hold"));
    assert.ok(forecast.includes("HOLD"));
    assert.equal(sqlPoLineOrderQty("d"), "COALESCE(d.qty, 0)");
});

test("Forecast PO refresh filters Open and On Hold without OR", () => {
    const filters = buildForecastPoStatusFilters({ prefixes: ["ECMP"] });
    assert.deepEqual(filters, [
        "Status eq 'Open' and substringof('ECMP', OrderNbr)",
        "Status eq 'On Hold' and substringof('ECMP', OrderNbr)",
    ]);
    assert.ok(!filters.some((f) => /\bor\b/i.test(f)));
    assert.deepEqual(orderNbrFilters("ECMP260183"), [
        "OrderNbr eq 'ECMP260183'",
        "OrderType eq 'ECMP' and OrderNbr eq '260183'",
    ]);
});
