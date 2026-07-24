import { MySqlService } from "@/services/mysql";
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-store";

/**
 * Handle persistent user annotations (ETAs, Statuses, Lead Times)
 */
export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const moduleName = searchParams.get("module");

        if (!moduleName) {
            return NextResponse.json({ message: "Module name is required" }, { status: 400 });
        }

        const annotations = await MySqlService.getAnnotations(moduleName);
        return NextResponse.json(annotations);
    } catch (err) {
        console.error("[Annotations API GET Error]", err);
        return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        // Optional: Check session if you want to restrict editing
        const session = getSessionFromRequest(req);
        if (!session) {
            // We'll allow it for now as per current project setup, but usually 401
            // return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { module: moduleName, refId, fieldKey, fieldValue } = body;

        if (!moduleName || !refId || !fieldKey) {
            return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
        }

        const success = await MySqlService.upsertAnnotation(moduleName, refId, fieldKey, fieldValue);
        
        if (success) {
            return NextResponse.json({ message: "Annotation saved" });
        } else {
            return NextResponse.json({ message: "Failed to save annotation" }, { status: 500 });
        }
    } catch (err) {
        console.error("[Annotations API POST Error]", err);
        return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
}
