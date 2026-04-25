import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mammoth"],
  compress: false,
};

export default nextConfig;
