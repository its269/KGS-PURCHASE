/**
 * Product Directory HTTP API (Next.js).
 *
 * Examples:
 *   GET  /api/product-directory/health
 *   POST /api/product-directory/browse
 *   POST /api/product-directory/inventory_browse
 *   POST /api/product-directory/action_log
 *   POST /api/product-directory?action=search
 *
 * Admin mutations (folder/product create/delete, action_logs list) require header
 * X-Inventory-Admin-Token when INVENTORY_ADMIN_TOKEN is set.
 */
import { NextResponse } from "next/server";
import {
    ProductDirectoryService,
    PRODUCT_DIRECTORY_ACTIONS,
} from "@/lib/product-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Cookie, X-Inventory-Admin-Token, session_token, X-Session-Id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data, status = 200) {
    return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

function resolveAction(request, params) {
    const { searchParams } = new URL(request.url);
    let action = (searchParams.get("action") || "").trim();

    if (!action && Array.isArray(params?.action) && params.action.length > 0) {
        action = String(params.action[params.action.length - 1] || "").trim();
    }

    return action.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

async function parseBody(request) {
    if (request.method === "GET" || request.method === "HEAD") {
        const { searchParams } = new URL(request.url);
        const body = {};
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
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

async function handle(request, context) {
    const params = await context.params;
    let actionKey = resolveAction(request, params);
    const body = await parseBody(request);

    // Only use body.action for routing when it maps to a known endpoint.
    // (action_log payloads also send body.action = opened_product|searched|downloaded)
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
        const handler = ProductDirectoryService[methodName];
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
    } catch (err) {
        const status = err?.status || 500;
        console.error(`[product-directory] ${actionKey}:`, err);
        return json(
            {
                status: "error",
                success: false,
                message: err?.message || "Internal server error",
            },
            status
        );
    }
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request, context) {
    return handle(request, context);
}

export async function POST(request, context) {
    return handle(request, context);
}
