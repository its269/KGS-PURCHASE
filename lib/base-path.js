/** Base path for production (/kgs-purchase) — empty in local dev. */

export function getBasePath() {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  if (!base || base === "/") return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

/** Prefix an app-relative path with the configured base path. */
export function withBasePath(path) {
  const base = getBasePath();
  if (!path) return base || "/";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!base) return normalized;
  return `${base}${normalized}`;
}

/** Cookie path scoped to this app (avoids collision with CMS at /). */
export function getCookiePath() {
  const base = getBasePath();
  return base || "/";
}

/** True when the incoming request is HTTPS (or behind an HTTPS proxy). */
export function isSecureRequest(request) {
  const override = process.env.COOKIE_SECURE;
  if (override === "true") return true;
  if (override === "false") return false;

  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0].trim().toLowerCase() === "https";
  }

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Shared options for the acu_session auth cookie. */
export function getSessionCookieOptions(request, maxAge) {
  return {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax",
    path: getCookiePath(),
    maxAge,
  };
}
