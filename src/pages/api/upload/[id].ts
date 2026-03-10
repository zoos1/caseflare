import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB || !env?.DOCS) {
    return new Response(JSON.stringify({ error: 'Bindings not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const caseId = params.id!;

  // Verify case exists
  const caseRow = await env.DB.prepare('SELECT id FROM cases WHERE id = ?').bind(caseId).first();
  if (!caseRow) {
    return new Response(JSON.stringify({ error: 'Case not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const formData = await request.formData();
  const files = formData.getAll('files') as File[];

  if (!files.length) {
    return new Response(JSON.stringify({ error: 'No files provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const uploaded: string[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const key = `${caseId}/${file.name}`;
      const bytes = await file.arrayBuffer();
      await env.DOCS.put(key, bytes, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
        customMetadata: {
          caseId,
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
        },
      });
      uploaded.push(file.name);
    } catch (err: any) {
      errors.push(`${file.name}: ${err.message}`);
    }
  }

  // Update doc count from R2
  const count = await env.DOCS.list({ prefix: `${caseId}/` });
  await env.DB.prepare(
    `UPDATE cases SET doc_count=?, updated_at=datetime('now') WHERE id=?`
  ).bind(count.objects.length, caseId).run();

  return new Response(JSON.stringify({
    ok: true,
    uploaded,
    errors: errors.length > 0 ? errors : undefined,
    totalDocs: count.objects.length,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** List files for a case */
export const GET: APIRoute = async ({ params, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DOCS) {
    return new Response(JSON.stringify({ error: 'R2 binding not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const caseId = params.id!;
  const listed = await env.DOCS.list({ prefix: `${caseId}/` });

  const files = listed.objects.map((obj) => ({
    name: obj.key.replace(`${caseId}/`, ''),
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
  }));

  return new Response(JSON.stringify({ files }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
