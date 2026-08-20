import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // Render's build container OOMs (>8GB) because Next.js sizes its build
    // worker pool from the host's full CPU count (observed: 47 workers),
    // not the memory the build plan actually has — each worker is a
    // separate Node process with its own base overhead. Locally, where the
    // detected CPU count is much lower, this never shows up (7 workers,
    // well within memory). Forcing far fewer, busier workers keeps peak
    // memory bounded regardless of what the host reports.
    staticGenerationMinPagesPerWorker: 30,
    webpackMemoryOptimizations: true,
  },
  // The Downloads folder this project lives in has unrelated sibling projects
  // with their own lockfiles (e.g. bun.lockb), which trips Next.js's
  // workspace-root auto-detection. Pin it explicitly to this project.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Phase 10 (P10E) — `pdfkit` resolves its standard-14 font metrics (.afm)
  // files relative to its own `__dirname` at runtime; bundling it into the
  // server function rewrites `__dirname` to a synthetic path that doesn't
  // exist on disk, breaking every PDF render with an ENOENT. Marking it as
  // an external package makes Next.js `require()` it from the real
  // node_modules directory at runtime instead of bundling it — the
  // standard, documented fix for pdfkit under a bundler-based server.
  serverExternalPackages: ["pdfkit"],
  async headers() {
    const scriptSources = [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      "https://cdn.jsdelivr.net",
      ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
    ];
    const contentSecurityPolicy = [
      "default-src 'self'",
      `script-src ${scriptSources.join(" ")}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), browsing-topics=()" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
