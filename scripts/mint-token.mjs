#!/usr/bin/env node
/**
 * Mint a JWT session token for service / background-loop authentication.
 *
 * The inbox auth migrated from DB-backed opaque tokens (auth_sessions
 * table) to stateless signed JWTs. Background loops (curate-loop,
 * curate-drain, body-extract-loop, rerender-loop) need a valid JWT to
 * call `/api/*`.
 *
 * Reads SESSION_USER_EMAIL from .env (or arg) and signs a JWT for that
 * identity using the same secret the server uses to verify.
 *
 * Usage:
 *   cd packages/inbox && node --env-file=.env scripts/mint-token.mjs
 *   # prints the JWT to stdout
 */

import { signSession } from "@hammies/auth/server"

const email = process.argv[2] || process.env.SESSION_USER_EMAIL || process.env.GOOGLE_OWNER_EMAIL || "grantnestor@gmail.com"
const name = process.env.SESSION_USER_NAME || "Grant Nestor"

const token = await signSession({
  sub: email, // use email as stable subject
  email,
  name,
})
process.stdout.write(token)
