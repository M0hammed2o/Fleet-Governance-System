import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The Downloads folder this project lives in has unrelated sibling projects
  // with their own lockfiles (e.g. bun.lockb), which trips Next.js's
  // workspace-root auto-detection. Pin it explicitly to this project.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
