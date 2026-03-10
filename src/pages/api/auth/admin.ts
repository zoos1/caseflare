import type { APIRoute } from 'astro';
import { signToken, createSessionCookie } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env) {
    return new Response('Service unavailable', { status: 503 });
  }

  const formData = await request.formData();
  const email = (formData.get('email') as string || '').trim().toLowerCase();
  const password = formData.get('password') as string || '';
  const redirectTo = formData.get('redirect') as string || '/admin';

  const adminEmail = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = env.ADMIN_PASSWORD || '';
  const sessionSecret = env.SESSION_SECRET || '';

  if (!adminEmail || !adminPassword || !sessionSecret) {
    return Response.redirect(new URL('/login?error=invalid_credentials', request.url).toString(), 302);
  }

  // Plain password comparison for v1
  if (email !== adminEmail || password !== adminPassword) {
    return Response.redirect(
      new URL(`/login?error=invalid_credentials&redirect=${encodeURIComponent(redirectTo)}`, request.url).toString(),
      302
    );
  }

  // Create signed session token — 7 day expiry
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

  const token = await signToken(
    { role: 'admin', email, exp: Date.now() + SEVEN_DAYS_MS },
    sessionSecret
  );

  const cookie = createSessionCookie('cf_admin_session', token, SEVEN_DAYS_SEC);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': redirectTo,
      'Set-Cookie': cookie,
    },
  });
};
