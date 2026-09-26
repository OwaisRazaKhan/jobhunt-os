import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its standard font metrics from its package directory at runtime.
  serverExternalPackages: ["pdfkit"],
  // Search Profiles live under /jobs/profiles; the short /search-profiles URLs point there.
  redirects() {
    return [
      { source: "/search-profiles", destination: "/jobs/profiles", permanent: false },
      { source: "/search-profiles/new", destination: "/jobs/profiles/new", permanent: false },
      {
        source: "/search-profiles/:id([0-9a-fA-F-]{36})",
        destination: "/jobs/profiles/:id/edit",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
