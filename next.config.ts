import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // better-sqlite3 is a native module — keep Next.js from trying to bundle it.
  serverExternalPackages: ["better-sqlite3"],
  // Ship the bundled demo database with the deployment (for the read-only Vercel
  // demo). Next.js doesn't include stray data files in the serverless bundle unless
  // we trace them in. Harmless for local/normal use, which reads data/app.db instead.
  outputFileTracingIncludes: {
    "/**": ["./demo/demo.db"],
  },
};

export default nextConfig;
