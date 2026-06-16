import type { MetadataRoute } from "next";

// Served by Next.js at /manifest.webmanifest and auto-linked in <head>.
// App Router reads this file automatically — no <link rel="manifest"> needed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YachtPics Broker Portal",
    short_name: "YachtPics",
    description: "Professional photo delivery and slideshow platform for yacht brokers.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1f33",
    theme_color: "#0b1f33",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
