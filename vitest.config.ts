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
        // Server lib
        "server/lib/auth.ts",
        "server/lib/cache.ts",
        "server/lib/credentials.ts",
        "server/lib/credential-proxy.ts",
        "server/lib/email-sanitizer.ts",
        "server/lib/gmail.ts",
        "server/lib/integrations.ts",
        "server/lib/plugin-loader.ts",
        "server/lib/render-output-tool.ts",
        "server/lib/schemas.ts",
        "server/lib/session-manager.ts",
        "server/lib/title-generator.ts",
        "server/lib/vault.ts",
        // Server routes
        "server/routes/sessions.ts",
        // Client hooks
        "src/hooks/use-navigation.ts",
        "src/hooks/use-plugins.ts",
        "src/hooks/use-preferences.ts",
        "src/hooks/use-session-stream.ts",
        "src/hooks/use-sessions.ts",
        "src/hooks/use-swipe.ts",
        "src/hooks/use-user.ts",
        // Client lib
        "src/lib/artifact-transform.ts",
        "src/lib/field-schema.ts",
        "src/lib/formatters.ts",
        "src/lib/navigation-storage.ts",
        "src/lib/session-pipeline.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 85,
        lines: 80,
      },
    },
  },
})
