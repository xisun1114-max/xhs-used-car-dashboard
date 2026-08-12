import { ensureSchema, getD1 } from "../../../db/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getD1();
    await ensureSchema(db);
    const [tasks, meta, owners] = await Promise.all([
      db.prepare(`SELECT * FROM negative_monitor_tasks
        ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
        new_deadline, spend_3d DESC`).all(),
      db.prepare("SELECT key, value FROM dashboard_meta WHERE key LIKE 'negative_monitor_%'").all(),
      db.prepare("SELECT DISTINCT owner FROM negative_monitor_tasks WHERE owner <> '' ORDER BY owner").all(),
    ]);
    const metadata = Object.fromEntries((meta.results as Array<{key:string;value:string}>).map((row) => {
      try { return [row.key.replace("negative_monitor_", ""), JSON.parse(row.value)]; }
      catch { return [row.key.replace("negative_monitor_", ""), row.value]; }
    }));
    return Response.json({ ...metadata, tasks: tasks.results, owners: (owners.results as Array<{owner:string}>).map((row) => row.owner) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法加载负评监测延续任务" }, { status: 500 });
  }
}
