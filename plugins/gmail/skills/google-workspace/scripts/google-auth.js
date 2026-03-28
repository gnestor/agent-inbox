/**
 * Shared Google OAuth2 token refresh helper.
 * All Google skills import this file to get a fresh access token.
 * Requires env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 */

let _accessToken = null;
let _tokenExpiry = 0;

export async function getGoogleAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry - 60_000) return _accessToken;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error_description ?? data.error ?? 'Token refresh failed');
  _accessToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in ?? 3600) * 1000;
  return _accessToken;
}
