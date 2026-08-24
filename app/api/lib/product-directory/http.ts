import { NextRequest, NextResponse } from "next/server";
import type { ApiErr, ApiOk } from "./types";

export function ok<T>(data: T, status = 200) {
  const body: ApiOk<T> = { status: "success", success: true, data };
  return NextResponse.json(body, { status });
}

export function fail(status: number, message: string) {
  const body: ApiErr = { status: "error", message };
  return NextResponse.json(body, { status });
}

export async function readJson(
  req: NextRequest,
): Promise<Record<string, unknown>> {
  try {
    const data = await req.json();
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function requireAdmin(req: NextRequest): boolean {
  const token = (process.env.INVENTORY_ADMIN_TOKEN || "").trim();
  if (!token) return true;
  return req.headers.get("x-inventory-admin-token") === token;
}

export function withCors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Cookie, X-Inventory-Admin-Token, session_token, X-Session-Id",
  );
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return res;
}
