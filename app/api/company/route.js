import { NextResponse } from "next/server";
import {
    getSessionIdFromRequest,
    getActiveCompanyId,
    getSessionMeta,
    setActiveCompany,
    getCompanyErrors,
    getDiscoveredEcomCompany,
} from "@/lib/session-store";
import { connectEcommerceCompany } from "@/lib/company-auth";
import { listCompaniesForClient, isValidCompanyId, isVirtualCompany } from "@/lib/companies";

export async function GET(request) {
    try {
        const sessionId = getSessionIdFromRequest(request);
        if (!sessionId) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        const meta = getSessionMeta(sessionId);
        if (!meta) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        const activeCompanyId = getActiveCompanyId(sessionId);
        const errors = getCompanyErrors(sessionId);
        const payload = listCompaniesForClient(activeCompanyId);
        payload.companies = payload.companies.map((c) => ({
            ...c,
            connected: !!meta.companies?.[c.id],
            virtual: isVirtualCompany(c.id),
            connectionError: errors[c.id] || null,
        }));
        payload.discoveredEcomCompany = getDiscoveredEcomCompany(sessionId);

        return NextResponse.json(payload);
    } catch (err) {
        console.error("[Company API GET]", err);
        return NextResponse.json({ message: "Failed to load companies" }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const sessionId = getSessionIdFromRequest(request);
        if (!sessionId) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        const { companyId } = await request.json();
        if (!isValidCompanyId(companyId)) {
            return NextResponse.json({ message: "Invalid company" }, { status: 400 });
        }

        const meta = getSessionMeta(sessionId);

        if (!meta?.companies?.[companyId]) {
            if (companyId === "ecommerce") {
                const connected = connectEcommerceCompany(sessionId);
                if (!connected.ok) {
                    return NextResponse.json({ message: connected.error }, { status: 400 });
                }
            } else {
                return NextResponse.json(
                    { message: "That company is not connected. Please sign in again." },
                    { status: 400 }
                );
            }
        }

        const ok = setActiveCompany(sessionId, companyId);
        if (!ok) {
            return NextResponse.json({ message: "Failed to switch company" }, { status: 500 });
        }

        const errors = getCompanyErrors(sessionId);
        const updatedMeta = getSessionMeta(sessionId);
        const payload = listCompaniesForClient(companyId);
        payload.companies = payload.companies.map((c) => ({
            ...c,
            connected: !!updatedMeta?.companies?.[c.id],
            virtual: isVirtualCompany(c.id),
            connectionError: errors[c.id] || null,
        }));
        payload.discoveredEcomCompany = getDiscoveredEcomCompany(sessionId);

        return NextResponse.json({ success: true, ...payload });
    } catch (err) {
        console.error("[Company API POST]", err);
        return NextResponse.json({ message: "Failed to switch company" }, { status: 500 });
    }
}
