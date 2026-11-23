import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The official IAB TSVs are read from disk at runtime; make sure they ship with every serverless function.
  outputFileTracingIncludes: {
    "/**": ["./data/iab/**"],
  },
  // Public API paths are /v1/...; they are served by the route handlers under /api/v1/...
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: "/api/v1/:path*" },
      { source: "/health", destination: "/api/health" },
    ];
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
