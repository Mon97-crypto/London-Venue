// Shared HTTP Basic auth check, used by Vercel middleware and the local server.
// Any username works; the password must match APP_PASSWORD. No APP_PASSWORD = open.
export function isAuthorized(authHeader, password = process.env.APP_PASSWORD) {
  if (!password) return true;
  const [scheme, encoded] = String(authHeader ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  try {
    const decoded = atob(encoded);
    return decoded.slice(decoded.indexOf(':') + 1) === password;
  } catch {
    return false;
  }
}

export const AUTH_CHALLENGE = {
  status: 401,
  headers: { 'WWW-Authenticate': 'Basic realm="London Venue RFPs", charset="UTF-8"' },
};
