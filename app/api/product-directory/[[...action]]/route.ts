/**
 * Product Directory HTTP API (Next.js / TypeScript).
 *
 * Production (Flutter):
 *   http://190.92.233.232/kgs-purchase/api/product-directory/inventory_browse
 *
 * Local (no base path):
 *   http://localhost:3002/api/product-directory/inventory_browse
 *
 * Actions (POST JSON body unless noted):
 *   GET/POST  .../health | inventory_health
 *   POST      .../browse | inventory_browse          { folder_id? }
 *   POST      .../search | inventory_search          { query, limit? }
 *   POST      .../product | inventory_product        { product_id }
 *   POST      .../folder_create | inventory_folder_create
 *   POST      .../product_create | inventory_product_create
 *   POST      .../folder_delete | inventory_folder_delete
 *   POST      .../product_delete | inventory_product_delete
 *   POST      .../action_log | inventory_action_log
 *   POST      .../action_logs | inventory_action_logs  (admin)
 *
 * Admin mutations need header X-Inventory-Admin-Token when INVENTORY_ADMIN_TOKEN is set.
 */
import { NextResponse } from "next/server";
import {
    ProductDirectoryService,
    PRODUCT_DIRECTORY_ACTIONS,
} from "@/lib/product-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Cookie, X-Inventory-Admin-Token, session_token, X-Session-Id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type RouteContext = { params: Promise<{ action?: string[] }> };

function json(data: unknown, status = 200) {
    return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

function resolveAction(request: Request, params: { action?: string[] }) {
    const { searchParams } = new URL(request.url);
    let action = (searchParams.get("action") || "").trim();

    if (!action && Array.isArray(params?.action) && params.action.length > 0) {
        action = String(params.action[params.action.length - 1] || "").trim();
    }

    return action.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
    if (request.method === "GET" || request.method === "HEAD") {
        const { searchParams } = new URL(request.url);
        const body: Record<string, unknown> = {};
        for (const [key, value] of searchParams.entries()) {
            if (key === "action") continue;
            body[key] = value;
        }
        return body;
    }

    try {
        const text = await request.text();
        if (!text) return {};
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

async function handle(request: Request, context: RouteContext) {
    const params = await context.params;
    let actionKey = resolveAction(request, params);
    const body = await parseBody(request);

    if (!actionKey && body.action) {
        const fromBody = String(body.action)
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "");
        if (PRODUCT_DIRECTORY_ACTIONS[fromBody]) {
            actionKey = fromBody;
        }
    }

    if (!actionKey) {
        actionKey = "health";
    }

    const methodName = PRODUCT_DIRECTORY_ACTIONS[actionKey];
    if (!methodName) {
        return json(
            {
                status: "error",
                message:
                    "Unknown action. Example: /api/product-directory/browse or /api/product-directory/inventory_browse",
            },
            404
        );
    }

    try {
        const handler = ProductDirectoryService[methodName] as (
            body: Record<string, unknown>,
            request?: Request
        ) => Promise<unknown>;
        const needsRequest = [
            "folderCreate",
            "productCreate",
            "folderDelete",
            "productDelete",
            "actionLogsList",
        ].includes(methodName);

        const data = needsRequest
            ? await handler.call(ProductDirectoryService, body, request)
            : await handler.call(ProductDirectoryService, body);

        return json({ status: "success", success: true, data });
    } catch (err: unknown) {
        const e = err as { status?: number; message?: string };
        const status = e?.status || 500;
        console.error(`[product-directory] ${actionKey}:`, err);
        return json(
            {
                status: "error",
                success: false,
                message: e?.message || "Internal server error",
            },
            status
        );
    }
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request, context: RouteContext) {
    return handle(request, context);
}

export async function POST(request: Request, context: RouteContext) {
    return handle(request, context);
}
