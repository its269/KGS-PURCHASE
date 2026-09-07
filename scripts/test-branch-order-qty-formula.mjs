import assert from "node:assert/strict";
import test from "node:test";
import { toSignedQty } from "../lib/sales-velocity.js";

function resolveBranchOrderQty(sellsPerDay, branchStock, comingPoQty = 0) {
    const ads = toSignedQty(sellsPerDay);
    if (ads <= 0) return 0;
    return Math.round(ads - (toSignedQty(branchStock) + toSignedQty(comingPoQty)));
}

test("BACOLOD: round(86.3 − (0 + 506)) = −420", () => {
    assert.equal(resolveBranchOrderQty(86.3, 0, 506), -420);
});

test("BACOLOD: round(28.5 − (128 + 0)) = −99", () => {
    assert.equal(resolveBranchOrderQty(28.5, 128, 0), -99);
});

test("near-zero rounds to 0", () => {
    assert.equal(resolveBranchOrderQty(0.0222, 0, 0), 0);
});

test("positive when sells exceed available", () => {
    assert.equal(resolveBranchOrderQty(10, 2, 1), 7);
});
