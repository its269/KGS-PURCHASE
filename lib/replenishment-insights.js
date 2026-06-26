const TARGET_DAYS_OF_COVER = 60;
const SAFETY_BUFFER_DAYS = 7;

function urgencyFromPriority(priority) {
    if (priority === "High") return "critical";
    if (priority === "Medium") return "warning";
    return "normal";
}

function formatUnits(n) {
    const val = Number(n);
    if (Number.isNaN(val)) return String(n);
    return val % 1 === 0 ? val.toLocaleString() : val.toFixed(1);
}

/**
 * Build plain-language AI insights for one replenishment row.
 */
export function buildReplenishmentInsight({
    itemId,
    description,
    currentStock,
    suggestedQty,
    priorityLevel,
    branchId,
    ads = 0,
    daysRemaining = null,
    leadTimeDays = 0,
    vendorId = null,
    hasSalesHistory = true,
    qtySold90 = 0,
    targetStock = 0,
}) {
    const isMain = branchId === "MAIN";
    const restockSource = isMain ? "External Vendor (Purchase Order)" : "MAIN Warehouse (Stock Transfer)";
    const urgency = urgencyFromPriority(priorityLevel);

    let headline;
    let summary;
    let whatToDo;
    let stockoutRisk;

    if (!hasSalesHistory) {
        headline = "Low stock, no recent sales";
        summary = `Only ${formatUnits(currentStock)} on hand and no sales in the last 90 days.`;
        whatToDo = isMain
            ? `Optional: order ${formatUnits(suggestedQty)} from vendor if you want to keep this on the shelf.`
            : `Optional: transfer ${formatUnits(suggestedQty)} from MAIN if this branch should carry it.`;
        stockoutRisk = "Low";
    } else if (priorityLevel === "High") {
        headline = `About ${daysRemaining} days of stock left`;
        summary = `Sells ${formatUnits(ads)}/day. Only ${formatUnits(currentStock)} left — may run out soon.`;
        whatToDo = isMain
            ? `Order ${formatUnits(suggestedQty)} from vendor${vendorId ? ` ${vendorId}` : ""} today.`
            : `Transfer ${formatUnits(suggestedQty)} from MAIN to ${branchId} today.`;
        stockoutRisk = "Critical";
    } else if (priorityLevel === "Medium") {
        headline = `About ${daysRemaining} days of stock left`;
        summary = `Sells ${formatUnits(ads)}/day. Stock lasts ~${daysRemaining} days — order before it gets low.`;
        whatToDo = isMain
            ? `Order ${formatUnits(suggestedQty)} from vendor within 1–2 weeks.`
            : `Transfer ${formatUnits(suggestedQty)} from MAIN within 1–2 weeks.`;
        stockoutRisk = "High";
    } else {
        headline = `${daysRemaining} days of stock left`;
        summary = `Sells ${formatUnits(ads)}/day with ${formatUnits(currentStock)} on hand.`;
        whatToDo = isMain
            ? `Add ${formatUnits(suggestedQty)} to your next vendor order.`
            : `Add ${formatUnits(suggestedQty)} to your next transfer from MAIN.`;
        stockoutRisk = "Moderate";
    }

    const metrics = hasSalesHistory
        ? [
              { label: "On hand", value: `${formatUnits(currentStock)} units`, hint: "Current branch stock" },
              { label: "Daily sales", value: `${formatUnits(ads)} / day`, hint: "90-day average" },
              { label: "Days left", value: `${daysRemaining} days`, hint: "At current sales rate" },
              { label: "Order qty", value: `+${formatUnits(suggestedQty)}`, hint: `${TARGET_DAYS_OF_COVER}-day target` },
          ]
        : [
              { label: "On hand", value: `${formatUnits(currentStock)} units`, hint: "Current branch stock" },
              { label: "90-day sales", value: "0 units", hint: "No recorded movement" },
              { label: "Order qty", value: `+${formatUnits(suggestedQty)}`, hint: "Minimum shelf buffer" },
          ];

    if (leadTimeDays > 0 && hasSalesHistory) {
        metrics.push({ label: "Lead time", value: `${leadTimeDays} days`, hint: "Vendor delivery estimate" });
    }

    const howItWorks = buildHowItWorks({
        branchId,
        hasSalesHistory,
        currentStock,
        qtySold90,
        ads,
        daysRemaining,
        targetStock,
        suggestedQty,
        priorityLevel,
        leadTimeDays,
        vendorId,
    });

    return {
        headline,
        summary,
        whatToDo,
        stockoutRisk,
        restockSource,
        urgency,
        metrics,
        howItWorks,
        salesVelocity: ads.toFixed(2),
        daysRemaining: hasSalesHistory ? daysRemaining : "N/A",
        leadTimeDays,
        vendorId,
        targetDays: TARGET_DAYS_OF_COVER,
        formula: hasSalesHistory
            ? `Suggested = (${ads.toFixed(2)} units/day × ${TARGET_DAYS_OF_COVER} days) − ${currentStock} on hand`
            : "Minimum restock for active items with no recent sales",
        message: summary,
    };
}

/**
 * Plain-language AI explanation of how each number was produced.
 */
function buildHowItWorks({
    branchId,
    hasSalesHistory,
    currentStock,
    qtySold90,
    ads,
    daysRemaining,
    targetStock,
    suggestedQty,
    priorityLevel,
    leadTimeDays,
    vendorId,
}) {
    const isMain = branchId === "MAIN";
    const steps = [];

    steps.push({
        title: "Why this item appears",
        text: hasSalesHistory
            ? `This product has sales at ${branchId} and needs restocking to keep about ${TARGET_DAYS_OF_COVER} days of supply on hand.`
            : `This is an active item with low stock (${formatUnits(currentStock)} units) and no sales in the last 90 days. It is shown as an optional minimum shelf buffer.`,
    });

    steps.push({
        title: "Data sources",
        text: `Stock on hand is the quantity at branch ${branchId} (from synced inventory records). Sales history comes from synced Acumatica sales for the same branch (last 90 days).${vendorId ? ` Vendor ${vendorId} is linked to this item for lead-time checks.` : ""}`,
    });

    if (hasSalesHistory) {
        steps.push({
            title: "Sells per day",
            text: `${formatUnits(qtySold90)} units sold in 90 days ÷ 90 = ${ads.toFixed(2)} units per day (average daily sales).`,
        });
        steps.push({
            title: "Days left",
            text: `${formatUnits(currentStock)} in stock ÷ ${ads.toFixed(2)} per day ≈ ${daysRemaining} day(s) before stock may run out at the current sales rate.`,
        });
        steps.push({
            title: "Order quantity",
            text: `Target stock for ${TARGET_DAYS_OF_COVER} days: ${ads.toFixed(2)} × ${TARGET_DAYS_OF_COVER} = ${formatUnits(targetStock)} units. Suggested order: ${formatUnits(targetStock)} − ${formatUnits(currentStock)} on hand = ${formatUnits(suggestedQty)} units.`,
        });

        let statusText;
        if (priorityLevel === "High") {
            statusText = `Marked Urgent because ${daysRemaining} day(s) left is within the reorder window (vendor lead time ${leadTimeDays} day(s) + ${SAFETY_BUFFER_DAYS}-day safety buffer). Order before stock runs out.`;
        } else if (priorityLevel === "Medium") {
            statusText = `Marked "Soon" because stock lasts less than 30 days. Not critical yet, but should be ordered in the next 1–2 weeks.`;
        } else {
            statusText = `Marked "Low" because stock lasts 30+ days but is still below the ${TARGET_DAYS_OF_COVER}-day target. Include in your next routine order.`;
        }
        steps.push({ title: "Status meaning", text: statusText });
    } else {
        steps.push({
            title: "Order quantity",
            text: `No sales trend to calculate from, so a fixed buffer of ${formatUnits(suggestedQty)} units is suggested to keep the item available on the shelf.`,
        });
        steps.push({
            title: "Status meaning",
            text: `Marked "Low" — optional restock only. Review if this branch should still carry the item.`,
        });
    }

    steps.push({
        title: "How to fulfill",
        text: isMain
            ? "At MAIN, restock by creating a Purchase Order to your vendor."
            : `At ${branchId}, restock by requesting a stock transfer from the MAIN warehouse (not directly from vendors).`,
    });

    const preview = hasSalesHistory
        ? `Based on ${formatUnits(qtySold90)} sold in 90 days at ${branchId}.`
        : `Low stock, no recent sales at ${branchId}.`;

    return { preview, steps };
}

/**
 * Build a branch-level briefing for employees.
 */
export function buildBranchBrief(recommendations, branchId) {
    const isMain = branchId === "MAIN";
    const urgent = recommendations.filter((r) => r.priorityLevel === "High");
    const medium = recommendations.filter((r) => r.priorityLevel === "Medium");
    const totalUnits = recommendations.reduce((s, r) => s + (r.suggestedQty || 0), 0);

    if (recommendations.length === 0) {
        return {
            title: "All good — nothing to order",
            body: "",
            action: isMain
                ? "No vendor orders needed right now."
                : "No transfers from MAIN needed right now.",
        };
    }

    if (urgent.length > 0) {
        return {
            title: `${urgent.length} urgent item(s) at ${branchId}`,
            body: "",
            action: isMain
                ? `Order the urgent items first (${totalUnits.toLocaleString()} units total suggested).`
                : `Transfer urgent items from MAIN first (${totalUnits.toLocaleString()} units total suggested).`,
        };
    }

    return {
        title: `${recommendations.length} item(s) to restock at ${branchId}`,
        body: "",
        action: isMain
            ? `Add these to your next vendor order (${totalUnits.toLocaleString()} units total).`
            : `Add these to your next transfer from MAIN (${totalUnits.toLocaleString()} units total).`,
    };
}

export { TARGET_DAYS_OF_COVER, SAFETY_BUFFER_DAYS };
