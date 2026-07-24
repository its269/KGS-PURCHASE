/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  basePath,

  // Allow CI to build into .next-incoming while production keeps serving from .next
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // mysql2 uses native Node.js modules — must not be bundled by Next.js
  serverExternalPackages: ["mysql2", "@supabase/supabase-js"],

  // Standalone output for Windows PM2 production deploy
  output: "standalone",

  // Built-in gzip compression for SSR responses (fallback when Nginx is absent)
  compress: true,

  // Remove the X-Powered-By header to reduce response size + hide stack
  poweredByHeader: false,

  // Aggressive asset caching headers — Nginx will also set these for static files
  async headers() {
    return [
      {
        // Immutable JS/CSS chunks — content-hashed, safe to cache forever
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Public folder assets (fonts, images, icons)
        source: "/:path*.:ext(ico|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|otf|eot)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        // Security headers on every response
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
