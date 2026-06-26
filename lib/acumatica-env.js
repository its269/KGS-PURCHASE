/**
 * Resolve Acumatica base URL at runtime (not module load) so missing config fails clearly.
 */
export function getAcumaticaBaseUrl() {
    const base = String(process.env.ACUMATICA_BASE_URL || "").trim().replace(/\/$/, "");
    if (!base) {
        throw new Error(
            "Acumatica is not configured on this server (ACUMATICA_BASE_URL is missing). " +
            "An administrator must add it to the production .env file and restart the app."
        );
    }
    return base;
}

export function getAcumaticaCompany() {
    return (
        process.env.ACUMATICA_COMPANY ||
        process.env.ACU_COMPANY ||
        ""
    ).trim();
}
