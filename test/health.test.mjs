import test from "node:test";
import assert from "node:assert/strict";

import { calculateHealth } from "../health.mjs";

test("calculateHealth marks healthy recent successes as stable", () => {
  const summary = calculateHealth([
    { ok: true, totalMs: 900, firstTokenMs: 650, finishedAt: "2026-06-24T00:00:00.000Z" },
    { ok: true, totalMs: 980, firstTokenMs: 700, finishedAt: "2026-06-24T00:01:00.000Z" },
    { ok: true, totalMs: 920, firstTokenMs: 680, finishedAt: "2026-06-24T00:02:00.000Z" },
  ]);

  assert.equal(summary.status, "stable");
  assert.equal(summary.successRate, 1);
  assert.equal(summary.averageMs, 930);
  assert.equal(summary.jitterMs, 80);
  assert.equal(summary.medianMs, 920);
  assert.equal(summary.p95Ms, 980);
});

test("calculateHealth marks mixed success and high jitter as unstable", () => {
  const summary = calculateHealth([
    { ok: true, totalMs: 800, firstTokenMs: 500, finishedAt: "2026-06-24T00:00:00.000Z" },
    { ok: true, totalMs: 2600, firstTokenMs: 2100, finishedAt: "2026-06-24T00:01:00.000Z" },
    { ok: false, error: "timeout", finishedAt: "2026-06-24T00:02:00.000Z" },
  ]);

  assert.equal(summary.status, "unstable");
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.failureCount, 1);
  assert.equal(summary.lastError, "timeout");
  assert.equal(summary.medianMs, 1700);
  assert.equal(summary.p95Ms, 2600);
});

test("calculateHealth marks consecutive failures as down", () => {
  const summary = calculateHealth([
    { ok: true, totalMs: 900, finishedAt: "2026-06-24T00:00:00.000Z" },
    { ok: false, error: "HTTP 502", finishedAt: "2026-06-24T00:01:00.000Z" },
    { ok: false, error: "timeout", finishedAt: "2026-06-24T00:02:00.000Z" },
    { ok: false, error: "timeout", finishedAt: "2026-06-24T00:03:00.000Z" },
  ]);

  assert.equal(summary.status, "down");
  assert.equal(summary.lastError, "timeout");
});

test("calculateHealth returns unknown for no samples", () => {
  const summary = calculateHealth([]);

  assert.equal(summary.status, "unknown");
  assert.equal(summary.sampleCount, 0);
});
