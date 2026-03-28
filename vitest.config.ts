import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@plugins": path.resolve(__dirname, "./plugins"),
    },
  },
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/*-live.test.ts", "tests/e2e/**"],
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    environmentMatchGlobs: [
      ["src/**/*.test.{ts,tsx}", "jsdom"],
      ["server/**/*.test.ts", "node"],
      ["plugins/**/*.test.ts", "node"],
    ],
    coverage: {
      provider: "v8",
      // Scope coverage to files that have tests — thresholds only apply here.
      // Expand this list as new test files are added.
      include: [
        "plugins/gmail/app/lib/email-sanitizer.ts",
        "plugins/gmail/app/lib/gmail.ts",
        "server/lib/cache.ts",
        "server/lib/auth.ts",
        "server/lib/credentials.ts",
        "src/hooks/use-swipe.ts",
        "src/lib/formatters.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 90,
        lines: 80,
      },
    },
  },
})
