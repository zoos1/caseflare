import type { APIRoute } from 'astro';
import { processCase } from '../../../lib/pipeline';

export const POST: APIRoute = async ({ params, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'DB not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const caseId = params.id!;

  // Verify case exists
  const caseRow = await env.DB.prepare('SELECT id, status FROM cases WHERE id = ?').bind(caseId).first<{ id: string; status: string }>();
  if (!caseRow) {
    return new Response(JSON.stringify({ error: 'Case not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Prevent re-processing while already running
  if (caseRow.status === 'processing') {
    return new Response(JSON.stringify({ error: 'Case is already being processed' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Mark as processing immediately
  await env.DB.prepare(
    `UPDATE cases SET status='processing', processing_log=?, updated_at=datetime('now') WHERE id=?`
  ).bind(`[${new Date().toISOString()}] Processing started...`, caseId).run();

  // Run pipeline
  try {
    await processCase(caseId, env);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    // Pipeline already sets error status in DB, but handle edge cases
    await env.DB.prepare(
      `UPDATE cases SET status='error', processing_log=COALESCE(processing_log || char(10), '') || ?, updated_at=datetime('now') WHERE id=?`
    ).bind(`[${new Date().toISOString()}] Error: ${err.message}`, caseId).run();
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
