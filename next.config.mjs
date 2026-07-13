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
};

export default nextConfig;
