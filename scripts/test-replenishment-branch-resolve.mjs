import assert from "node:assert/strict";
import test from "node:test";
import {
    isWarehouseLikeAlias,
    isRetailReplenishmentBranch,
    resolveSalesBranchForWarehouse,
} from "../lib/companies.js";

test("MNL-MRILAO is a warehouse stock site, not a POS branch", () => {
    assert.equal(isWarehouseLikeAlias("MNL-MRILAO"), true);
    assert.equal(isRetailReplenishmentBranch("MNL-MRILAO"), false);
});

test("MNL-MRILAO Sells / day resolves to MANILA POS invoices", () => {
    assert.equal(resolveSalesBranchForWarehouse("MNL-MRILAO"), "MANILA");
});

test("retail branches keep their own sales branch", () => {
    assert.equal(resolveSalesBranchForWarehouse("MANILA"), "MANILA");
    assert.equal(resolveSalesBranchForWarehouse("CEBU"), "CEBU");
});
