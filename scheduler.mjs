const DEFAULT_TICK_MS = 5000;

function safeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getSiteFrequencyMs(site, settings) {
  if (!site.useGlobalFrequency && site.frequencyMs) {
    return safeNumber(site.frequencyMs, settings.defaultFrequencyMs);
  }
  return safeNumber(settings.defaultFrequencyMs, 300000);
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function probeErrorFromResult(result) {
  if (result?.controllerError && !result?.probe?.ok) {
    return result.controllerError;
  }

  if (result?.probe?.ok) {
    return "";
  }

  if (result?.probe?.bodyText) {
    return result.probe.bodyText.slice(0, 500);
  }

  if (result?.probe?.status) {
    return `HTTP ${result.probe.status}`;
  }

  return "Probe failed";
}

function createResultRecord({ site, result, startedAt, finishedAt }) {
  const probe = result?.probe || {};
  return {
    siteId: site.id,
    siteName: site.name,
    startedAt,
    finishedAt,
    ok: Boolean(probe.ok),
    status: probe.status || null,
    endpoint: probe.endpoint || result?.endpointCandidates?.[0] || "",
    targetHost: result?.targetHost || "",
    headersMs: probe.headersMs ?? null,
    firstChunkMs: probe.firstChunkMs ?? null,
    firstTokenMs: probe.firstTokenMs ?? null,
    totalMs: probe.totalMs ?? null,
    preview: probe.preview || "",
    contentType: probe.contentType || "",
    error: probeErrorFromResult(result),
    controllerError: result?.controllerError || "",
    connections: Array.isArray(result?.connections) ? result.connections : [],
  };
}

function createFailureRecord({ site, error, startedAt, finishedAt }) {
  return {
    siteId: site.id,
    siteName: site.name,
    startedAt,
    finishedAt,
    ok: false,
    status: null,
    endpoint: "",
    targetHost: "",
    headersMs: null,
    firstChunkMs: null,
    firstTokenMs: null,
    totalMs: null,
    preview: "",
    contentType: "",
    error: error.message || String(error),
    controllerError: "",
    connections: [],
  };
}

export function createScheduler({
  store,
  probe,
  now = () => Date.now(),
  minTickMs = DEFAULT_TICK_MS,
}) {
  const runningSiteIds = new Set();
  const nextRunAtBySiteId = new Map();
  let timer = null;

  function currentMs() {
    const value = now();
    return value instanceof Date ? value.getTime() : Number(value);
  }

  function getRuntimeState() {
    return {
      runningSiteIds: Array.from(runningSiteIds),
      nextRuns: Object.fromEntries(
        Array.from(nextRunAtBySiteId.entries()).map(([siteId, time]) => [siteId, toIso(time)]),
      ),
      running: Boolean(timer),
    };
  }

  function markNextRun(site, settings, fromMs = currentMs()) {
    nextRunAtBySiteId.set(site.id, fromMs + getSiteFrequencyMs(site, settings));
  }

  async function runSiteNow(siteId) {
    if (runningSiteIds.has(siteId)) {
      return { skipped: true, reason: "already_running", siteId };
    }

    const config = store.readRawConfig();
    const site = store.getSiteWithSecret(siteId);
    if (!site) {
      return { skipped: true, reason: "site_not_found", siteId };
    }

    if (!site.apiKey) {
      return { skipped: true, reason: "missing_api_key", siteId };
    }

    runningSiteIds.add(siteId);
    const startedAtMs = currentMs();
    const startedAt = toIso(startedAtMs);

    try {
      const result = await probe({
        site,
        settings: config.settings,
        input: {
          baseUrl: site.baseUrl,
          apiKey: site.apiKey,
          model: site.model,
          prompt: site.prompt || config.settings.defaultPrompt,
          timeoutMs: site.timeoutMs || config.settings.defaultTimeoutMs,
          controllerUrl: site.controllerUrl || config.settings.controllerUrl,
          secret: site.controllerSecret || config.settings.controllerSecret,
        },
      });
      const record = createResultRecord({
        site,
        result,
        startedAt,
        finishedAt: toIso(currentMs()),
      });
      store.appendResult(record);
      markNextRun(site, config.settings);
      return { skipped: false, ...record };
    } catch (error) {
      const record = createFailureRecord({
        site,
        error,
        startedAt,
        finishedAt: toIso(currentMs()),
      });
      store.appendResult(record);
      markNextRun(site, config.settings);
      return { skipped: false, ...record };
    } finally {
      runningSiteIds.delete(siteId);
    }
  }

  // One-off read-only measurement. Runs the exact same probe as runSiteNow
  // but has ZERO side effects: it never appends history, never reschedules,
  // never touches the paused flag, and never enters the concurrency guard.
  // Use it to spot-check latency without disturbing any stored state.
  async function checkSiteNow(siteId) {
    const config = store.readRawConfig();
    const site = store.getSiteWithSecret(siteId);
    if (!site) {
      return { skipped: true, reason: "site_not_found", siteId };
    }

    if (!site.apiKey) {
      return { skipped: true, reason: "missing_api_key", siteId };
    }

    const startedAt = toIso(currentMs());

    try {
      const result = await probe({
        site,
        settings: config.settings,
        input: {
          baseUrl: site.baseUrl,
          apiKey: site.apiKey,
          model: site.model,
          prompt: site.prompt || config.settings.defaultPrompt,
          timeoutMs: site.timeoutMs || config.settings.defaultTimeoutMs,
          controllerUrl: site.controllerUrl || config.settings.controllerUrl,
          secret: site.controllerSecret || config.settings.controllerSecret,
        },
      });
      const record = createResultRecord({
        site,
        result,
        startedAt,
        finishedAt: toIso(currentMs()),
      });
      return { skipped: false, ephemeral: true, ...record };
    } catch (error) {
      const record = createFailureRecord({
        site,
        error,
        startedAt,
        finishedAt: toIso(currentMs()),
      });
      return { skipped: false, ephemeral: true, ...record };
    }
  }

  async function runAllNow() {
    const config = store.readRawConfig();
    const enabledSites = config.sites.filter((site) => site.enabled !== false && site.paused !== true);
    return Promise.all(enabledSites.map((site) => runSiteNow(site.id)));
  }

  async function tick() {
    const config = store.readRawConfig();
    if (!config.settings.autoEnabled) {
      return [];
    }

    const timestamp = currentMs();
    const dueSiteIds = [];

    for (const site of config.sites) {
      if (site.enabled === false || site.paused === true || !site.apiKey) {
        nextRunAtBySiteId.delete(site.id);
        continue;
      }

      if (!nextRunAtBySiteId.has(site.id)) {
        markNextRun(site, config.settings, timestamp);
        continue;
      }

      if (nextRunAtBySiteId.get(site.id) <= timestamp) {
        dueSiteIds.push(site.id);
      }
    }

    return Promise.all(dueSiteIds.map((siteId) => runSiteNow(siteId)));
  }

  function start() {
    if (timer) {
      return;
    }

    timer = setInterval(() => {
      tick().catch(() => {
      });
    }, Math.max(1000, minTickMs));
  }

  function stop() {
    if (!timer) {
      return;
    }
    clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    tick,
    runSiteNow,
    checkSiteNow,
    runAllNow,
    getRuntimeState,
  };
}
