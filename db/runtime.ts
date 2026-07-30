import { env } from "cloudflare:workers";

type RuntimeEnv = { DB?: D1Database };

export function getD1(): D1Database {
  const database = (env as RuntimeEnv).DB;
  if (!database) throw new Error("D1 database binding is unavailable");
  return database;
}

export async function ensureSchema(database = getD1()) {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS dashboard_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS maintenance_tasks (
      task_id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      task_date TEXT NOT NULL,
      cycle_number INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL,
      publish_date TEXT NOT NULL,
      priority TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      cadence_days INTEGER NOT NULL DEFAULT 1,
      reasons TEXT NOT NULL DEFAULT '[]',
      spend_3d REAL NOT NULL DEFAULT 0,
      spend_7d REAL NOT NULL DEFAULT 0,
      spend_total REAL NOT NULL DEFAULT 0,
      active_days_7d INTEGER NOT NULL DEFAULT 0,
      action_clicks_3d INTEGER NOT NULL DEFAULT 0,
      comments_total INTEGER NOT NULL DEFAULT 0,
      comments_3d INTEGER,
      comments_7d INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      owner TEXT NOT NULL DEFAULT '',
      review_done INTEGER NOT NULL DEFAULT 0,
      placement_done INTEGER NOT NULL DEFAULT 0,
      dealer_guard_done INTEGER NOT NULL DEFAULT 0,
      reply_done INTEGER NOT NULL DEFAULT 0,
      recheck_done INTEGER NOT NULL DEFAULT 0,
      placement_count INTEGER NOT NULL DEFAULT 0,
      risk_tag TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      completed_at TEXT,
      completed_comments INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS tasks_note_cycle_idx ON maintenance_tasks(note_id, cycle_number DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS tasks_status_priority_idx ON maintenance_tasks(status, priority, score DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS activity_task_idx ON activity_log(task_id, id DESC)"),
  ]);
}

export function serializeTask(row: Record<string, unknown>) {
  const booleanFields = [
    "review_done",
    "placement_done",
    "dealer_guard_done",
    "reply_done",
    "recheck_done",
  ];
  const result = { ...row };
  for (const field of booleanFields) result[field] = Boolean(row[field]);
  try {
    result.reasons = JSON.parse(String(row.reasons || "[]"));
  } catch {
    result.reasons = [];
  }
  return result;
}
