import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 503 });

  // Mark case as processing
  await env.DB.prepare(`
    UPDATE cases SET status = 'processing', processing_log = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(`[${new Date().toISOString()}] Processing initiated. Google Drive ingestion pipeline coming in next build.`, params.id).run();

  return new Response(JSON.stringify({ ok: true, message: 'Processing initiated' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
