import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@paadi/contracts", "@paadi/api-client"]
};

export default nextConfig;
