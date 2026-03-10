import type { APIRoute } from 'astro';

function generatePin(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
  let pin = '';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i++) {
    pin += chars[bytes[i] % chars.length];
  }
  return pin;
}

export const POST: APIRoute = async ({ params, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'DB not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const caseId = params.id;

  // Verify case exists
  const row = await env.DB.prepare('SELECT id FROM cases WHERE id = ?').bind(caseId).first();
  if (!row) {
    return new Response(JSON.stringify({ error: 'Case not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pin = generatePin();

  await env.DB.prepare(
    'UPDATE cases SET client_pin = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(pin, caseId).run();

  return new Response(JSON.stringify({ pin }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
