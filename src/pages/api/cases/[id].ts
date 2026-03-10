import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 503 });

  const row = await env.DB.prepare('SELECT * FROM cases WHERE id = ?').bind(params.id).first();
  if (!row) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  return new Response(JSON.stringify(row), { headers: { 'Content-Type': 'application/json' } });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 503 });

  const body = await request.json() as any;
  await env.DB.prepare(`
    UPDATE cases SET
      client_name = COALESCE(?, client_name),
      client_email = COALESCE(?, client_email),
      firm_name = COALESCE(?, firm_name),
      matter_name = COALESCE(?, matter_name),
      matter_description = COALESCE(?, matter_description),
      gdrive_url = COALESCE(?, gdrive_url),
      status = COALESCE(?, status),
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    body.client_name ?? null, body.client_email ?? null, body.firm_name ?? null,
    body.matter_name ?? null, body.matter_description ?? null, body.gdrive_url ?? null,
    body.status ?? null, params.id
  ).run();

  const updated = await env.DB.prepare('SELECT * FROM cases WHERE id = ?').bind(params.id).first();
  return new Response(JSON.stringify(updated), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 503 });

  await env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(params.id).run();
  return new Response(null, { status: 204 });
};
