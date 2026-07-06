import test from "node:test";
import assert from "node:assert/strict";

import { createScheduler } from "../scheduler.mjs";

function createMemoryStore() {
  const results = [];
  const state = {
    settings: {
      autoEnabled: true,
      defaultFrequencyMs: 300000,
      defaultPrompt: "pong",
      defaultTimeoutMs: 45000,
      controllerUrl: "",
      controllerSecret: "",
    },
    sites: [
      {
        id: "a",
        name: "Relay A",
        baseUrl: "https://a.example/v1",
        model: "gpt-test",
        apiKey: "sk-a",
        enabled: true,
        useGlobalFrequency: true,
      },
      {
        id: "b",
        name: "Relay B",
        baseUrl: "https://b.example/v1",
        model: "gpt-test",
        apiKey: "sk-b",
        enabled: true,
        useGlobalFrequency: false,
        frequencyMs: 60000,
      },
      {
        id: "c",
        name: "Relay C",
        baseUrl: "https://c.example/v1",
        model: "gpt-test",
        apiKey: "sk-c",
        enabled: false,
      },
    ],
  };

  return {
    results,
    readRawConfig() {
      return structuredClone(state);
    },
    getSiteWithSecret(id) {
      return structuredClone(state.sites.find((site) => site.id === id) || null);
    },
    appendResult(result) {
      results.push(result);
      return result;
    },
    setSitePaused(id, paused) {
      const target = state.sites.find((site) => site.id === id);
      if (!target) {
        return null;
      }
      target.paused = Boolean(paused);
      return structuredClone(target);
    },
  };
}

test("scheduler runAllNow probes enabled sites and skips disabled sites", async () => {
  const store = createMemoryStore();
  const probed = [];
  const scheduler = createScheduler({
    store,
    now: () => Date.parse("2026-06-24T12:00:00.000Z"),
    probe: async ({ site }) => {
      probed.push(site.id);
      return {
        targetHost: new URL(site.baseUrl).hostname,
        endpointCandidates: [`${site.baseUrl}/chat/completions`],
        probe: { ok: true, status: 200, totalMs: 1000, firstTokenMs: 700 },
        connections: [],
      };
    },
  });

  const results = await scheduler.runAllNow();

  assert.deepEqual(probed.sort(), ["a", "b"]);
  assert.equal(results.length, 2);
  assert.equal(store.results.length, 2);
});

test("scheduler tick uses per-site frequency override", async () => {
  let current = Date.parse("2026-06-24T12:00:00.000Z");
  const store = createMemoryStore();
  const probed = [];
  const scheduler = createScheduler({
    store,
    now: () => current,
    probe: async ({ site }) => {
      probed.push(site.id);
      return {
        targetHost: new URL(site.baseUrl).hostname,
        endpointCandidates: [],
        probe: { ok: true, status: 200, totalMs: 1000 },
        connections: [],
      };
    },
  });

  await scheduler.tick();
  current += 61000;
  await scheduler.tick();

  assert.deepEqual(probed, ["b"]);
});

test("scheduler skips duplicate run for the same site while it is running", async () => {
  const store = createMemoryStore();
  let releaseProbe;
  const firstProbeCanFinish = new Promise((resolve) => {
    releaseProbe = resolve;
  });
  const scheduler = createScheduler({
    store,
    now: () => Date.parse("2026-06-24T12:00:00.000Z"),
    probe: async ({ site }) => {
      await firstProbeCanFinish;
      return {
        targetHost: new URL(site.baseUrl).hostname,
        endpointCandidates: [],
        probe: { ok: true, status: 200, totalMs: 1000 },
        connections: [],
      };
    },
  });

  const first = scheduler.runSiteNow("a");
  const second = await scheduler.runSiteNow("a");
  releaseProbe();

  const firstResult = await first;
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "already_running");
  assert.equal(firstResult.skipped, false);
});

test("scheduler tick and runAllNow skip paused sites", async () => {
  const store = createMemoryStore();
  store.setSitePaused("a", true);
  store.setSitePaused("b", true);

  const probed = [];
  let current = Date.parse("2026-06-24T12:00:00.000Z");
  const scheduler = createScheduler({
    store,
    now: () => current,
    probe: async ({ site }) => {
      probed.push(site.id);
      return {
        targetHost: new URL(site.baseUrl).hostname,
        endpointCandidates: [],
        probe: { ok: true, status: 200, totalMs: 100 },
        connections: [],
      };
    },
  });

  await scheduler.tick();
  current += 600000;
  await scheduler.tick();
  const allResults = await scheduler.runAllNow();

  assert.deepEqual(probed, []);
  assert.equal(allResults.length, 0);
});

test("scheduler runSiteNow leaves the paused flag untouched", async () => {
  const store = createMemoryStore();
  store.setSitePaused("a", true);

  const scheduler = createScheduler({
    store,
    now: () => Date.parse("2026-06-24T12:00:00.000Z"),
    probe: async ({ site }) => ({
      targetHost: new URL(site.baseUrl).hostname,
      endpointCandidates: [],
      probe: { ok: true, status: 200, totalMs: 100 },
      connections: [],
    }),
  });

  const result = await scheduler.runSiteNow("a");
  assert.equal(result.skipped, false);
  // A manual probe records history but must NOT silently un-pause the site.
  assert.equal(store.readRawConfig().sites.find((site) => site.id === "a").paused, true);
});

test("scheduler checkSiteNow measures without any side effects", async () => {
  const store = createMemoryStore();
  store.setSitePaused("a", true);
  let probeCalls = 0;

  const scheduler = createScheduler({
    store,
    now: () => Date.parse("2026-06-24T12:00:00.000Z"),
    probe: async ({ site }) => {
      probeCalls += 1;
      return {
        targetHost: new URL(site.baseUrl).hostname,
        endpointCandidates: [],
        probe: { ok: true, status: 200, totalMs: 123, firstTokenMs: 80 },
        connections: [],
      };
    },
  });

  const result = await scheduler.checkSiteNow("a");

  // It ran a real probe and returned a usable record...
  assert.equal(probeCalls, 1);
  assert.equal(result.skipped, false);
  assert.equal(result.ok, true);
  assert.equal(result.totalMs, 123);

  // ...but changed nothing: no history written, pause preserved, nothing scheduled.
  assert.equal(store.results.length, 0);
  assert.equal(store.readRawConfig().sites.find((site) => site.id === "a").paused, true);
  assert.deepEqual(scheduler.getRuntimeState().nextRuns, {});
  assert.deepEqual(scheduler.getRuntimeState().runningSiteIds, []);
});

test("scheduler checkSiteNow skips a site with no API key", async () => {
  const results = [];
  const store = {
    results,
    readRawConfig() {
      return { settings: { defaultPrompt: "pong", defaultTimeoutMs: 45000 }, sites: [] };
    },
    getSiteWithSecret() {
      return { id: "a", name: "A", baseUrl: "https://a.example.com", model: "gpt-test", enabled: true };
    },
    appendResult(result) {
      results.push(result);
      return result;
    },
  };
  const scheduler = createScheduler({
    store,
    now: () => Date.parse("2026-06-24T12:00:00.000Z"),
    probe: async () => {
      throw new Error("probe should not run without an API key");
    },
  });

  const result = await scheduler.checkSiteNow("a");
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "missing_api_key");
  assert.equal(store.results.length, 0);
});
