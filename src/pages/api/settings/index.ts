import type { APIRoute } from 'astro';
import { getSetting, setSetting } from '../../../lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 503 });

  const [model, extraction, synthesis] = await Promise.all([
    getSetting(env.DB, 'ai_model'),
    getSetting(env.DB, 'extraction_prompt'),
    getSetting(env.DB, 'synthesis_prompt'),
  ]);

  return new Response(JSON.stringify({ ai_model: model, extraction_prompt: extraction, synthesis_prompt: synthesis }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 503 });

  const body = await request.json() as any;
  const updates = [];
  if (body.ai_model) updates.push(setSetting(env.DB, 'ai_model', body.ai_model));
  if (body.extraction_prompt) updates.push(setSetting(env.DB, 'extraction_prompt', body.extraction_prompt));
  if (body.synthesis_prompt) updates.push(setSetting(env.DB, 'synthesis_prompt', body.synthesis_prompt));
  await Promise.all(updates);

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
