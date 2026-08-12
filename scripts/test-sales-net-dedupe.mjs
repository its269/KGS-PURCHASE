/**
 * Ensures net sales SQL ignores duplicate SI-* Credit Memo rows.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SQL_NET_AMOUNT, SQL_NET_QTY } from "../lib/sales-velocity.js";

test("SQL_NET_QTY only subtracts CM-* credit memos", () => {
    assert.match(SQL_NET_QTY, /id LIKE 'CM-%'/);
    assert.match(SQL_NET_AMOUNT, /id LIKE 'CM-%'/);
    assert.doesNotMatch(SQL_NET_QTY, /WHEN order_type = 'Credit Memo' THEN/);
});
