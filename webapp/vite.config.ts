import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/ring.svg"],
      manifest: {
        name: "Colmi Ring Tools",
        short_name: "Ring Tools",
        description:
          "Connect to a Colmi R02/R06-family smart ring over Bluetooth and view its data and history.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          { src: "icons/ring.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
          { src: "icons/ring.svg", type: "image/svg+xml", sizes: "any", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell only — live ring data always needs a real BLE connection,
        // so we don't try to cache/replay API-style responses.
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      },
    }),
  ],
});
