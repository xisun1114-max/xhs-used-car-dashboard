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
      review_status TEXT NOT NULL DEFAULT 'pending',
      placement_status TEXT NOT NULL DEFAULT 'pending',
      dealer_guard_status TEXT NOT NULL DEFAULT 'pending',
      reply_status TEXT NOT NULL DEFAULT 'pending',
      recheck_status TEXT NOT NULL DEFAULT 'pending',
      resolution_status TEXT NOT NULL DEFAULT 'pending',
      placement_count INTEGER NOT NULL DEFAULT 0,
      risk_tag TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      notes_html TEXT NOT NULL DEFAULT '',
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
    database.prepare(`CREATE TABLE IF NOT EXISTS operation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      cycle_number INTEGER NOT NULL,
      operation_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS note_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      object_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS risk_alert_tasks (
      note_id TEXT PRIMARY KEY,
      data_date TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT NOT NULL DEFAULT '',
      creator TEXT NOT NULL DEFAULT '',
      publish_date TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT '',
      delivery_status TEXT NOT NULL,
      first_spend_date TEXT NOT NULL DEFAULT '',
      last_spend_date TEXT NOT NULL DEFAULT '',
      delivery_days INTEGER NOT NULL DEFAULT 0,
      no_spend_days INTEGER NOT NULL DEFAULT 0,
      spend REAL NOT NULL DEFAULT 0,
      action_clicks INTEGER NOT NULL DEFAULT 0,
      action_cost REAL NOT NULL DEFAULT 0,
      category_median_cost REAL NOT NULL DEFAULT 0,
      risk_ratio REAL,
      risk_reason TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '',
      spend_3d REAL NOT NULL DEFAULT 0,
      action_clicks_3d INTEGER NOT NULL DEFAULT 0,
      action_cost_3d REAL NOT NULL DEFAULT 0,
      spend_7d REAL NOT NULL DEFAULT 0,
      action_clicks_7d INTEGER NOT NULL DEFAULT 0,
      action_cost_7d REAL NOT NULL DEFAULT 0,
      spend_prev_7d REAL NOT NULL DEFAULT 0,
      action_clicks_prev_7d INTEGER NOT NULL DEFAULT 0,
      action_cost_prev_7d REAL NOT NULL DEFAULT 0,
      cost_change_7d REAL,
      threshold_cost REAL NOT NULL DEFAULT 0,
      benchmark_samples INTEGER NOT NULL DEFAULT 0,
      benchmark_scope TEXT NOT NULL DEFAULT '',
      benchmark_multiplier REAL NOT NULL DEFAULT 1.5,
      risk_trend TEXT NOT NULL DEFAULT '',
      risk_priority TEXT NOT NULL DEFAULT 'P1',
      owner TEXT NOT NULL DEFAULT '',
      resolution TEXT NOT NULL DEFAULT 'pending',
      action_type TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS risk_alert_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS negative_monitor_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      from_deadline TEXT NOT NULL DEFAULT '',
      to_deadline TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS tasks_note_cycle_idx ON maintenance_tasks(note_id, cycle_number DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS tasks_status_priority_idx ON maintenance_tasks(status, priority, score DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS activity_task_idx ON activity_log(task_id, id DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS operation_note_idx ON operation_events(note_id, id DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS upload_task_idx ON note_uploads(task_id, id DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS risk_alert_status_idx ON risk_alert_tasks(delivery_status, resolution, spend DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS risk_alert_activity_idx ON risk_alert_activity(note_id, id DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS negative_monitor_status_idx ON negative_monitor_tasks(status, new_deadline, spend_3d DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS negative_monitor_note_idx ON negative_monitor_tasks(note_id, generated_at DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS negative_monitor_history_note_idx ON negative_monitor_history(note_id, id DESC)"),
  ]);
  for (const statement of [
    "ALTER TABLE maintenance_tasks ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE maintenance_tasks ADD COLUMN placement_status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE maintenance_tasks ADD COLUMN dealer_guard_status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE maintenance_tasks ADD COLUMN reply_status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE maintenance_tasks ADD COLUMN recheck_status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE maintenance_tasks ADD COLUMN resolution_status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE maintenance_tasks ADD COLUMN notes_html TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE risk_alert_tasks ADD COLUMN account TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE risk_alert_tasks ADD COLUMN spend_3d REAL NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN action_clicks_3d INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN action_cost_3d REAL NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN spend_7d REAL NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN action_clicks_7d INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN action_cost_7d REAL NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN spend_prev_7d REAL NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN action_clicks_prev_7d INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN action_cost_prev_7d REAL NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN cost_change_7d REAL",
    "ALTER TABLE risk_alert_tasks ADD COLUMN threshold_cost REAL NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN benchmark_samples INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE risk_alert_tasks ADD COLUMN benchmark_scope TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE risk_alert_tasks ADD COLUMN benchmark_multiplier REAL NOT NULL DEFAULT 1.5",
    "ALTER TABLE risk_alert_tasks ADD COLUMN risk_trend TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE risk_alert_tasks ADD COLUMN risk_priority TEXT NOT NULL DEFAULT 'P1'",
  ]) {
    try {
      await database.prepare(statement).run();
    } catch {
      // Existing deployments already have the column after the first run.
    }
  }
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
