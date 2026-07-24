import { cookies } from "next/headers";
import { getSession } from "@/lib/session-store";
import { notFound } from "next/navigation";
import SyncingClient from "./SyncingClient";

export const metadata = {
    title: "Data Synchronization | ACU Inventory",
};

export default async function SyncingPage() {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("acu_session")?.value;
    const session = getSession(sessionId);

    // If no active session, act as if the page doesn't exist (404)
    if (!session) {
        notFound();
    }

    return <SyncingClient />;
}
