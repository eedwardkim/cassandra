import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cassandra/shared"],
  poweredByHeader: false,
  agentRules: false,
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
