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
  assert.match(client, /人工审核/);
  assert.match(client, /二次铺设/);
  assert.match(client, /防车商/);
  assert.match(client, /评论回复/);
  assert.match(client, /复查完成/);
  assert.equal(payload.scope.category, "供应商");
  assert.equal(payload.scope.published_since, "2026-06-01");
  assert.equal(payload.summary.total, 81);
  assert.equal(payload.summary.p0, 48);
  assert.ok(payload.tasks.every((task) => task.note_id && task.link));
});
