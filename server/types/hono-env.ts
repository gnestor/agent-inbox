// Hono app environment — typed context variables
// Use with `new Hono<AppEnv>()` to eliminate `as any` casts on c.get()/c.set()

export type AppEnv = {
  Variables: {
    userEmail: string
    googleAccessToken: string
  }
}
