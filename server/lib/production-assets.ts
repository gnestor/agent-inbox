import { existsSync } from "node:fs"
import { serveStatic } from "@hono/node-server/serve-static"
import type { Env, Hono } from "hono"

interface ProductionAssetPaths {
  inboxDistPath: string
  artifactDistPath: string
}

/** Mount the shared artifact runtime before the Inbox SPA fallback can answer
 * those module requests with index.html. */
export function mountProductionAssets<E extends Env>(
  app: Hono<E>,
  paths: ProductionAssetPaths,
): void {
  if (existsSync(paths.artifactDistPath)) {
    app.use(
      "/@hammies/*",
      serveStatic<E>({
        root: paths.artifactDistPath,
        rewriteRequestPath: (requestPath) => requestPath.replace(/^\/@hammies\//, "/"),
      }),
    )
  }

  if (existsSync(paths.inboxDistPath)) {
    app.use("/*", serveStatic<E>({ root: paths.inboxDistPath }))
    app.get("/*", serveStatic<E>({ root: paths.inboxDistPath, path: "index.html" }))
  }
}
