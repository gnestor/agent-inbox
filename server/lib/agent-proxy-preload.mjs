/**
 * Preloaded via NODE_OPTIONS=--import in agent subprocesses.
 * Sets up undici's global dispatcher to route all fetch() calls through the
 * credential proxy, which injects Bearer tokens for intercepted hosts.
 *
 * Must be .mjs (ES module) so --import works without a package.json "type" field.
 */
import { ProxyAgent, setGlobalDispatcher } from "undici"

if (process.env.HTTPS_PROXY) {
  const proxyUrl = new URL(process.env.HTTPS_PROXY)
  // undici doesn't parse credentials from the URI automatically — set explicitly.
  // NODE_EXTRA_CA_CERTS is already set by the inbox server and Node.js appends
  // it to the system CA bundle natively, so no need to pass it to undici here.
  setGlobalDispatcher(new ProxyAgent({
    uri: `${proxyUrl.protocol}//${proxyUrl.host}`,
    token: `Basic ${Buffer.from(proxyUrl.username + ":").toString("base64")}`,
  }))
}
