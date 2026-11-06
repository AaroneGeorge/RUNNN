import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({ registerType: "autoUpdate" })],
  server: {
    proxy: {
      "/api": "http://localhost:2567",
      "/ws": { target: "ws://localhost:2567", ws: true },
    },
  },
});
