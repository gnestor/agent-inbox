/// <reference types="vite/client" />

/** Build identifier injected by Vite's `define`. Used as the React Query
 *  persist buster so the persisted cache is discarded on every rebuild. */
declare const __APP_VERSION__: string
