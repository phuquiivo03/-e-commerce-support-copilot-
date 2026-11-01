import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared package ships TypeScript sources and is transpiled by Next.
  transpilePackages: ["@copilot/shared"],
  // The workspace is fully dynamic (auth via cookies on every page), so the
  // experimental cache-components mode is disabled for predictable behavior.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
