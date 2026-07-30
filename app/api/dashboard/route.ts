import { ensureSchema, getD1, serializeTask } from "../../../db/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getD1();
    await ensureSchema(db);
    const [taskResult, metaResult, ownerResult] = await Promise.all([
      db.prepare(`SELECT * FROM maintenance_tasks
        WHERE status <> 'archived'
        ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
        score DESC, spend_3d DESC, comments_total DESC`).all(),
      db.prepare("SELECT key, value FROM dashboard_meta").all(),
      db.prepare("SELECT DISTINCT owner FROM maintenance_tasks WHERE owner <> '' ORDER BY owner").all(),
    ]);
    const meta = Object.fromEntries(
      (metaResult.results as Array<{ key: string; value: string }>).map((row) => {
        try {
          return [row.key, JSON.parse(row.value)];
        } catch {
          return [row.key, row.value];
        }
      }),
    );
    return Response.json({
      ...meta,
      tasks: (taskResult.results as Array<Record<string, unknown>>).map(serializeTask),
      owners: (ownerResult.results as Array<{ owner: string }>).map((row) => row.owner),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load dashboard" },
      { status: 500 },
    );
  }
}
