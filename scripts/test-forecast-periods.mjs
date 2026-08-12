import assert from "node:assert/strict";
import test from "node:test";
import { computeForecastFields, forecastSoldQty, getDefaultForecastPeriods, listMonthsInRange, monthInvoiceCoverageComplete } from "../lib/forecast-generator.js";
import { netQtySold } from "../lib/sales-velocity.js";
import {
    buildForecastPoStatusFilters,
    openPoHeaderStatuses,
    openPoPrefixMatch,
    openPoPrefixesForDestinations,
    orderNbrFilters,
    poLineOpenQty,
    sqlMatchOpenPoForBranch,
    sqlPoLineOpenQty,
} from "../lib/open-po-match.js";

test("last 3 months are the 3 complete months before current (Aug → May–Jul per SVG)", () => {
    const p = getDefaultForecastPeriods(new Date(2026, 7, 10));
    assert.equal(p.last3Start, "2026-05-01");
    assert.equal(p.last3End, "2026-07-31");
    assert.equal(p.last3Label, "May – Jul 2026");
});

test("last year same quarter stays the upcoming quarter a year earlier", () => {
    const p = getDefaultForecastPeriods(new Date(2026, 7, 10));
    assert.equal(p.lastYearStart, "2025-10-01");
    assert.equal(p.lastYearEnd, "2025-12-31");
    assert.equal(p.lastYearLabel, "Oct – Dec 2025");
});

test("January last 3 months are Oct–Dec of prior year", () => {
    const p = getDefaultForecastPeriods(new Date(2027, 0, 15));
    assert.equal(p.last3Start, "2026-10-01");
    assert.equal(p.last3End, "2026-12-31");
});

test("SVG 4th-quarter example years map to May–Jul and prior Oct–Dec", () => {
    const p = getDefaultForecastPeriods(new Date(2024, 7, 15));
    assert.equal(p.last3Start, "2024-05-01");
    assert.equal(p.last3End, "2024-07-31");
    assert.equal(p.lastYearStart, "2023-10-01");
    assert.equal(p.lastYearEnd, "2023-12-31");
});

test("forecast sold qty prefers invoices and falls back to historical qty", () => {
    assert.equal(forecastSoldQty(5404, 12696), 5404);
    assert.equal(forecastSoldQty(0, 12696), 12696);
    assert.equal(forecastSoldQty(0, 0), 0);
    assert.equal(forecastSoldQty(null, 20), 20);
});

test("buffer amount is buffer inventory times SRP", () => {
    const row = computeForecastFields({
        last3MonthsQty: 10,
        lastYearQty: 8,
        srp: 35,
        bufferInventory: 4,
    });
    assert.equal(row.bufferInventory, 4);
    assert.equal(row.bufferAmount, 140);
    assert.equal(row.estimatedSalesAmount, (10 + 4) * 35);
});

test("Forecast picker ranges include every calendar month", () => {
    assert.deepEqual(listMonthsInRange("2026-05-01", "2026-07-31"), [
        "2026-05", "2026-06", "2026-07",
    ]);
    assert.deepEqual(listMonthsInRange("2025-10-01", "2025-12-31"), [
        "2025-10", "2025-11", "2025-12",
    ]);
});

test("sales month coverage requires invoices near both ends of the month", () => {
    const asOf = new Date(2026, 7, 10);
    assert.equal(monthInvoiceCoverageComplete("2026-06", "2026-06-01", "2026-06-30", 100, asOf), true);
    assert.equal(monthInvoiceCoverageComplete("2026-06", "2026-06-01", "2026-06-07", 50, asOf), false);
    assert.equal(monthInvoiceCoverageComplete("2026-06", "2026-06-01", "2026-06-30", 0, asOf), false);
    assert.equal(monthInvoiceCoverageComplete("2026-02", "2026-02-02", "2026-02-26", 10, asOf), true);
    assert.equal(monthInvoiceCoverageComplete("2026-08", "2026-08-01", "2026-08-10", 20, asOf), true);
    assert.equal(monthInvoiceCoverageComplete("2026-08", "2026-08-01", "2026-08-05", 20, asOf), false);
    // MySQL DATE arriving as prior-day 16:00Z must still count as Jul 1 / Jul 14
    assert.equal(
        monthInvoiceCoverageComplete(
            "2026-07",
            new Date("2026-06-30T16:00:00.000Z"),
            new Date("2026-07-14T16:00:00.000Z"),
            100,
            asOf
        ),
        false
    );
    assert.equal(
        monthInvoiceCoverageComplete(
            "2026-07",
            new Date("2026-06-30T16:00:00.000Z"),
            new Date("2026-07-30T16:00:00.000Z"),
            100,
            asOf
        ),
        true
    );
});

test("Forecast period qty prefers net sold, falls back to invoice gross", () => {
    assert.equal(netQtySold(186 - 20), 166);
    assert.equal(netQtySold(-23), 0);
    // Invoice 35184 − CM-* 459 = 34725 (ignore duplicate SI-* credit memos)
    assert.equal(netQtySold(34725) || forecastSoldQty(35184, 0), 34725);
    assert.equal(netQtySold(0) || forecastSoldQty(100, 0), 100);
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

test("Forecast Coming PO matches Replenishment: Open only, remaining qty", () => {
    const forecast = openPoHeaderStatuses();
    assert.ok(forecast.includes("Open"));
    assert.equal(forecast.includes("On Hold"), false);
    assert.equal(forecast.includes("HOLD"), false);
    assert.equal(sqlPoLineOpenQty("d").includes("received_qty"), true);
    assert.equal(sqlPoLineOpenQty("d").includes("line_completed"), false);
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
