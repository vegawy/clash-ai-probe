import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHistoryBars,
  buildOverviewMetrics,
  buildSiteDetailModel,
  buildSitesTableRows,
  buildSparklinePath,
} from "../public/ui-model.js";

test("buildOverviewMetrics counts desktop dashboard tiles", () => {
  const metrics = buildOverviewMetrics({
    scheduler: {
      runningSiteIds: ["site-1"],
    },
    sites: [
      { id: "site-1", enabled: true, health: { status: "stable" } },
      { id: "site-2", enabled: true, health: { status: "unstable" } },
      { id: "site-3", enabled: true, health: { status: "down" } },
      { id: "site-4", enabled: false, health: { status: "unknown" } },
    ],
  });

  assert.deepEqual(metrics, {
    total: 4,
    stable: 1,
    fluctuating: 1,
    unavailable: 1,
    testing: 1,
    paused: 1,
  });
});

test("buildSitesTableRows formats desktop table values", () => {
  const rows = buildSitesTableRows([
    {
      id: "site-1",
      name: "Relay A",
      baseUrl: "https://relay-a.example/v1",
      enabled: true,
      health: {
        status: "stable",
        successRate: 0.982,
        averageMs: 142,
        p95Ms: 185,
      },
    },
    {
      id: "site-2",
      name: "Relay B",
      baseUrl: "https://relay-b.example/v1",
      enabled: false,
      health: {
        status: "unknown",
        successRate: 0,
        averageMs: null,
        p95Ms: null,
      },
    },
  ]);

  assert.equal(rows[0].successLabel, "98.2%");
  assert.equal(rows[0].averageLabel, "142");
  assert.equal(rows[0].p95Label, "185");
  assert.equal(rows[0].statusTone, "stable");
  assert.equal(rows[1].statusLabel, "Paused");
  assert.equal(rows[1].averageLabel, "--");
});

test("buildSparklinePath creates a full-width desktop sparkline path", () => {
  const path = buildSparklinePath([
    { ok: true, totalMs: 100 },
    { ok: true, totalMs: 200 },
    { ok: false },
    { ok: true, totalMs: 300 },
  ], 100, 20);

  assert.equal(path.startsWith("M 0 "), true);
  assert.equal(path.includes("33.33"), true);
  assert.equal(path.endsWith(" 0"), false);
});

test("buildHistoryBars marks peaks and failures for the detail chart", () => {
  const bars = buildHistoryBars([
    { ok: true, totalMs: 120, finishedAt: "2026-06-24T00:00:00.000Z" },
    { ok: true, totalMs: 820, finishedAt: "2026-06-24T00:01:00.000Z" },
    { ok: false, error: "timeout", finishedAt: "2026-06-24T00:02:00.000Z" },
  ]);

  assert.equal(bars.length, 3);
  assert.equal(bars[0].tone, "stable");
  assert.equal(bars[1].tone, "peak");
  assert.equal(bars[2].tone, "failure");
  assert.equal(bars[2].heightPct, 0);
});

test("buildSiteDetailModel maps the selected site into desktop detail widgets", () => {
  const detail = buildSiteDetailModel(
    {
      id: "site-1",
      name: "Relay A",
      baseUrl: "https://relay-a.example/v1",
      model: "gpt-4.1-mini",
      enabled: true,
      hasApiKey: true,
      health: {
        status: "stable",
        successRate: 0.95,
        averageMs: 420,
        medianMs: 400,
        p95Ms: 820,
        jitterMs: 95,
      },
    },
    {
      window: "1h",
      health: {
        status: "stable",
        successRate: 0.98,
        averageMs: 320,
        medianMs: 300,
        p95Ms: 640,
        jitterMs: 120,
      },
      results: [
        {
          ok: false,
          status: 502,
          error: "bad gateway",
          finishedAt: "2026-06-24T00:00:00.000Z",
        },
        {
          ok: true,
          status: 200,
          endpoint: "https://relay-a.example/v1/chat/completions",
          totalMs: 345,
          firstTokenMs: 210,
          firstChunkMs: 180,
          headersMs: 140,
          preview: "ok",
          connections: [
            {
              chain: "Proxy-A",
              rule: "DOMAIN-SUFFIX",
              rulePayload: "openai.com",
              dnsMode: "fake-ip",
              remoteDestination: "104.18.2.161",
            },
          ],
          finishedAt: "2026-06-24T00:05:00.000Z",
        },
      ],
    },
  );

  assert.equal(detail.statusLabel, "Stable");
  assert.equal(detail.successLabel, "98.0%");
  assert.equal(detail.averageLabel, "320");
  assert.equal(detail.windowLabel, "1h");
  assert.equal(detail.lastProbe.statusLabel, "200");
  assert.equal(detail.lastProbe.totalLabel, "345 ms");
  assert.equal(detail.route.chainLabel, "Proxy-A");
  assert.equal(detail.failureRows.length, 1);
  assert.equal(detail.failureRows[0].codeLabel, "502");
});
