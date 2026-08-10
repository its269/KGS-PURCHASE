/**
 * Resolve Acumatica base URL at runtime (not module load) so missing config fails clearly.
 */

/** Strip wrapping quotes left behind by some .env parsers (`'#Secret'` → `#Secret`). */
export function unwrapEnvValue(value) {
    let s = String(value ?? "").trim();
    if (
        s.length >= 2 &&
        ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))
    ) {
        s = s.slice(1, -1);
    }
    return s;
}

export function getAcumaticaBaseUrl() {
    const base = unwrapEnvValue(process.env.ACUMATICA_BASE_URL).replace(/\/$/, "");
    if (!base) {
        throw new Error(
            "Acumatica is not configured on this server (ACUMATICA_BASE_URL is missing). " +
            "An administrator must add it to the production .env file and restart the app."
        );
    }
    return base;
}

export function getAcumaticaCompany() {
    return unwrapEnvValue(
        process.env.ACUMATICA_COMPANY || process.env.ACU_COMPANY || ""
    );
}

/** Distinct ERP login pairs: ACUMATICA_* first, then ACU_* emergency bypass. */
export function getAcumaticaCredentialCandidates() {
    const pairs = [];
    const seen = new Set();
    const add = (user, pass) => {
        const username = unwrapEnvValue(user);
        const password = unwrapEnvValue(pass);
        if (!username || !password) return;
        const key = `${username}\0${password}`;
        if (seen.has(key)) return;
        seen.add(key);
        pairs.push({ username, password });
    };
    add(process.env.ACUMATICA_USERNAME, process.env.ACUMATICA_PASSWORD);
    add(process.env.ACU_USERNAME, process.env.ACU_PASSWORD);
    return pairs;
}
