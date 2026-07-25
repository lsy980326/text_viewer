import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

function keepOnlyWoff2FontSources() {
  return {
    name: "novelier-fontsource-woff2-only",
    enforce: "pre" as const,
    transform(source: string, id: string) {
      if (
        !id.includes("@fontsource/noto-serif-kr/400.css") &&
        !id.includes("@fontsource/noto-serif-kr/500.css")
      ) {
        return null;
      }

      return source.replace(
        /,\s*url\([^)]*\.woff\)\s*format\((['"])woff\1\)/g,
        "",
      );
    },
  };
}

export default defineConfig({
  plugins: [keepOnlyWoff2FontSources(), react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2021", "chrome105", "safari13"],
    minify: process.env.TAURI_DEBUG ? false : "oxc",
    sourcemap: Boolean(process.env.TAURI_DEBUG),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.test.ts"],
    exclude: [".pnpm-store/**", "node_modules/**", "tests/**"],
    css: true,
  },
});
