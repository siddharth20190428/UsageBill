import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the browser talks only to this dev server. Requests to /api are forwarded to the
// FastAPI backend, so there is no CORS to configure and it works the same on localhost and in a
// Codespace (where the backend is reachable from the dev server as localhost:8000).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true, // Codespaces serves the app from a *.app.github.dev hostname
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
