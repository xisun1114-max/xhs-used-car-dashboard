import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the supplier comment maintenance workspace and a consistent task payload", async () => {
  const [page, client, payloadText] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/data/dashboard.json", import.meta.url), "utf8"),
  ]);
  const payload = JSON.parse(payloadText);
  assert.match(page, /DashboardClient/);
  assert.match(client, /\/api\/dashboard/);
  assert.match(client, /\/api\/sync/);
  assert.equal(payload.scope.published_since, "2026-06-01");
  assert.equal(payload.summary.total, payload.tasks.length);
  for (const priority of ["p0", "p1", "p2"]) {
    assert.equal(
      payload.summary[priority],
      payload.tasks.filter((task) => task.priority.toLowerCase() === priority).length,
    );
  }
  assert.ok(payload.tasks.every((task) => task.note_id && task.link));
  assert.ok(payload.tasks.every((task) => task.resolution_status === "pending"));
});
