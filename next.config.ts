import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
