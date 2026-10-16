import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // public/ is served with max-age=0 because Next cannot know those files are
  // stable. The fonts are: a changed font ships under a new .vN file name.
  async headers() {
    return [
      {
        source: "/fonts/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
