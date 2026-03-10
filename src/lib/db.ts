export function getDB(env: { DB: D1Database }) {
  return env.DB;
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).bind(key, value).run();
}

export async function getAllCases(db: D1Database) {
  return db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all();
}

export async function getCaseById(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM cases WHERE id = ?').bind(id).first();
}

export async function getEventsByCase(db: D1Database, caseId: string) {
  return db.prepare('SELECT * FROM events WHERE case_id = ? ORDER BY sort_order ASC, event_date ASC').bind(caseId).all();
}

export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 12);
}
