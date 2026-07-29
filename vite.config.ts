import path from "path"
import fs from "fs"
import { execFileSync } from "child_process"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { loadHttpsConfig } from "@hammies/frontend/vite/server"

/** Build identifier injected into the client as __APP_VERSION__.
 *  Used as the React Query persist buster — cache is discarded whenever
 *  this changes, so a rebuild after pulling new code invalidates stale
 *  persisted query data without asking users to clear site data. */
function resolveAppVersion(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return `dev-${Date.now()}`
  }
}

// Vite plugin to serve pre-built @hammies/frontend artifact assets
// (component bundle, React/ReactDOM ES modules, Tailwind CSS)
function serveArtifactAssets() {
  const distDir = path.resolve(__dirname, "../frontend/dist")
  return {
    name: "serve-artifact-assets",
    configureServer(server: unknown) {
      server.middlewares.use((req: unknown, res: unknown, next: unknown) => {
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

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, "../.."), "")
  const env = { ...rootEnv, ...loadEnv(mode, process.cwd(), "") }

  return {
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  plugins: [react(), tailwindcss(), serveArtifactAssets()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@plugins": path.resolve(__dirname, "./plugins"),
    },
    // Ensure a single copy of React when @hammies/frontend resolves from a
    // different node_modules tree (e.g. worktrees, symlinked packages).
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react-dom") || id.includes("react-router") || (id.includes("/react/") && !id.includes("react-markdown"))) return "vendor"
            if (id.includes("@tiptap") || id.includes("tiptap-markdown") || id.includes("prosemirror")) return "editor"
            if (id.includes("highlight.js") || id.includes("rehype-highlight") || id.includes("lowlight")) return "markdown"
            if (id.includes("@babel/standalone")) return "babel"
          }
        },
      },
    },
  },
  server: {
    // Overridable so a SECOND instance (a worktree checkout) can run alongside
    // the main checkout's dev server instead of fighting it for the port —
    // mirrors Studio's STUDIO_VITE_PORT/STUDIO_PORT. Defaults are unchanged.
    port: Number(env.INBOX_VITE_PORT) || 5175,
    strictPort: true,
    // Bind all interfaces by default. Inbox's Tailscale Serve is on the BARE
    // host (:443 → localhost:5175), a different port from Vite's, so tailscaled
    // doesn't claim :5175 and 0.0.0.0 is safe. Set INBOX_VITE_HOST=127.0.0.1 only
    // if Serve is ever moved to front :5175 directly (then 0.0.0.0 would collide,
    // as it does for Studio/Vision whose Serve is same-port). See those configs.
    host: env.INBOX_VITE_HOST || true,
    allowedHosts: true,
    https: loadHttpsConfig(env),
    proxy: {
      "/api": {
        // Must follow INBOX_PORT so a second instance proxies to ITS OWN Hono
        // server, not the main checkout's.
        target: `http://localhost:${Number(env.INBOX_PORT) || 3002}`,
        changeOrigin: true,
        // Required: without ws:true the /api/ws upgrade is HTTP-proxied and
        // fails silently, so the multiplexed session WebSocket never connects in dev.
        ws: true,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            if ("code" in err && (err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
              if (res && "writeHead" in res) {
                ;(res as import("http").ServerResponse).writeHead(503).end("Server starting…")
              }
              return
            }
            console.error("[proxy]", err.message)
          })
        },
      },
    },
  }
}})
