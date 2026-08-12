import { ensureSchema, getD1 } from "../../../../db/runtime";

type ExtensionRow = Record<string, unknown> & { note_id?: string; new_deadline?: string };

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { generated_at?: string; mode?: string; rows?: ExtensionRow[]; data?: unknown };
    if (!Array.isArray(payload.rows)) return Response.json({ error: "rows must be an array" }, { status: 400 });
    const db = getD1();
    await ensureSchema(db);
    for (const [key, value] of Object.entries({ generated_at: payload.generated_at || new Date().toISOString(), mode: payload.mode || "scheduled", data: payload.data || {} })) {
      await db.prepare(`INSERT INTO dashboard_meta(key, value, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`)
        .bind(`negative_monitor_${key}`, JSON.stringify(value)).run();
    }
    let created = 0;
    let refreshed = 0;
    for (const row of payload.rows) {
      if (!row.note_id || !row.new_deadline) continue;
      const taskId = `${row.note_id}:${row.current_deadline || ""}:${row.new_deadline}`;
      const existing = await db.prepare("SELECT task_id FROM negative_monitor_tasks WHERE task_id=?").bind(taskId).first();
      await db.prepare(`INSERT INTO negative_monitor_tasks (
        task_id,note_id,generated_at,mode,nickname,link,category,publish_date,current_deadline,
        judgment_node,delivery_status,spend_3d,comments_total,comments_3d,comments_7d,extension_reason,new_deadline
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(task_id) DO UPDATE SET generated_at=excluded.generated_at,mode=excluded.mode,
        nickname=excluded.nickname,link=excluded.link,category=excluded.category,publish_date=excluded.publish_date,
        judgment_node=excluded.judgment_node,delivery_status=excluded.delivery_status,spend_3d=excluded.spend_3d,
        comments_total=excluded.comments_total,comments_3d=excluded.comments_3d,comments_7d=excluded.comments_7d,
        extension_reason=excluded.extension_reason,updated_at=CURRENT_TIMESTAMP`).bind(
        taskId, String(row.note_id), payload.generated_at || new Date().toISOString(), payload.mode || "scheduled",
        String(row.nickname || ""), String(row.link || ""), String(row.category || ""), String(row.publish_date || ""),
        String(row.current_deadline || ""), String(row.judgment_node || ""), String(row.delivery_status || ""),
        Number(row.spend_3d || 0), Number(row.comments_total || 0), row.comments_3d == null ? null : Number(row.comments_3d),
        row.comments_7d == null ? null : Number(row.comments_7d), String(row.extension_reason || ""), String(row.new_deadline),
      ).run();
      existing ? refreshed++ : created++;
    }
    return Response.json({ ok: true, received: payload.rows.length, created, refreshed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "同步失败" }, { status: 500 });
  }
}
