function statusToneFromSite(site) {
  if (site.enabled === false || site.paused === true) {
    return "paused";
  }

  const status = site.health?.status || "unknown";
  if (status === "stable") {
    return "stable";
  }
  if (status === "unstable") {
    return "fluctuating";
  }
  if (status === "down") {
    return "unavailable";
  }
  return "pending";
}

function statusLabelFromTone(tone) {
  if (tone === "stable") {
    return "Stable";
  }
  if (tone === "fluctuating") {
    return "Fluctuating";
  }
  if (tone === "unavailable") {
    return "Unavailable";
  }
  if (tone === "pending") {
    return "Pending";
  }
  return "Paused";
}

function shortUrl(value) {
  if (!value) {
    return "--";
  }
  try {
    const url = new URL(value);
    const compact = `${url.origin}${url.pathname}`.replace(/\/$/, "");
    return compact.length > 26 ? `${compact.slice(0, 23)}...` : compact;
  } catch {
    return value.length > 26 ? `${value.slice(0, 23)}...` : value;
  }
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "0.0%";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatMetric(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : "--";
}

function formatMetricMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : "--";
}

function latencyOf(result) {
  const value = result?.totalMs ?? result?.firstTokenMs ?? result?.headersMs;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function firstConnection(result) {
  if (!Array.isArray(result?.connections) || !result.connections.length) {
    return null;
  }
  return result.connections[0];
}

function errorCodeOf(result) {
  if (result?.status) {
    return String(result.status);
  }
  if (!result?.ok) {
    return "FAIL";
  }
  return "--";
}

function messageOf(result) {
  if (result?.error) {
    return result.error;
  }
  if (result?.preview) {
    return result.preview;
  }
  return result?.ok ? "ok" : "Probe failed";
}

const WORKSPACE_VIEWS = new Set(["overview", "sites", "scheduler", "settings"]);

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function frequencyLabel(site, settings) {
  const defaultFrequencyMs = settings?.defaultFrequencyMs || 300000;
  const effectiveMs = site?.useGlobalFrequency === false && site?.frequencyMs
    ? site.frequencyMs
    : defaultFrequencyMs;
  const minutes = Math.max(1, Math.round(safeNumber(effectiveMs, defaultFrequencyMs) / 60000));
  return site?.useGlobalFrequency === false && site?.frequencyMs
    ? `单站 ${minutes} 分钟`
    : `全局 ${minutes} 分钟`;
}

function resolveNow(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function relativeTimeLabel(value, now = Date.now()) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) {
    return "--";
  }

  const diff = Math.max(0, now - time);
  if (diff < 60_000) {
    return `${Math.max(1, Math.round(diff / 1000))} 秒前`;
  }
  if (diff < 3_600_000) {
    return `${Math.max(1, Math.round(diff / 60_000))} 分钟前`;
  }
  if (diff < 86_400_000) {
    return `${Math.max(1, Math.round(diff / 3_600_000))} 小时前`;
  }
  return `${Math.max(1, Math.round(diff / 86_400_000))} 天前`;
}

export function normalizeWorkspaceView(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase();
  return WORKSPACE_VIEWS.has(normalized) ? normalized : "overview";
}

export function buildWorkspaceLayout(value) {
  const view = normalizeWorkspaceView(value);

  if (view === "sites") {
    return {
      showOverview: false,
      showGrid: true,
      showScheduler: false,
      showSettings: false,
      forceDefaultsOpen: false,
    };
  }

  if (view === "scheduler") {
    return {
      showOverview: true,
      showGrid: false,
      showScheduler: true,
      showSettings: false,
      forceDefaultsOpen: false,
    };
  }

  if (view === "settings") {
    return {
      showOverview: false,
      showGrid: false,
      showScheduler: false,
      showSettings: true,
      forceDefaultsOpen: true,
    };
  }

  return {
    showOverview: true,
    showGrid: true,
    showScheduler: false,
    showSettings: false,
    forceDefaultsOpen: false,
  };
}

export function buildSchedulerRows(state, options = {}) {
  const sites = state?.sites || [];
  const settings = state?.settings || {};
  const runningIds = new Set(state?.scheduler?.runningSiteIds || []);
  const now = resolveNow(options.now);

  return sites.map((site) => {
    const tone = statusToneFromSite(site);
    const lastCheckedAt = site?.health?.lastCheckedAt || site?.lastResult?.finishedAt || "";

    let runtimeLabel = "等待下一次轮询";
    if (site?.enabled === false) {
      runtimeLabel = "已暂停";
    } else if (site?.paused === true) {
      runtimeLabel = "已停止 (待手动恢复)";
    } else if (runningIds.has(site?.id)) {
      runtimeLabel = "检测中";
    }

    return {
      id: site?.id || "",
      nameLabel: site?.name || "未命名节点",
      modelLabel: site?.model || "--",
      cadenceLabel: frequencyLabel(site, settings),
      lastCheckedAt,
      lastCheckedLabel: relativeTimeLabel(lastCheckedAt, now),
      runtimeLabel,
      statusTone: tone,
      statusLabel: statusLabelFromTone(tone),
      urlLabel: shortUrl(site?.baseUrl),
    };
  });
}

export function buildOverviewMetrics(state) {
  const sites = state?.sites || [];
  const runningIds = new Set(state?.scheduler?.runningSiteIds || []);
  let stable = 0;
  let fluctuating = 0;
  let unavailable = 0;
  let paused = 0;

  for (const site of sites) {
    const tone = statusToneFromSite(site);
    if (tone === "stable") {
      stable += 1;
    } else if (tone === "fluctuating") {
      fluctuating += 1;
    } else if (tone === "unavailable") {
      unavailable += 1;
    } else if (tone === "paused") {
      paused += 1;
    }
  }

  return {
    total: sites.length,
    stable,
    fluctuating,
    unavailable,
    testing: runningIds.size,
    paused,
  };
}

export function buildSparklinePath(results, width = 132, height = 24) {
  const values = (results || []).map((item) => {
    if (!item?.ok) {
      return null;
    }
    const value = item.totalMs ?? item.firstTokenMs ?? item.headersMs;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  });
  const validValues = values.filter((value) => value !== null);

  if (!validValues.length) {
    return "";
  }

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const range = Math.max(1, max - min);
  const lastIndex = Math.max(1, values.length - 1);

  return values
    .map((value, index) => {
      const x = Number(((index / lastIndex) * width).toFixed(2));
      const normalized = value === null ? 1 : (value - min) / range;
      const plotHeight = height * 0.8;
      const topInset = height * 0.1;
      const y = Number((topInset + (plotHeight - (normalized * plotHeight))).toFixed(2));
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

export function buildSitesTableRows(sites) {
  return (sites || []).map((site, index) => {
    const tone = statusToneFromSite(site);
    return {
      ...site,
      indexLabel: String(index + 1).padStart(2, "0"),
      urlLabel: shortUrl(site.baseUrl),
      statusTone: tone,
      statusLabel: statusLabelFromTone(tone),
      successLabel: formatPercent(site.health?.successRate ?? 0),
      averageLabel: formatMetric(site.health?.averageMs),
      p95Label: formatMetric(site.health?.p95Ms),
    };
  });
}

export function buildHistoryBars(results, options = {}) {
  const source = Array.isArray(results) ? results : [];
  const maxBars = Number.isFinite(Number(options.maxBars)) ? Number(options.maxBars) : source.length || 0;
  const items = maxBars > 0 ? source.slice(-maxBars) : source;
  const latencies = items.map(latencyOf).filter((value) => value !== null);
  const maxLatency = latencies.length ? Math.max(...latencies) : 1;
  const minLatency = latencies.length ? Math.min(...latencies) : 0;
  const peakFloor = Math.max(800, minLatency + ((maxLatency - minLatency) * 0.75));

  return items.map((result, index) => {
    const latency = latencyOf(result);
    if (!result?.ok || latency === null) {
      return {
        index,
        tone: "failure",
        heightPct: 0,
        latency: null,
        label: result?.error || "Probe failed",
      };
    }

    const tone = latency >= peakFloor ? "peak" : "stable";
    const heightPct = Number(((latency / Math.max(maxLatency, 1)) * 100).toFixed(2));
    return {
      index,
      tone,
      heightPct,
      latency,
      label: `${Math.round(latency)} ms`,
    };
  });
}

export function buildSiteDetailModel(site, historyPayload) {
  const currentSite = site || {};
  const history = historyPayload || {};
  const health = history.health || currentSite.health || {};
  const results = Array.isArray(history.results) ? history.results : [];
  const lastResult = results.at(-1) || currentSite.lastResult || null;
  const lastSuccess = [...results].reverse().find((result) => result?.ok) || null;
  const route = firstConnection(lastSuccess || lastResult);
  const tone = statusToneFromSite({
    ...currentSite,
    health,
  });

  return {
    id: currentSite.id || "",
    name: currentSite.name || "Select a relay",
    baseUrl: currentSite.baseUrl || "",
    model: currentSite.model || "",
    statusTone: tone,
    statusLabel: statusLabelFromTone(tone),
    windowLabel: history.window || "50",
    successLabel: formatPercent(health.successRate ?? 0),
    averageLabel: formatMetric(health.averageMs),
    medianLabel: formatMetric(health.medianMs),
    p95Label: formatMetric(health.p95Ms),
    jitterLabel: formatMetric(health.jitterMs),
    keyStatusLabel: currentSite.hasApiKey ? "API Key Saved" : "API Key Missing",
    hasApiKey: Boolean(currentSite.hasApiKey),
    lastProbe: {
      checkedAt: lastResult?.finishedAt || lastResult?.recordedAt || "",
      statusLabel: lastResult?.status ? String(lastResult.status) : (lastResult?.ok ? "200" : "--"),
      endpointLabel: lastResult?.endpoint || currentSite.baseUrl || "",
      totalLabel: formatMetricMs(lastResult?.totalMs),
      firstTokenLabel: formatMetricMs(lastResult?.firstTokenMs),
      firstChunkLabel: formatMetricMs(lastResult?.firstChunkMs),
      headersLabel: formatMetricMs(lastResult?.headersMs),
      previewLabel: lastResult?.preview || "",
      errorLabel: lastResult?.error || "",
    },
    route: {
      chainLabel: route?.chain || "--",
      ruleLabel: route?.rule
        ? `${route.rule}${route.rulePayload ? `,${route.rulePayload}` : ""}`
        : "--",
      dnsModeLabel: route?.dnsMode || "--",
      remoteLabel: route?.remoteDestination || "--",
    },
    historyBars: buildHistoryBars(results, { maxBars: 32 }),
    failureRows: [...results]
      .filter((result) => !result?.ok)
      .reverse()
      .slice(0, 8)
      .map((result) => ({
        timeLabel: result?.finishedAt || result?.recordedAt || "",
        codeLabel: errorCodeOf(result),
        messageLabel: messageOf(result),
      })),
  };
}

/* =========================================================
   NiyuLab template panel models
   Pure data -> view-model helpers for the redesigned dashboard.
   No DOM here; app.js renders the returned structures into the
   template markup. Existing exports above are untouched so the
   original unit tests keep passing.
   ========================================================= */

const WINDOW_SPANS_MS = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

function hostOf(value) {
  if (!value) {
    return "--";
  }
  try {
    return new URL(value).host;
  } catch {
    return String(value).replace(/^https?:\/\//, "").split("/")[0] || "--";
  }
}

function toneToServiceStatus(tone) {
  if (tone === "stable") {
    return { cls: "good", label: "Stable", dataStatus: "healthy" };
  }
  if (tone === "fluctuating") {
    return { cls: "warn", label: "Fluctuating", dataStatus: "warn" };
  }
  if (tone === "unavailable") {
    return { cls: "bad", label: "Unavailable", dataStatus: "critical" };
  }
  if (tone === "paused") {
    return { cls: "muted", label: "Paused", dataStatus: "warn" };
  }
  return { cls: "muted", label: "Pending", dataStatus: "warn" };
}

export function buildChartGeometry(values, options = {}) {
  const width = Number(options.width) || 840;
  const height = Number(options.height) || 178;
  const padTop = Number.isFinite(options.padTop) ? options.padTop : 16;
  const padBottom = Number.isFinite(options.padBottom) ? options.padBottom : 14;
  const series = (values || []).map((value) => (Number.isFinite(Number(value)) ? Number(value) : null));
  const valid = series.filter((value) => value !== null);
  const baseline = Number((height - padBottom).toFixed(2));

  if (!valid.length) {
    return { hasData: false, linePoints: "", areaPoints: "", markerX: 0, markerY: baseline, min: null, max: null };
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = Math.max(1, max - min);
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const lastIndex = Math.max(1, series.length - 1);

  const points = series.map((value, index) => {
    const x = Number(((index / lastIndex) * width).toFixed(2));
    const normalized = value === null ? 0.5 : (value - min) / range;
    const y = Number((padTop + (plotHeight - (normalized * plotHeight))).toFixed(2));
    return { x, y };
  });

  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const firstX = points[0].x;
  const lastX = points[points.length - 1].x;
  const areaPoints = `${firstX},${baseline} ${linePoints} ${lastX},${baseline}`;
  const marker = points[points.length - 1];

  return {
    hasData: true,
    linePoints,
    areaPoints,
    markerX: marker.x,
    markerY: marker.y,
    min,
    max,
  };
}

export function filterResultsByWindow(results, windowKey, now = Date.now()) {
  const span = WINDOW_SPANS_MS[windowKey];
  if (!span) {
    return [...(results || [])];
  }
  const minTime = now - span;
  return (results || []).filter((result) => {
    const time = Date.parse(result?.finishedAt || result?.recordedAt || "");
    return Number.isFinite(time) && time >= minTime;
  });
}

export function mergeRecentResults(sites) {
  const rows = [];
  for (const site of sites || []) {
    for (const result of site?.recentResults || []) {
      rows.push({
        ...result,
        siteId: site.id,
        siteName: result.siteName || site.name,
        baseUrl: site.baseUrl,
      });
    }
  }
  rows.sort((a, b) => {
    const timeA = Date.parse(a.finishedAt || a.recordedAt || "") || 0;
    const timeB = Date.parse(b.finishedAt || b.recordedAt || "") || 0;
    return timeA - timeB;
  });
  return rows;
}

export function latencySeries(results) {
  return (results || []).map((result) => {
    if (!result?.ok) {
      return null;
    }
    const value = result.totalMs ?? result.firstTokenMs ?? result.headersMs;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  });
}

export function buildStageBreakdown(result) {
  const record = result || {};
  const headers = Number(record.headersMs);
  const firstChunk = Number(record.firstChunkMs);
  const firstToken = Number(record.firstTokenMs);
  const total = Number(record.totalMs);

  const stages = [
    {
      label: "连接 + 响应头",
      fill: "fill-db",
      ms: Number.isFinite(headers) ? Math.max(0, headers) : 0,
    },
    {
      label: "首包等待",
      fill: "fill-net",
      ms: Number.isFinite(firstChunk) && Number.isFinite(headers) ? Math.max(0, firstChunk - headers) : 0,
    },
    {
      label: "首 Token",
      fill: "fill-app",
      ms: Number.isFinite(firstToken) && Number.isFinite(firstChunk) ? Math.max(0, firstToken - firstChunk) : 0,
    },
    {
      label: "生成完成",
      fill: "fill-queue",
      ms: Number.isFinite(total) && Number.isFinite(firstToken) ? Math.max(0, total - firstToken) : 0,
    },
  ];

  const sum = stages.reduce((accumulator, stage) => accumulator + stage.ms, 0);
  return stages.map((stage) => ({
    label: stage.label,
    fill: stage.fill,
    valueLabel: sum > 0 ? `${Math.round(stage.ms)} ms` : "--",
    width: sum > 0 ? `${((stage.ms / sum) * 100).toFixed(1)}%` : "0%",
  }));
}

export function buildServiceCardModel(site) {
  const currentSite = site || {};
  const tone = statusToneFromSite(currentSite);
  const status = toneToServiceStatus(tone);
  const health = currentSite.health || {};
  const successRate = Number(health.successRate);
  const sampleCount = Number(health.sampleCount) || (currentSite.recentResults?.length ?? 0);
  const failureRate = Number.isFinite(successRate) ? 1 - successRate : null;
  const average = Number(health.averageMs);
  const jitter = Number(health.jitterMs);
  const saturation = Number.isFinite(jitter) && Number.isFinite(average) && average > 0
    ? Math.min(100, (jitter / average) * 100)
    : 0;

  return {
    id: currentSite.id || "",
    name: currentSite.name || "未命名节点",
    domain: hostOf(currentSite.baseUrl),
    model: currentSite.model || "--",
    statusCls: status.cls,
    statusLabel: status.label,
    dataStatus: status.dataStatus,
    apdexLabel: Number.isFinite(successRate) ? successRate.toFixed(2) : "--",
    latencyLabel: Number.isFinite(Number(health.p95Ms)) ? `${Math.round(Number(health.p95Ms))} ms` : "--",
    errorLabel: failureRate === null ? "--" : `${(failureRate * 100).toFixed(1)}%`,
    trafficLabel: `${sampleCount || 0} 次`,
    saturationWidth: `${saturation.toFixed(0)}%`,
    hasApiKey: Boolean(currentSite.hasApiKey),
    paused: Boolean(currentSite.paused),
    selected: false,
  };
}

export function buildServiceCards(sites) {
  return (sites || []).map(buildServiceCardModel);
}

export function aggregateFleet(sites) {
  const list = sites || [];
  const metrics = buildOverviewMetrics({ sites: list, scheduler: {} });
  let samples = 0;
  let failures = 0;
  const p95s = [];
  const averages = [];

  for (const site of list) {
    const health = site.health || {};
    samples += Number(health.sampleCount) || 0;
    failures += Number(health.failureCount) || 0;
    if (Number.isFinite(Number(health.p95Ms))) {
      p95s.push(Number(health.p95Ms));
    }
    if (Number.isFinite(Number(health.averageMs))) {
      averages.push(Number(health.averageMs));
    }
  }

  const total = metrics.total;
  return {
    ...metrics,
    samples,
    failures,
    availablePct: total ? ((total - metrics.unavailable) / total) * 100 : 0,
    stablePct: total ? (metrics.stable / total) * 100 : 0,
    errorRate: samples ? failures / samples : 0,
    avgP95: p95s.length ? Math.round(p95s.reduce((a, b) => a + b, 0) / p95s.length) : null,
    avgLatency: averages.length ? Math.round(averages.reduce((a, b) => a + b, 0) / averages.length) : null,
  };
}

export function pickFocusSite(sites) {
  const list = sites || [];
  if (!list.length) {
    return null;
  }

  const rank = { unavailable: 0, fluctuating: 1, pending: 2, paused: 3, stable: 4 };
  const scored = list.map((site) => ({ site, tone: statusToneFromSite(site) }));
  scored.sort((a, b) => {
    const rankA = rank[a.tone] ?? 5;
    const rankB = rank[b.tone] ?? 5;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    const p95A = Number(a.site.health?.p95Ms) || 0;
    const p95B = Number(b.site.health?.p95Ms) || 0;
    return p95B - p95A;
  });

  return scored[0];
}

export function classifyResultSeverity(result, options = {}) {
  const slowMs = Number(options.slowMs) || 4000;
  if (!result?.ok) {
    return "critical";
  }
  const latency = Number(result.totalMs ?? result.firstTokenMs ?? result.headersMs);
  if (Number.isFinite(latency) && latency >= slowMs) {
    return "warn";
  }
  return "info";
}

export function severityLabel(severity) {
  if (severity === "critical") {
    return "CRIT";
  }
  if (severity === "warn") {
    return "WARN";
  }
  return "INFO";
}

export function firstConnectionOf(result) {
  if (!Array.isArray(result?.connections) || !result.connections.length) {
    return null;
  }
  return result.connections[0];
}
