import path from "path"
import fs from "fs"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Vite plugin to serve pre-built @hammies/frontend artifact assets
// (component bundle, React/ReactDOM ES modules, Tailwind CSS)
function serveArtifactAssets() {
  const distDir = path.resolve(__dirname, "../frontend/dist")
  return {
    name: "serve-artifact-assets",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (!req.url?.startsWith("/@hammies/")) return next()
        const filename = req.url.replace("/@hammies/", "")
        const filePath = path.join(distDir, filename)
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404
          res.end(`Artifact asset not found: ${filename}. Run: npm run build:artifact -w packages/frontend`)
          return
        }
        const ext = path.extname(filename)
        const mimeTypes: Record<string, string> = {
          ".mjs": "application/javascript",
          ".js": "application/javascript",
          ".css": "text/css",
        }
        res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream")
        res.setHeader("Cache-Control", "no-cache")
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveArtifactAssets()],
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
