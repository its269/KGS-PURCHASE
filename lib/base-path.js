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

function firstHeaderValue(value) {
  if (!value) return "";
  return value.split(",")[0].trim();
}

/** Hostnames that browsers cannot usefully navigate to (server bind addresses). */
function isUnusableHostname(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  return !host || host === "0.0.0.0" || host === "::" || host === "[::]";
}

/**
 * Build an absolute redirect URL for the browser.
 * Prefer the public Host header over nextUrl (which can be 0.0.0.0 when the
 * process listens on all interfaces). Path may include a query string.
 */
export function buildAppRedirectUrl(request, pathWithQuery = "/") {
  const raw = String(pathWithQuery || "/");
  const qIndex = raw.indexOf("?");
  const pathOnly = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const search = qIndex >= 0 ? raw.slice(qIndex + 1) : "";

  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const hostHeader = firstHeaderValue(request.headers.get("host"));

  let protocol = forwardedProto || request.nextUrl?.protocol?.replace(":", "") || "http";
  if (protocol !== "http" && protocol !== "https") protocol = "http";

  let host = forwardedHost || hostHeader || "";
  let hostnameOnly = host.includes("]")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0];

  if (isUnusableHostname(hostnameOnly.replace(/^\[|\]$/g, ""))) {
    const envBase = process.env.NEXT_PUBLIC_BASE_URL;
    if (envBase) {
      try {
        const envUrl = new URL(envBase);
        if (!isUnusableHostname(envUrl.hostname)) {
          host = envUrl.host;
          if (envUrl.protocol === "http:" || envUrl.protocol === "https:") {
            protocol = envUrl.protocol.replace(":", "");
          }
        }
      } catch {
        /* ignore invalid NEXT_PUBLIC_BASE_URL */
      }
    }
  }

  hostnameOnly = host.includes("]")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0];

  if (isUnusableHostname(hostnameOnly.replace(/^\[|\]$/g, ""))) {
    const portFromHost = host.includes(":") && !host.startsWith("[")
      ? host.split(":").pop()
      : "";
    const port =
      request.nextUrl?.port ||
      portFromHost ||
      process.env.PORT ||
      "3000";
    host = `localhost:${port}`;
  }

  const url = new URL(`${protocol}://${host}`);
  url.pathname = withBasePath(pathOnly);
  url.search = search ? `?${search}` : "";
  return url;
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

/** Expire every cookie sent on this request (full sign-out / reset). */
export function clearAllCookies(request, response) {
  const defaults = getSessionCookieOptions(request, 0);
  const seen = new Set();
  for (const cookie of request.cookies.getAll()) {
    if (seen.has(cookie.name)) continue;
    seen.add(cookie.name);
    response.cookies.set(cookie.name, "", { ...defaults, path: getCookiePath() });
  }
  response.cookies.set("acu_session", "", defaults);
}
