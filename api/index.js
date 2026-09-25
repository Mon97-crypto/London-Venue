// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json).
import app from '../lib/app.js';

export default function handler(req, res) {
  // Vercel normally keeps the original URL on rewrites; rebuild it from the
  // rewrite's ?path= param just in case it arrives as /api?path=...
  if (!req.url.startsWith('/api/')) {
    const url = new URL(req.url, 'http://localhost');
    const sub = url.searchParams.get('path');
    if (sub) {
      url.searchParams.delete('path');
      req.url = `/api/${sub}${url.search}`;
    }
  }
  return app(req, res);
}
