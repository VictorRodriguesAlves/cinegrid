import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }];
  },
};

export default config;
