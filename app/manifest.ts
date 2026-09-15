import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Delta Auto Intelligence",
    short_name: "Delta Auto",
    description: "Live Tekmetric intelligence for Delta Auto & Towing.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b1219",
    theme_color: "#3d7eb8",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
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
