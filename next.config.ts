import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // Render's build container OOMs (>8GB) at "Collecting page data" — that
    // phase's worker count comes from experimental.cpus (next/dist/build/index.js
    // getNumberOfWorkers), which defaults to os.cpus().length - 1
    // (next/dist/server/config-shared.js). Render's build host reports 48
    // logical CPUs to Node even though the container's memory budget is
    // nowhere near enough to back 47 separate worker processes; this
    // machine's much lower detected count is why it never reproduces
    // locally. Pinning cpus low bounds worker count regardless of what the
    // host reports. staticGenerationMinPagesPerWorker/webpackMemoryOptimizations
    // guard the later static-generation/Webpack phases, which the build
    // never previously reached.
    cpus: 2,
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
