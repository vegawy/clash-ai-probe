import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStore } from "../store.mjs";

async function withTempStore(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clash-ai-probe-store-"));
  try {
    const store = createStore(dir, {
      now: () => Date.parse("2026-06-24T12:00:00.000Z"),
    });
    await fn(store, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("createStore returns default sanitized state", async () => {
  await withTempStore(async (store) => {
    const state = store.readState();

    assert.equal(state.settings.autoEnabled, false);
    assert.equal(state.settings.defaultFrequencyMs, 300000);
    assert.equal(state.settings.defaultPrompt, "Say ok");
    assert.deepEqual(state.sites, []);
  });
});

test("createStore saves site secrets but only returns sanitized sites", async () => {
  await withTempStore(async (store) => {
    const saved = store.upsertSite({
      name: "Relay A",
      baseUrl: "https://relay.example/v1",
      model: "gpt-test",
      apiKey: "sk-secret",
      enabled: true,
    });

    const state = store.readState();
    assert.equal(state.sites.length, 1);
    assert.equal(state.sites[0].id, saved.id);
    assert.equal(state.sites[0].hasApiKey, true);
    assert.equal("apiKey" in state.sites[0], false);

    const raw = store.getSiteWithSecret(saved.id);
    assert.equal(raw.apiKey, "sk-secret");
  });
});

test("createStore appends history and reads count and time windows", async () => {
  await withTempStore(async (store) => {
    const site = store.upsertSite({
      name: "Relay A",
      baseUrl: "https://relay.example/v1",
      model: "gpt-test",
      apiKey: "sk-secret",
    });

    store.appendResult({
      siteId: site.id,
      ok: true,
      totalMs: 1000,
      finishedAt: "2026-06-23T11:59:00.000Z",
    });
    store.appendResult({
      siteId: site.id,
      ok: true,
      totalMs: 900,
      finishedAt: "2026-06-24T11:30:00.000Z",
    });
    store.appendResult({
      siteId: site.id,
      ok: false,
      error: "timeout",
      finishedAt: "2026-06-24T11:59:00.000Z",
    });

    assert.equal(store.readHistory(site.id, "50").length, 3);
    assert.equal(store.readHistory(site.id, "1h").length, 2);
    assert.equal(store.readHistory(site.id, "24h").length, 2);
    assert.equal(store.readHistory(site.id, "7d").length, 3);
  });
});
