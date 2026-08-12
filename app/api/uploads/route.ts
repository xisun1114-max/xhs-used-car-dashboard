import { env } from "cloudflare:workers";
import { ensureSchema, getD1 } from "../../../db/runtime";

type RuntimeEnv = { UPLOADS?: R2Bucket };
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const actor = String(form.get("actor") || "").trim();
    const taskId = String(form.get("task_id") || "").trim();
    if (!(file instanceof File) || !actor || !taskId) return Response.json({ error: "缺少图片、操作人或任务信息" }, { status: 400 });
    if (!allowedTypes.has(file.type)) return Response.json({ error: "仅支持 JPG、PNG、WebP、GIF 图片" }, { status: 400 });
    if (file.size > 8 * 1024 * 1024) return Response.json({ error: "图片不能超过 8MB" }, { status: 400 });
    const bucket = (env as RuntimeEnv).UPLOADS;
    if (!bucket) return Response.json({ error: "图片存储服务暂未连接" }, { status: 503 });
    const db = getD1();
    await ensureSchema(db);
    const task = await db.prepare("SELECT task_id, note_id FROM maintenance_tasks WHERE task_id=?").bind(taskId).first<{ task_id: string; note_id: string }>();
    if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });
    const extension = file.type.split("/")[1].replace("jpeg", "jpg");
    const key = `notes/${task.note_id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { actor, taskId } });
    await db.prepare(`INSERT INTO note_uploads(task_id, note_id, actor, object_key, file_name, content_type, size)
      VALUES(?, ?, ?, ?, ?, ?, ?)`).bind(task.task_id, task.note_id, actor, key, file.name, file.type, file.size).run();
    return Response.json({ url: `/api/uploads/${key.split("/").map(encodeURIComponent).join("/")}` }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "图片上传失败" }, { status: 500 });
  }
}
