import { ensureSchema, getD1 } from "../../../db/runtime";

type IncomingAlert = Record<string, unknown> & { note_id?: string };

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getD1();
    await ensureSchema(db);
    const [alerts, activity, meta] = await Promise.all([
      db.prepare(`SELECT * FROM risk_alert_tasks
        ORDER BY CASE delivery_status WHEN '投放中' THEN 0 WHEN '疑似拉停' THEN 1 ELSE 2 END,
        CASE resolution WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END, spend DESC`).all(),
      db.prepare("SELECT * FROM risk_alert_activity ORDER BY id DESC LIMIT 1000").all(),
      db.prepare("SELECT value FROM dashboard_meta WHERE key='risk_alert_meta'").first<{ value: string }>(),
    ]);
    let riskMeta = {};
    try { riskMeta = JSON.parse(meta?.value || "{}"); } catch { riskMeta = {}; }
    return Response.json({ ...riskMeta, alerts: alerts.results, activity: activity.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法读取高成本预警" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown> & { alerts?: IncomingAlert[] };
    if (!Array.isArray(payload.alerts)) return Response.json({ error: "alerts must be an array" }, { status: 400 });
    const db = getD1();
    await ensureSchema(db);
    for (const alert of payload.alerts) {
      if (!alert.note_id) continue;
      await db.prepare(`INSERT INTO risk_alert_tasks (
        note_id, data_date, title, link, creator, publish_date, category, direction,
        delivery_status, first_spend_date, last_spend_date, delivery_days, no_spend_days,
        spend, action_clicks, action_cost, category_median_cost, risk_ratio, risk_reason,
        account, spend_3d, action_clicks_3d, action_cost_3d, spend_7d, action_clicks_7d,
        action_cost_7d, spend_prev_7d, action_clicks_prev_7d, action_cost_prev_7d,
        cost_change_7d, threshold_cost, benchmark_samples, benchmark_scope,
        benchmark_multiplier, risk_trend, risk_priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        data_date=excluded.data_date, title=excluded.title, link=excluded.link,
        creator=excluded.creator, publish_date=excluded.publish_date, category=excluded.category,
        direction=excluded.direction, delivery_status=excluded.delivery_status,
        first_spend_date=excluded.first_spend_date, last_spend_date=excluded.last_spend_date,
        delivery_days=excluded.delivery_days, no_spend_days=excluded.no_spend_days,
        spend=excluded.spend, action_clicks=excluded.action_clicks, action_cost=excluded.action_cost,
        category_median_cost=excluded.category_median_cost, risk_ratio=excluded.risk_ratio,
        risk_reason=excluded.risk_reason, account=excluded.account, spend_3d=excluded.spend_3d,
        action_clicks_3d=excluded.action_clicks_3d, action_cost_3d=excluded.action_cost_3d,
        spend_7d=excluded.spend_7d, action_clicks_7d=excluded.action_clicks_7d,
        action_cost_7d=excluded.action_cost_7d, spend_prev_7d=excluded.spend_prev_7d,
        action_clicks_prev_7d=excluded.action_clicks_prev_7d, action_cost_prev_7d=excluded.action_cost_prev_7d,
        cost_change_7d=excluded.cost_change_7d, threshold_cost=excluded.threshold_cost,
        benchmark_samples=excluded.benchmark_samples, benchmark_scope=excluded.benchmark_scope,
        benchmark_multiplier=excluded.benchmark_multiplier, risk_trend=excluded.risk_trend,
        risk_priority=excluded.risk_priority, updated_at=CURRENT_TIMESTAMP`).bind(
        alert.note_id, payload.data_date || "", alert.title || "未命名笔记", alert.link || "",
        alert.creator || "", alert.publish_date || "", alert.category || "未标注", alert.direction || "未标注",
        alert.delivery_status || "已拉停", alert.first_spend_date || "", alert.last_spend_date || "",
        Number(alert.delivery_days || 0), Number(alert.no_spend_days || 0), Number(alert.spend || 0),
        Number(alert.action_clicks || 0), Number(alert.action_cost || 0), Number(alert.category_median_cost || 0),
        alert.risk_ratio == null ? null : Number(alert.risk_ratio), alert.risk_reason || "", alert.account || "",
        Number(alert.spend_3d || 0), Number(alert.action_clicks_3d || 0), Number(alert.action_cost_3d || 0),
        Number(alert.spend_7d || 0), Number(alert.action_clicks_7d || 0), Number(alert.action_cost_7d || 0),
        Number(alert.spend_prev_7d || 0), Number(alert.action_clicks_prev_7d || 0), Number(alert.action_cost_prev_7d || 0),
        alert.cost_change_7d == null ? null : Number(alert.cost_change_7d), Number(alert.threshold_cost || 0),
        Number(alert.benchmark_samples || 0), alert.benchmark_scope || "", Number(alert.benchmark_multiplier || 1.5),
        alert.risk_trend || "", alert.risk_priority || "P1",
      ).run();
    }
    await db.prepare(`INSERT INTO dashboard_meta(key, value, updated_at) VALUES('risk_alert_meta', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).bind(JSON.stringify({
        generated_at: payload.generated_at,
        data_date: payload.data_date,
        source_name: payload.source_name,
        rule: payload.rule,
        summary: payload.summary,
      })).run();
    return Response.json({ ok: true, received: payload.alerts.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "同步失败" }, { status: 500 });
  }
}
