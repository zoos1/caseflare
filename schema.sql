CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_email TEXT,
  firm_name TEXT,
  matter_name TEXT NOT NULL,
  matter_description TEXT,
  status TEXT NOT NULL DEFAULT 'intake',
  gdrive_url TEXT,
  r2_prefix TEXT,
  doc_count INTEGER DEFAULT 0,
  event_count INTEGER DEFAULT 0,
  processing_log TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  event_date TEXT,
  event_date_raw TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_doc TEXT NOT NULL,
  source_page INTEGER,
  source_quote TEXT,
  parties TEXT,
  tags TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('ai_model', 'claude-sonnet-4-6'),
  ('extraction_prompt', 'You are a legal document analyst. Extract every significant event from this document. For each event, provide: (1) the exact date or date range, (2) a concise title (10 words max), (3) a clear description of what happened, (4) all parties involved, (5) an exact verbatim quote from the document that supports this event. Return as JSON array with fields: event_date, event_date_raw, title, description, parties (array), source_quote. Be thorough — include all communications, filings, agreements, violations, and notable actions.'),
  ('synthesis_prompt', 'You are a legal document analyst. Review these events extracted from multiple documents in a legal matter. Deduplicate any events that appear multiple times (keep the one with the most detail). Identify any patterns, contradictions, or significant gaps in the timeline. Add a "tags" field to each event with relevant labels like: [filing, communication, agreement, violation, court-order, deadline, payment, witness]. Return the complete deduplicated, enriched event list as JSON.');

CREATE INDEX IF NOT EXISTS idx_events_case_id ON events(case_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
