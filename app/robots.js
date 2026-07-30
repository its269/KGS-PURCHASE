import { getBasePath } from "@/lib/base-path";

function getSiteOrigin() {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
  ].filter(Boolean);

  for (const raw of candidates) {
    try {
      return new URL(raw).origin;
    } catch {
      /* ignore invalid URL */
    }
  }

  return "http://localhost:3000";
}

export default function robots() {
  const origin = getSiteOrigin();
  const base = getBasePath();
  const sitemapUrl = `${origin}${base}/sitemap.xml`;

  return {
    rules: {
      userAgent: "*",
      allow: [`${base}/signin`, "/signin"],
      disallow: [
        `${base}/api/`,
        "/api/",
        `${base}/syncing`,
        "/syncing",
      ],
    },
    sitemap: sitemapUrl,
  };
}
