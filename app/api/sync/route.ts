import { ensureSchema, getD1 } from "../../../db/runtime";

type IncomingTask = Record<string, unknown> & {
  note_id: string;
  task_date: string;
  priority: string;
};

function daysBetween(left: string, right: string) {
  return Math.floor((Date.parse(right) - Date.parse(left)) / 86_400_000);
}

function shouldCreateNext(latest: Record<string, unknown>, task: IncomingTask) {
  if (latest.status !== "completed" || !latest.completed_at) return false;
  const completedDate = String(latest.completed_at).slice(0, 10);
  if (task.priority === "P0") return completedDate < task.task_date;
  const commentGrowth = Number(task.comments_total || 0) - Number(latest.completed_comments || 0);
  if (commentGrowth >= 3) return true;
  const elapsed = daysBetween(completedDate, task.task_date);
  if (Number(task.spend_3d || 0) > 0 && elapsed >= 3) return true;
  return task.priority === "P2" && elapsed >= 7;
}

async function insertTask(db: D1Database, task: IncomingTask, cycle: number) {
  const taskId = `${task.note_id}:${task.task_date}:${cycle}`;
  await db.prepare(`INSERT INTO maintenance_tasks (
    task_id, note_id, task_date, cycle_number, title, nickname, link, publish_date,
    priority, score, cadence_days, reasons, spend_3d, spend_7d, spend_total,
    active_days_7d, action_clicks_3d, comments_total, comments_3d, comments_7d
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      taskId, task.note_id, task.task_date, cycle, String(task.title || "供应商笔记"),
      String(task.nickname || ""), String(task.link || ""), String(task.publish_date || ""),
      task.priority, Number(task.score || 0), Number(task.cadence_days || 1),
      JSON.stringify(task.reasons || []), Number(task.spend_3d || 0), Number(task.spend_7d || 0),
      Number(task.spend_total || 0), Number(task.active_days_7d || 0),
      Number(task.action_clicks_3d || 0), Number(task.comments_total || 0),
      task.comments_3d == null ? null : Number(task.comments_3d),
      task.comments_7d == null ? null : Number(task.comments_7d),
    ).run();
  return taskId;
}

async function refreshTask(db: D1Database, taskId: string, task: IncomingTask) {
  await db.prepare(`UPDATE maintenance_tasks SET
    task_date=?, title=?, nickname=?, link=?, publish_date=?, priority=?, score=?, cadence_days=?,
    reasons=?, spend_3d=?, spend_7d=?, spend_total=?, active_days_7d=?, action_clicks_3d=?,
    comments_total=?, comments_3d=?, comments_7d=?, updated_at=CURRENT_TIMESTAMP
    WHERE task_id=?`).bind(
      task.task_date, String(task.title || "供应商笔记"), String(task.nickname || ""),
      String(task.link || ""), String(task.publish_date || ""), task.priority,
      Number(task.score || 0), Number(task.cadence_days || 1), JSON.stringify(task.reasons || []),
      Number(task.spend_3d || 0), Number(task.spend_7d || 0), Number(task.spend_total || 0),
      Number(task.active_days_7d || 0), Number(task.action_clicks_3d || 0),
      Number(task.comments_total || 0), task.comments_3d == null ? null : Number(task.comments_3d),
      task.comments_7d == null ? null : Number(task.comments_7d), taskId,
    ).run();
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown> & { tasks?: IncomingTask[] };
    if (!Array.isArray(payload.tasks)) {
      return Response.json({ error: "tasks must be an array" }, { status: 400 });
    }
    const db = getD1();
    await ensureSchema(db);
    const metaKeys = ["generated_at", "task_date", "data_freshness", "scope", "thresholds", "summary"];
    for (const key of metaKeys) {
      if (key in payload) {
        await db.prepare(`INSERT INTO dashboard_meta(key, value, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`)
          .bind(key, JSON.stringify(payload[key])).run();
      }
    }

    let created = 0;
    let refreshed = 0;
    let held = 0;
    for (const task of payload.tasks) {
      if (!task.note_id || !task.task_date || !task.priority) continue;
      const latest = await db.prepare(
        "SELECT * FROM maintenance_tasks WHERE note_id=? ORDER BY cycle_number DESC LIMIT 1",
      ).bind(task.note_id).first<Record<string, unknown>>();
      if (!latest) {
        await insertTask(db, task, 1);
        created += 1;
      } else if (latest.status !== "completed") {
        await refreshTask(db, String(latest.task_id), task);
        refreshed += 1;
      } else if (shouldCreateNext(latest, task)) {
        await insertTask(db, task, Number(latest.cycle_number || 1) + 1);
        created += 1;
      } else {
        held += 1;
      }
    }
    return Response.json({ ok: true, received: payload.tasks.length, created, refreshed, held });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to sync dashboard" },
      { status: 500 },
    );
  }
}
