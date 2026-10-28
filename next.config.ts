import type { NextConfig } from "next";

const config: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["better-sqlite3"],
  devIndicators: false,
  poweredByHeader: false,
  // Mark done can carry up to 10 photos or receipts at once; each is still capped at 10 MB.
  experimental: { serverActions: { bodySizeLimit: "45mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      {
        // The service worker must be re-checked on every visit so reminder fixes reach phones.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, max-age=0" }],
      },
    ];
  },
};
export default config;
