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
        } else if (type === "po") {
            const result = await MySqlService.getPurchaseOrders({ page: 1, pageSize: 5000 });
            fileName = `PurchaseOrders_Export_${new Date().toISOString().split('T')[0]}.csv`;
            
            // Header
            csvContent = "Order Nbr,Vendor,Status,Date,Total Amount\n";
            
            // Rows
            result.orders.forEach(po => {
                const row = [
                    `"${po.orderNbr}"`,
                    `"${(po.vendorName || po.vendorId || "").replace(/"/g, '""')}"`,
                    `"${po.status}"`,
                    po.date ? po.date.split('T')[0] : "",
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
