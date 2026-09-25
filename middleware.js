// Vercel Routing Middleware: password-protects every page and API route.
import { next } from '@vercel/functions';
import { isAuthorized, AUTH_CHALLENGE } from './lib/auth.js';

export const config = { matcher: '/:path*', runtime: 'nodejs' };

export default function middleware(request) {
  if (isAuthorized(request.headers.get('authorization'))) return next();
  return new Response('Password required', AUTH_CHALLENGE);
}
