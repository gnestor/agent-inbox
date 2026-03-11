import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/*-live.test.ts"],
    environmentMatchGlobs: [
      ["src/**/*.test.{ts,tsx}", "jsdom"],
      ["server/**/*.test.ts", "node"],
    ],
    coverage: {
      provider: "v8",
      // Scope coverage to files that have tests — thresholds only apply here.
      // Expand this list as new test files are added.
      include: ["server/lib/email-sanitizer.ts", "server/lib/cache.ts", "src/hooks/use-swipe.ts"],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 90,
        lines: 80,
      },
    },
  },
})
