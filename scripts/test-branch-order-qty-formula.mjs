import assert from "node:assert/strict";
import test from "node:test";
import { averageDailySales, toSignedQty } from "../lib/sales-velocity.js";

/** Mirror of resolveBranchOrderQty (engine uses @/ imports). */
function resolveBranchOrderQty(sellsPerDay, branchStock, comingPoQty = 0) {
    const ads = toSignedQty(sellsPerDay);
    if (ads <= 0) return 0;
    return ads - (toSignedQty(branchStock) + toSignedQty(comingPoQty));
}

function resolveMainOrderQty(mainInventory, totalBranchReplenishment, _mainTargetStock, comingPoQty = 0) {
    return toSignedQty(totalBranchReplenishment) - (toSignedQty(mainInventory) + toSignedQty(comingPoQty));
}

test("BACOLOD row1: 7.5 − (19 + 515) = −526.5", () => {
    assert.equal(resolveBranchOrderQty(7.5, 19, 515), -526.5);
});

test("BACOLOD zero stock: 1.7 − (0 + 0) = 1.7", () => {
    assert.equal(resolveBranchOrderQty(1.7, 0, 0), 1.7);
});

test("Papijet MAIN: 794 − (3147 + 3000) = −5353", () => {
    assert.equal(resolveMainOrderQty(3147, 794, 0, 3000), -5353);
});

test("toSignedQty keeps minus", () => {
    assert.equal(toSignedQty(-5353), -5353);
    assert.equal(averageDailySales(678, 90).toFixed(1), "7.5");
});
