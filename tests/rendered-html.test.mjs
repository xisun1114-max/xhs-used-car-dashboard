import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the supplier comment maintenance workspace and real task payload", async () => {
  const [page, client, layout, payloadText] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/data/dashboard.json", import.meta.url), "utf8"),
  ]);
  const payload = JSON.parse(payloadText);
  assert.match(page, /DashboardClient/);
  assert.match(layout, /供应商笔记评论维护工作台/);
  assert.match(client, /待处理/);
  assert.match(client, /已完成/);
  assert.match(client, /新铺设/);
  assert.match(client, /防车商/);
  assert.equal(payload.scope.category, "供应商");
  assert.equal(payload.scope.published_since, "2026-06-01");
  assert.match(client, /本轮无需处理/);
  assert.match(client, /置顶评论/);
  assert.match(client, /官号回复/);
  assert.match(client, /插入图片/);
  assert.match(client, /双击文字进入编辑/);
  assert.match(client, /双击撤回/);
  assert.match(client, /每轮限一次/);
  assert.match(client, /下载当前清单/);
  assert.equal(payload.summary.total, 39);
  assert.equal(payload.summary.p0, 14);
  assert.ok(payload.tasks.every((task) => task.note_id && task.link));
  assert.ok(payload.tasks.every((task) => task.resolution_status === "pending"));
});
