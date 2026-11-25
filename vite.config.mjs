import { defineConfig } from "vite";
export default defineConfig({
  root: "desktop/renderer",
  base: "./",
  server: { host: "127.0.0.1", allowedHosts: ["terminal.local"] },
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});
