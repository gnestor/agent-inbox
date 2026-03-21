import path from "path"
import fs from "fs"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Vite plugin to serve the pre-built @hammies/frontend artifact bundle
function serveArtifactBundle() {
  const bundlePath = path.resolve(__dirname, "../frontend/dist/artifact.mjs")
  return {
    name: "serve-artifact-bundle",
    configureServer(server: any) {
      server.middlewares.use("/@hammies/components.mjs", (_req: any, res: any) => {
        if (!fs.existsSync(bundlePath)) {
          res.statusCode = 404
          res.end("Artifact bundle not built. Run: npm run build:artifact -w packages/frontend")
          return
        }
        res.setHeader("Content-Type", "application/javascript")
        res.setHeader("Cache-Control", "no-cache")
        fs.createReadStream(bundlePath).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveArtifactBundle()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5175,
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:3002",
        changeOrigin: true,
      },
    },
  },
})
