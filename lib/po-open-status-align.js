/**
 * Global Purchase Order Open-status alignment (all vendors / branches).
 * Softie is only one example — never filter by vendor here.
 */
import { AcumaticaService } from "@/services/acumatica";
import { MySqlService } from "@/services/mysql";

const DEFAULT_SINCE = "2024-01-01";

/**
 * Pull every Acumatica Open PO and force local status to match.
 * @param {{ cookie: string, startDate?: string, closeStale?: boolean }} opts
 */
export async function alignAllOpenPurchaseOrderStatuses({
    cookie,
    startDate = DEFAULT_SINCE,
    closeStale = true,
} = {}) {
    if (!cookie || cookie === "__bypass__") {
        return { skipped: true, opened: 0, closed: 0, openSet: 0 };
    }

    await MySqlService.reconcilePurchaseOrderStatuses();

    const since = String(startDate || DEFAULT_SINCE).slice(0, 10);
    const openIds = await AcumaticaService.fetchOpenPurchaseOrderNbrs({
        cookie,
        startDate: since,
    });

    if (!openIds.length) {
        return { skipped: false, opened: 0, closed: 0, openSet: 0 };
    }

    const aligned = await MySqlService.applyAcumaticaOpenPoStatuses(openIds, {
        closeStale,
        sinceDate: since,
    });

    return {
        skipped: false,
        opened: aligned.opened || 0,
        closed: aligned.closed || 0,
        openSet: openIds.length,
        since,
    };
}
