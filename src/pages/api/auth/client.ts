import type { APIRoute } from 'astro';
import { signToken, createSessionCookie } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response('Service unavailable', { status: 503 });
  }

  const sessionSecret = env.SESSION_SECRET || '';
  if (!sessionSecret) {
    return Response.redirect(new URL('/portal?error=invalid_credentials', request.url).toString(), 302);
  }

  const formData = await request.formData();
  const email = (formData.get('email') as string || '').trim().toLowerCase();
  const pin = (formData.get('pin') as string || '').trim();

  if (!email || !pin) {
    return Response.redirect(new URL('/portal?error=invalid_credentials', request.url).toString(), 302);
  }

  // Query D1 for matching case
  const row = await env.DB.prepare(
    'SELECT id FROM cases WHERE LOWER(client_email) = ? AND client_pin = ?'
  ).bind(email, pin).first<{ id: string }>();

  if (!row) {
    return Response.redirect(new URL('/portal?error=invalid_credentials', request.url).toString(), 302);
  }

  // Create signed session token — 24 hour expiry
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const ONE_DAY_SEC = 24 * 60 * 60;

  const token = await signToken(
    { role: 'client', case_id: row.id, exp: Date.now() + ONE_DAY_MS },
    sessionSecret
  );

  const cookie = createSessionCookie('cf_client_session', token, ONE_DAY_SEC);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': `/portal/case/${row.id}`,
      'Set-Cookie': cookie,
    },
  });
};
