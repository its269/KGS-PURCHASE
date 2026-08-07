import { NextResponse } from "next/server";
import { MySqlService } from "@/services/mysql";
import {
    requireLocalUser,
    sanitizeUser,
    hashPassword,
    verifyPassword,
    validateUsername,
    validatePassword,
} from "@/lib/app-users";
import { setLocalUserSession, getSessionIdFromRequest } from "@/lib/session-store";
import { ensureAppUsersReady } from "@/lib/ensure-app-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
    try {
        await ensureAppUsersReady();
        const user = await requireLocalUser(request);
        return NextResponse.json({ user });
    } catch (err) {
        const status = err.status || 500;
        return NextResponse.json({ message: err.message || "Unauthorized" }, { status });
    }
}

export async function PATCH(request) {
    try {
        await ensureAppUsersReady();
        const me = await requireLocalUser(request);
        const body = await request.json();
        const fields = {};

        if (body.username !== undefined) {
            const username = String(body.username || "").trim();
            const userErr = validateUsername(username);
            if (userErr) return NextResponse.json({ message: userErr }, { status: 400 });
            const clash = await MySqlService.getAppUserByUsername(username);
            if (clash && Number(clash.id) !== Number(me.id)) {
                return NextResponse.json({ message: "Username already exists." }, { status: 409 });
            }
            fields.username = username;
        }

        if (body.password !== undefined && body.password !== "") {
            const currentPassword = String(body.currentPassword || "");
            if (!currentPassword) {
                return NextResponse.json({ message: "Current password is required." }, { status: 400 });
            }

            const row = await MySqlService.getAppUserById(me.id);
            if (!row) {
                return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
            }
            if (!verifyPassword(currentPassword, row.password_hash)) {
                return NextResponse.json({ message: "Current password is incorrect." }, { status: 401 });
            }

            const passErr = validatePassword(body.password);
            if (passErr) return NextResponse.json({ message: passErr }, { status: 400 });

            if (String(body.confirmPassword ?? "") !== String(body.password)) {
                return NextResponse.json({ message: "New passwords do not match." }, { status: 400 });
            }

            fields.passwordHash = hashPassword(body.password);
        }

        if (body.fullName !== undefined) fields.fullName = body.fullName;
        if (body.email !== undefined) fields.email = body.email;

        // Non-admins cannot change their own role/active via profile
        await MySqlService.updateAppUser(me.id, fields);
        const updated = await MySqlService.getAppUserById(me.id);
        const sessionId = getSessionIdFromRequest(request);
        if (sessionId) setLocalUserSession(sessionId, sanitizeUser(updated));

        return NextResponse.json({ user: sanitizeUser(updated) });
    } catch (err) {
        const status = err.status || 500;
        return NextResponse.json({ message: err.message || "Failed to update profile" }, { status });
    }
}
