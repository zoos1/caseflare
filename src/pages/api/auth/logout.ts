import type { APIRoute } from 'astro';
import { clearCookie } from '../../../lib/auth';

export const GET: APIRoute = async ({ request }) => {
  const adminClear = clearCookie('cf_admin_session');
  const clientClear = clearCookie('cf_client_session');

  return new Response(null, {
    status: 302,
    headers: [
      ['Location', '/login'],
      ['Set-Cookie', adminClear],
      ['Set-Cookie', clientClear],
    ],
  });
};
