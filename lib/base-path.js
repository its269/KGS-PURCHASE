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
