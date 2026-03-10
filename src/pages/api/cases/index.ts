import type { APIRoute } from 'astro';
import { getAllCases, generateId } from '../../../lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 503 });

  const cases = await getAllCases(env.DB);
  return new Response(JSON.stringify(cases.results), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 503 });

  const body = await request.json() as any;
  const id = generateId();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO cases (id, client_name, client_email, firm_name, matter_name, matter_description, gdrive_url, r2_prefix, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'intake', ?, ?)
  `).bind(
    id,
    body.client_name,
    body.client_email || null,
    body.firm_name || null,
    body.matter_name,
    body.matter_description || null,
    body.gdrive_url || null,
    `${id}/`,
    now, now
  ).run();

  const created = await env.DB.prepare('SELECT * FROM cases WHERE id = ?').bind(id).first();
  return new Response(JSON.stringify(created), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};
