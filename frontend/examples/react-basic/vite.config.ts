import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@mapper/client": new URL("../../packages/client/src/index.ts", import.meta.url).pathname,
      "@mapper/core": new URL("../../packages/core/src/index.ts", import.meta.url).pathname,
      "@mapper/upload": new URL("../../packages/upload/src/index.ts", import.meta.url).pathname,
      "@mapper/react": new URL("../../packages/react/src/index.tsx", import.meta.url).pathname,
      "@mapper/react/styles.css": new URL("../../packages/react/src/styles.css", import.meta.url).pathname
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/mapper": "http://127.0.0.1:8787"
    }
  }
});
