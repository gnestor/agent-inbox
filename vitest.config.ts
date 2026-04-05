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
    exclude: ["**/node_modules/**", "**/dist/**", "**/*-live.test.ts", "tests/e2e/**", "**/.claude/**"],
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    environmentMatchGlobs: [
      ["src/**/*.test.{ts,tsx}", "jsdom"],
      ["server/**/*.test.ts", "node"],
      ["plugins/**/*.test.{ts,tsx}", "jsdom"],
    ],
    coverage: {
      provider: "v8",
      // Scope coverage to files that have tests — thresholds only apply here.
      // Expand this list as new test files are added.
      include: [
        // Server lib — well-tested modules (>70% coverage)
        "server/lib/auth.ts",
        "server/lib/credential-proxy-ca.ts",
        "server/lib/credentials.ts",
        "server/lib/csrf.ts",
        "server/lib/health.ts",
        "server/lib/logger.ts",
        "server/lib/rate-limit.ts",
        "server/lib/schemas.ts",
        "server/lib/vault.ts",
        "server/lib/workspace-scanner.ts",
        // Server routes
        "server/routes/sessions.ts",
        // Client hooks
        "src/hooks/use-preferences.ts",
        "src/hooks/use-session-mutations.ts",
        "src/hooks/use-session-phase.ts",
        "src/hooks/use-session-view.ts",
        "src/hooks/use-sessions.ts",
        "src/hooks/use-swipe.ts",
        // Client lib
        "src/lib/artifact-transform.ts",
        "src/lib/field-schema.ts",
        "src/lib/logger.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 80,
        lines: 80,
      },
    },
  },
})
