import { MySqlService } from "@/services/mysql";
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * API Route for Exporting Data to CSV
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const type = searchParams.get("type") || "inventory"; // inventory, po, or vendors
        
        const cookie = getSessionFromRequest(request);
        if (!cookie) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

        let csvContent = "";
        let fileName = "";

        if (type === "inventory") {
            const result = await MySqlService.getStockItems({ page: 1, pageSize: 5000 });
            fileName = `Inventory_Export_${new Date().toISOString().split('T')[0]}.csv`;
            
            // Header
            csvContent = "Inventory ID,Description,Item Class,Status,Unit,Price,Total On Hand,Qty Sold,Total Sales\n";
            
            // Rows
            result.items.forEach(item => {
                const row = [
                    `"${item.inventoryId}"`,
                    `"${(item.description || "").replace(/"/g, '""')}"`,
                    `"${item.itemClass}"`,
                    `"${item.itemStatus}"`,
                    `"${item.baseUnit}"`,
                    item.price,
                    item.totalOnHand,
                    item.totalQtySold,
                    item.totalSales
                ];
                csvContent += row.join(",") + "\n";
            });
        } else if (type === "inventory-levels") {
            const branch = searchParams.get("branch") || "";
            const search = searchParams.get("search") || "";
            const companyId = searchParams.get("companyId") || "main";
            const result = await MySqlService.getInventory({
                page: 1,
                pageSize: 20000,
                branch,
                search,
                companyId,
            });
            fileName = `Inventory_Levels_${new Date().toISOString().split("T")[0]}.csv`;
            csvContent =
                "Inventory ID,Description,Item Class,Branch,On Hand,Available,Safety Stock\n";
            (result.data || []).forEach((item) => {
                const id = item.InventoryID?.value ?? "";
                const desc = String(item.Description?.value ?? "").replace(/"/g, '""');
                const itemClass = String(item.ItemClass?.value ?? "").replace(/"/g, '""');
                const br = String(item.Branch?.value ?? "").replace(/"/g, '""');
                const onHand = item.OnHand?.value ?? 0;
                const available = item.Available?.value ?? "";
                const safety = item.SafetyStock?.value ?? "";
                csvContent += [
                    `"${id}"`,
                    `"${desc}"`,
                    `"${itemClass}"`,
                    `"${br}"`,
                    onHand,
                    available,
                    safety,
                ].join(",") + "\n";
            });
        } else if (type === "po") {
            const result = await MySqlService.getPurchaseOrders({ page: 1, pageSize: 5000 });
            fileName = `PurchaseOrders_Export_${new Date().toISOString().split('T')[0]}.csv`;
            
            // Header
            csvContent = "Order Nbr,Vendor ID,Vendor Name,Status,PO Date,ETD,Received Date,Total Amount\n";
            
            // Rows
            result.orders.forEach(po => {
                const row = [
                    `"${po.orderNbr}"`,
                    `"${(po.vendorId || "").replace(/"/g, '""')}"`,
                    `"${(po.vendorName || "").replace(/"/g, '""')}"`,
                    `"${po.status}"`,
                    po.date ? String(po.date).split('T')[0] : "",
                    po.promisedDate ? String(po.promisedDate).split('T')[0] : "",
                    po.receiptDate ? String(po.receiptDate).split('T')[0] : "",
                    po.totalAmount
                ];
                csvContent += row.join(",") + "\n";
            });
        } else if (type === "vendors") {
            const result = await MySqlService.getVendors({ page: 1, pageSize: 5000 });
            fileName = `Vendors_Export_${new Date().toISOString().split('T')[0]}.csv`;
            
            // Header
            csvContent = "Vendor ID,Vendor Name\n";
            
            // Rows
            result.data.forEach(v => {
                const row = [
                    `"${v.VendorID.value}"`,
                    `"${(v.VendorName.value || "").replace(/"/g, '""')}"`
                ];
                csvContent += row.join(",") + "\n";
            });
        }

        return new Response(csvContent, {
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename="${fileName}"`
            }
        });
    } catch (err) {
        console.error("[Export API Error]", err);
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}
