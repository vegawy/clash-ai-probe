# Monitor Panel Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend foundation for saved AI relay endpoints, scheduled probing, health summaries, and history APIs while leaving the final UI replaceable.

**Architecture:** Keep `probe-core.mjs` focused on one real probe. Add local-file storage, health calculation, and a central scheduler around it. Keep `server.mjs` as the HTTP boundary that exposes JSON APIs and sanitizes secrets.

**Tech Stack:** Node.js ES modules, Node built-in `node:test`, JSON config storage, JSONL result storage, existing native HTTP server.

---

### Task 1: Test Harness

**Files:**
- Modify: `package.json`
- Create: `test/health.test.mjs`
- Create: `test/store.test.mjs`
- Create: `test/scheduler.test.mjs`

- [ ] **Step 1: Add a Node test script**

Set `package.json` scripts to include:

```json
{
  "start": "node server.mjs",
  "test": "node --test"
}
```

- [ ] **Step 2: Write failing tests before production modules**

Create tests that import missing modules:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { calculateHealth } from "../health.mjs";

test("calculateHealth marks healthy recent successes as stable", () => {
  const summary = calculateHealth([
    { ok: true, totalMs: 900, firstTokenMs: 650, finishedAt: "2026-06-24T00:00:00.000Z" },
    { ok: true, totalMs: 980, firstTokenMs: 700, finishedAt: "2026-06-24T00:01:00.000Z" },
    { ok: true, totalMs: 920, firstTokenMs: 680, finishedAt: "2026-06-24T00:02:00.000Z" }
  ]);
  assert.equal(summary.status, "stable");
});
```

- [ ] **Step 3: Run tests and confirm missing-module failures**

Run: `npm test`

Expected: FAIL because `health.mjs`, `store.mjs`, and `scheduler.mjs` do not exist yet.

### Task 2: Store Module

**Files:**
- Create: `store.mjs`
- Test: `test/store.test.mjs`

- [ ] **Step 1: Test default state creation**

Verify `createStore(tempDir).readState()` creates default global settings and no sites.

- [ ] **Step 2: Test API key sanitization**

Verify saved site records include `apiKey`, but `listSites()` and `readState()` return only `hasApiKey: true`.

- [ ] **Step 3: Test JSONL history append and window reads**

Verify appended probe results can be read by site id for `50`, `1h`, `6h`, `24h`, and `7d`.

- [ ] **Step 4: Implement store**

Implement:

```js
export function createStore(rootDir) {
  return {
    readState,
    updateSettings,
    upsertSite,
    deleteSite,
    getSiteWithSecret,
    appendResult,
    readHistory,
    readRawConfig
  };
}
```

Use atomic config writes: write to `config.json.tmp`, then rename to `config.json`.

### Task 3: Health Module

**Files:**
- Create: `health.mjs`
- Test: `test/health.test.mjs`

- [ ] **Step 1: Test stable status**

Recent successful samples with low latency spread return `stable`.

- [ ] **Step 2: Test unstable status**

Mixed success and high spread return `unstable`.

- [ ] **Step 3: Test down status**

Recent consecutive failures or zero successes return `down`.

- [ ] **Step 4: Implement health summary**

Implement:

```js
export function calculateHealth(results, options = {}) {
  return {
    status,
    sampleCount,
    successCount,
    failureCount,
    successRate,
    averageMs,
    maxMs,
    jitterMs,
    lastCheckedAt,
    lastError
  };
}
```

### Task 4: Scheduler Module

**Files:**
- Create: `scheduler.mjs`
- Test: `test/scheduler.test.mjs`

- [ ] **Step 1: Test next-run selection**

Given enabled sites and global settings, due sites are selected by `nextRunAt`.

- [ ] **Step 2: Test per-site frequency override**

Sites with `frequencyMs` use it instead of global `defaultFrequencyMs`.

- [ ] **Step 3: Test per-site concurrency guard**

If a site is already running, another run request for that site is skipped.

- [ ] **Step 4: Implement scheduler**

Implement:

```js
export function createScheduler({ store, probe, now, minTickMs }) {
  return {
    start,
    stop,
    runSiteNow,
    runAllNow,
    getRuntimeState
  };
}
```

### Task 5: API Wiring

**Files:**
- Modify: `server.mjs`
- Modify: `Dockerfile`
- Modify: `README.md`

- [ ] **Step 1: Add monitor APIs**

Expose:

```text
GET /api/state
POST /api/settings
POST /api/sites
DELETE /api/sites/:id
POST /api/sites/:id/probe
POST /api/probe-all
GET /api/sites/:id/history?window=50|1h|6h|24h|7d
```

- [ ] **Step 2: Sanitize secrets**

Never return `apiKey` or `controllerSecret` from monitor APIs.

- [ ] **Step 3: Persist Docker data**

Document and copy support for `/app/data`; recommend mounting it in Docker Compose.

### Task 6: Verification

**Files:**
- Existing files touched by earlier tasks

- [ ] **Step 1: Run unit tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run server syntax smoke test**

Run: `node --check server.mjs`

Expected: no syntax errors.

- [ ] **Step 3: Start local server**

Run: `node server.mjs`

Expected: server listens on `http://0.0.0.0:3000`.

- [ ] **Step 4: Exercise safe APIs**

Call `GET /api/state` and confirm it returns settings, sites, summaries, and no secrets.
