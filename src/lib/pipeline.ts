import { generateId, getSetting } from './db';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  ANTHROPIC_API_KEY: string;
}

interface ExtractedEvent {
  event_date?: string | null;
  event_date_raw?: string | null;
  title: string;
  description: string;
  parties?: string[];
  source_quote?: string | null;
  tags?: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_DOC_TEXT_LENGTH = 50_000;
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function processCase(caseId: string, env: Env): Promise<void> {
  const log: string[] = [];
  const addLog = (msg: string) => {
    log.push(`[${new Date().toISOString()}] ${msg}`);
  };

  try {
    addLog('Pipeline started');
    await updateProcessingLog(env.DB, caseId, log);

    // 1. Fetch case from D1
    const caseRow = await env.DB.prepare('SELECT * FROM cases WHERE id = ?').bind(caseId).first();
    if (!caseRow) throw new Error(`Case ${caseId} not found`);
    addLog(`Case found: ${caseRow.matter_name}`);

    // 2. Load settings (use DD-specific prompts for M&A due diligence cases)
    const isDD = (caseRow as any).case_type === 'ma_due_diligence';
    const extractionPromptKey = isDD ? 'dd_extraction_prompt' : 'extraction_prompt';
    const synthesisPromptKey = isDD ? 'dd_synthesis_prompt' : 'synthesis_prompt';

    const [aiModel, extractionPrompt, synthesisPrompt] = await Promise.all([
      getSetting(env.DB, 'ai_model'),
      getSetting(env.DB, extractionPromptKey),
      getSetting(env.DB, synthesisPromptKey),
    ]);

    if (!extractionPrompt) throw new Error(`${extractionPromptKey} not configured in settings`);
    if (!synthesisPrompt) throw new Error(`${synthesisPromptKey} not configured in settings`);
    if (isDD) addLog('Mode: M&A Due Diligence');
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

    const model = aiModel || 'claude-sonnet-4-6';
    addLog(`Using model: ${model}`);

    // 3. List all objects in R2 under prefix
    const prefix = `${caseId}/`;
    const listed = await env.DOCS.list({ prefix });
    const objects = listed.objects;

    if (objects.length === 0) {
      throw new Error(`No documents found in R2 under prefix "${prefix}"`);
    }

    addLog(`Found ${objects.length} document(s) in R2`);
    await updateProcessingLog(env.DB, caseId, log);

    // 4. Process each document
    const allEvents: ExtractedEvent[] = [];

    for (const obj of objects) {
      const filename = obj.key.replace(prefix, '');
      addLog(`Processing: ${filename} (${formatBytes(obj.size)})`);
      await updateProcessingLog(env.DB, caseId, log);

      try {
        // Get object from R2
        const r2Object = await env.DOCS.get(obj.key);
        if (!r2Object) {
          addLog(`  WARNING: Could not read ${filename}, skipping`);
          continue;
        }

        // Convert to text
        const bytes = new Uint8Array(await r2Object.arrayBuffer());
        const text = extractText(filename, bytes);

        if (!text || text.trim().length < 10) {
          addLog(`  WARNING: No readable text extracted from ${filename}, skipping`);
          continue;
        }

        addLog(`  Extracted ${text.length} chars of text`);

        // Truncate if too long
        let docText = text;
        if (docText.length > MAX_DOC_TEXT_LENGTH) {
          docText = docText.substring(0, MAX_DOC_TEXT_LENGTH) +
            `\n\n[DOCUMENT TRUNCATED — original was ${text.length} characters, showing first ${MAX_DOC_TEXT_LENGTH}]`;
          addLog(`  Text truncated from ${text.length} to ${MAX_DOC_TEXT_LENGTH} chars`);
        }

        // Build prompt and call Claude
        const prompt = buildExtractionPrompt(extractionPrompt, filename, docText);
        addLog(`  Calling Claude API...`);
        await updateProcessingLog(env.DB, caseId, log);

        const response = await callClaude(prompt, env.ANTHROPIC_API_KEY, model);
        const events = parseEventsJson(response);

        addLog(`  Extracted ${events.length} events`);

        // Tag each event with source_doc
        for (const evt of events) {
          allEvents.push({ ...evt });
        }

        // Insert events for this document
        for (let i = 0; i < events.length; i++) {
          const evt = events[i] as any;
          const id = generateId();
          // For DD cases, map category/detail/risk_level fields to events table columns
          const title = evt.title || evt.category || 'Untitled';
          const description = evt.description || evt.detail || '';
          const tags = isDD && evt.category ? JSON.stringify([evt.category]) : null;
          await env.DB.prepare(`
            INSERT INTO events (id, case_id, event_date, event_date_raw, title, description, source_doc, source_quote, parties, tags, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            id,
            caseId,
            evt.event_date || null,
            evt.event_date_raw || null,
            title,
            description,
            filename,
            evt.source_quote || null,
            evt.parties ? JSON.stringify(evt.parties) : null,
            tags,
            allEvents.length - events.length + i,
          ).run();
        }
      } catch (docErr: any) {
        addLog(`  ERROR processing ${filename}: ${docErr.message}`);
      }
    }

    if (allEvents.length === 0) {
      addLog('No events extracted from any document');
      await env.DB.prepare(
        `UPDATE cases SET status='complete', doc_count=?, event_count=0, processing_log=?, updated_at=datetime('now') WHERE id=?`
      ).bind(objects.length, log.join('\n'), caseId).run();
      return;
    }

    addLog(`Total events before synthesis: ${allEvents.length}`);
    await updateProcessingLog(env.DB, caseId, log);

    // 5. Synthesis pass — dedup, tag, sort
    addLog('Running synthesis pass...');
    await updateProcessingLog(env.DB, caseId, log);

    try {
      // Build event data with source_doc preserved for synthesis
      const eventsForSynthesis = await env.DB.prepare(
        'SELECT event_date, event_date_raw, title, description, source_doc, source_quote, parties FROM events WHERE case_id = ? ORDER BY sort_order ASC'
      ).bind(caseId).all();

      const synthPrompt = buildSynthesisPrompt(
        synthesisPrompt,
        objects.length,
        eventsForSynthesis.results || [],
        isDD
      );

      const synthResponse = await callClaude(synthPrompt, env.ANTHROPIC_API_KEY, model);
      const synthesizedEvents = parseEventsJson(synthResponse);

      addLog(`Synthesis produced ${synthesizedEvents.length} events (from ${allEvents.length})`);

      // Replace all events with synthesized versions
      await env.DB.prepare('DELETE FROM events WHERE case_id = ?').bind(caseId).run();

      for (let i = 0; i < synthesizedEvents.length; i++) {
        const evt = synthesizedEvents[i] as any;
        const id = generateId();
        const title = evt.title || evt.category || 'Untitled';
        const description = evt.description || evt.detail || '';
        const tags = isDD && evt.category
          ? JSON.stringify([evt.category])
          : evt.tags ? JSON.stringify(evt.tags) : null;
        await env.DB.prepare(`
          INSERT INTO events (id, case_id, event_date, event_date_raw, title, description, source_doc, source_quote, parties, tags, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          caseId,
          evt.event_date || null,
          evt.event_date_raw || null,
          title,
          description,
          evt.source_doc || 'multiple',
          evt.source_quote || null,
          evt.parties ? JSON.stringify(evt.parties) : null,
          tags,
          i,
        ).run();
      }

      addLog('Synthesis complete');
    } catch (synthErr: any) {
      addLog(`Synthesis failed (keeping raw events): ${synthErr.message}`);
      // Keep the raw extracted events if synthesis fails
    }

    // 6. Update case status
    const finalEventCount = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM events WHERE case_id = ?'
    ).bind(caseId).first<{ cnt: number }>();

    await env.DB.prepare(
      `UPDATE cases SET status='complete', doc_count=?, event_count=?, processing_log=?, updated_at=datetime('now') WHERE id=?`
    ).bind(
      objects.length,
      finalEventCount?.cnt || 0,
      log.join('\n'),
      caseId,
    ).run();

    addLog(`Pipeline complete. ${finalEventCount?.cnt || 0} events, ${objects.length} documents.`);
    await updateProcessingLog(env.DB, caseId, log);
  } catch (err: any) {
    addLog(`FATAL ERROR: ${err.message}`);
    await env.DB.prepare(
      `UPDATE cases SET status='error', processing_log=?, updated_at=datetime('now') WHERE id=?`
    ).bind(log.join('\n'), caseId).run();
    throw err;
  }
}

// ─── Claude API Call ─────────────────────────────────────────────────────────

async function callClaude(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: prompt,
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} ${err}`);
  }

  const data = await response.json() as { content: Array<{ text: string }> };
  return data.content[0].text;
}

// ─── Prompt Builders ─────────────────────────────────────────────────────────

function buildExtractionPrompt(extractionPrompt: string, filename: string, text: string): string {
  return `${extractionPrompt}

DOCUMENT FILENAME: ${filename}

DOCUMENT CONTENT:
${text}

Return ONLY a valid JSON array. No explanation, no markdown, just the JSON array.`;
}

function buildSynthesisPrompt(synthesisPrompt: string, docCount: number, events: unknown[], isDD: boolean = false): string {
  if (isDD) {
    return `${synthesisPrompt}

Here are all items extracted from ${docCount} documents in this due diligence package:

${JSON.stringify(events, null, 2)}

Return ONLY a valid JSON array with the same structure but deduplicated, consolidated, and with SUMMARY items added. No explanation, no markdown.`;
  }
  return `${synthesisPrompt}

Here are all events extracted from ${docCount} documents in this legal matter:

${JSON.stringify(events, null, 2)}

Return ONLY a valid JSON array with the same structure but deduplicated, tagged, and enriched. Each event must have a "tags" field (JSON array of strings). No explanation, no markdown.`;
}

// ─── JSON Parsing ────────────────────────────────────────────────────────────

function parseEventsJson(raw: string): ExtractedEvent[] {
  // Strip markdown code fences if present
  let cleaned = raw.trim();

  // Remove ```json ... ``` wrapper
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    if (firstNewline !== -1) {
      cleaned = cleaned.substring(firstNewline + 1);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
    cleaned = cleaned.trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      throw new Error('Response is not a JSON array');
    }
    // Validate each event has at minimum title/category and description/detail
    return parsed.filter((evt: any) => evt && (typeof evt.title === 'string' || typeof evt.category === 'string') && (typeof evt.description === 'string' || typeof evt.detail === 'string'));
  } catch (err: any) {
    // Try to find a JSON array within the text
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          return parsed.filter((evt: any) => evt && (typeof evt.title === 'string' || typeof evt.category === 'string') && (typeof evt.description === 'string' || typeof evt.detail === 'string'));
        }
      } catch {
        // fall through
      }
    }
    throw new Error(`Failed to parse Claude response as JSON: ${err.message}. Raw start: ${cleaned.substring(0, 200)}`);
  }
}

// ─── Text Extraction ─────────────────────────────────────────────────────────

function extractText(filename: string, bytes: Uint8Array): string {
  const ext = filename.toLowerCase().split('.').pop() || '';

  switch (ext) {
    case 'txt':
    case 'md':
    case 'csv':
      return decodeUtf8(bytes);

    case 'pdf':
      return extractTextFromPDF(bytes);

    case 'docx':
    case 'doc':
      return extractTextFromBinary(bytes);

    case 'eml':
    case 'msg':
      return extractTextFromEmail(bytes);

    default:
      // Fallback: try UTF-8 decode
      return decodeUtf8(bytes);
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Simple PDF text extraction for text-based PDFs.
 * Scans for BT/ET blocks and extracts Tj/TJ text operators.
 * Not perfect but functional for most text-layer PDFs.
 */
function extractTextFromPDF(bytes: Uint8Array): string {
  const raw = decodeUtf8(bytes);
  const textParts: string[] = [];

  // Strategy 1: Extract text between BT and ET markers (text objects)
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let btMatch;
  while ((btMatch = btEtRegex.exec(raw)) !== null) {
    const block = btMatch[1];

    // Extract Tj operator content: (text) Tj
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      const text = decodePdfString(tjMatch[1]);
      if (text.trim()) textParts.push(text);
    }

    // Extract TJ array content: [(text) -kern (text)] TJ
    const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
    let tjArrMatch;
    while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
      const arr = tjArrMatch[1];
      const strRegex = /\(([^)]*)\)/g;
      let strMatch;
      const parts: string[] = [];
      while ((strMatch = strRegex.exec(arr)) !== null) {
        parts.push(decodePdfString(strMatch[1]));
      }
      if (parts.length > 0) textParts.push(parts.join(''));
    }
  }

  // Strategy 2: If BT/ET extraction yields nothing, try stream content
  if (textParts.length === 0) {
    // Look for readable text sequences between stream/endstream
    const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
    let streamMatch;
    while ((streamMatch = streamRegex.exec(raw)) !== null) {
      const content = streamMatch[1];
      // Extract parenthesized strings
      const parenRegex = /\(([^)]{2,})\)/g;
      let parenMatch;
      while ((parenMatch = parenRegex.exec(content)) !== null) {
        const decoded = decodePdfString(parenMatch[1]);
        if (decoded.trim().length > 2 && /[a-zA-Z]/.test(decoded)) {
          textParts.push(decoded);
        }
      }
    }
  }

  if (textParts.length > 0) {
    return textParts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // Strategy 3: Last resort — extract any printable text sequences
  return extractReadableText(raw);
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

/**
 * Extract readable text from binary files (DOCX, DOC, etc.)
 * DOCX is a ZIP containing XML — we scan for readable text sequences.
 */
function extractTextFromBinary(bytes: Uint8Array): string {
  const raw = decodeUtf8(bytes);

  // For DOCX (which is XML inside ZIP), try to find XML text content
  // Look for text between XML tags pattern: >text<
  const xmlTextParts: string[] = [];
  const xmlRegex = />([^<]{3,})</g;
  let xmlMatch;
  while ((xmlMatch = xmlRegex.exec(raw)) !== null) {
    const text = xmlMatch[1].trim();
    // Filter out XML artifacts and keep meaningful text
    if (text.length > 2 && /[a-zA-Z]/.test(text) && !/^[\x00-\x1f]+$/.test(text)) {
      xmlTextParts.push(text);
    }
  }

  if (xmlTextParts.length > 10) {
    return xmlTextParts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // Fallback: extract any readable text sequences
  return extractReadableText(raw);
}

/**
 * Extract text from email files (.eml, .msg).
 * Parse as text, extract headers and body.
 */
function extractTextFromEmail(bytes: Uint8Array): string {
  const raw = decodeUtf8(bytes);
  const lines = raw.split(/\r?\n/);
  const parts: string[] = [];
  let inHeaders = true;
  let inBody = false;

  for (const line of lines) {
    if (inHeaders) {
      // Extract key headers
      const headerMatch = line.match(/^(From|To|Subject|Date|Cc|Bcc):\s*(.+)/i);
      if (headerMatch) {
        parts.push(`${headerMatch[1]}: ${headerMatch[2]}`);
      }
      if (line.trim() === '') {
        inHeaders = false;
        inBody = true;
        parts.push('---');
        continue;
      }
    }
    if (inBody) {
      // Skip MIME boundaries and encoded content
      if (line.startsWith('--') && line.length > 20) continue;
      if (line.startsWith('Content-Type:') || line.startsWith('Content-Transfer-Encoding:')) continue;
      if (/^[A-Za-z0-9+/=]{60,}$/.test(line.trim())) continue; // base64 line
      if (line.trim()) parts.push(line);
    }
  }

  return parts.join('\n').trim();
}

/**
 * Extract readable ASCII/UTF-8 text sequences from raw data.
 * Finds sequences of printable characters of length > 4.
 */
function extractReadableText(raw: string): string {
  const chunks: string[] = [];
  // Match sequences of printable ASCII chars (space through tilde, plus common punctuation)
  const readable = raw.match(/[\x20-\x7e]{5,}/g);
  if (readable) {
    for (const chunk of readable) {
      // Skip chunks that look like binary/encoded data
      if (/^[A-Za-z0-9+/=]+$/.test(chunk) && chunk.length > 40) continue;
      if (/^[0-9a-fA-F]+$/.test(chunk) && chunk.length > 20) continue;
      chunks.push(chunk);
    }
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function updateProcessingLog(db: D1Database, caseId: string, log: string[]): Promise<void> {
  await db.prepare(
    `UPDATE cases SET processing_log=?, updated_at=datetime('now') WHERE id=?`
  ).bind(log.join('\n'), caseId).run();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
