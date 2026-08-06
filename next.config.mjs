/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  experimental: {
    // Don't reuse the client-side router cache for pages when navigating —
    // always refetch from the server so freshly added data (new galleries,
    // listings, recipients, etc.) shows immediately instead of only after a
    // manual refresh. Our data pages are already `dynamic = "force-dynamic"`,
    // so the server render is fresh; this makes the client honor it.
    staleTimes: {
      dynamic: 0,
      static: 0,
    },
  },
  // Authenticated areas must never be cached by the browser or an intermediary.
  // Without this, a stale admin page could come back from the HTTP cache — a
  // newly created gallery missing from the list, or its photos missing because
  // the signed image URLs were baked into older HTML. That's what forced a
  // hard-refresh (Ctrl+Shift+R) to see fresh data.
  async headers() {
    return [
      {
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" }],
      },
      {
        source: "/dashboard/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
