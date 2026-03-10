import { defineMiddleware } from 'astro:middleware';
import { verifyToken } from '../lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // Get runtime env — skip auth if not available (local dev without wrangler)
  const runtime = (context.locals as any).runtime;
  if (!runtime?.env) {
    return next();
  }

  const env = runtime.env;
  const sessionSecret = env.SESSION_SECRET;

  // If no SESSION_SECRET configured, skip auth checks
  if (!sessionSecret) {
    return next();
  }

  // ── Admin route protection ──────────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    const cookies = context.request.headers.get('cookie') || '';
    const token = parseCookie(cookies, 'cf_admin_session');

    if (!token) {
      return context.redirect(`/login?redirect=${encodeURIComponent(pathname)}`);
    }

    const payload = await verifyToken(token, sessionSecret);
    if (!payload || payload.role !== 'admin') {
      return context.redirect(`/login?redirect=${encodeURIComponent(pathname)}`);
    }

    // Attach admin info to locals for downstream use
    (context.locals as any).admin = payload;
  }

  // ── Client portal route protection ──────────────────────────────────────
  if (pathname.startsWith('/portal/case/')) {
    const cookies = context.request.headers.get('cookie') || '';
    const token = parseCookie(cookies, 'cf_client_session');

    if (!token) {
      return context.redirect('/portal?error=unauthorized');
    }

    const payload = await verifyToken(token, sessionSecret);
    if (!payload || payload.role !== 'client') {
      return context.redirect('/portal?error=unauthorized');
    }

    // Extract case ID from path: /portal/case/{id}
    const pathCaseId = pathname.split('/portal/case/')[1]?.split('/')[0];
    if (payload.case_id !== pathCaseId) {
      return context.redirect('/portal?error=unauthorized');
    }

    // Attach client info to locals
    (context.locals as any).client = payload;
  }

  return next();
});

function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
