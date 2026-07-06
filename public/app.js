import {
  aggregateFleet,
  pickFocusSite,
  buildServiceCards,
  buildChartGeometry,
  filterResultsByWindow,
  mergeRecentResults,
  buildStageBreakdown,
  classifyResultSeverity,
  severityLabel,
  firstConnectionOf,
} from "/ui-model.js";

const POLL_MS = 15000;
const HISTORY_WINDOWS = ["50", "1h", "6h", "24h", "7d"];

/* ---------------------------------------------------------------
   Element references — every id here exists in index.html
   --------------------------------------------------------------- */
const refs = {
  runtimeStatus: document.querySelector("#runtime-status"),
  brandSub: document.querySelector("#brand-sub"),
  updatedAt: document.querySelector("#updated-at"),
  refreshBtn: document.querySelector("#refresh-btn"),
  runAllBtn: document.querySelector("#run-all-btn"),

  overviewTitle: document.querySelector("#overview-title"),
  overviewSub: document.querySelector("#overview-sub"),
  focusTitle: document.querySelector("#focus-title"),
  focusDesc: document.querySelector("#focus-desc"),
  focusMeta1: document.querySelector("#focus-meta-1"),
  focusMeta2: document.querySelector("#focus-meta-2"),
  overviewKpis: document.querySelector("#overview-kpis"),
  trendTitle: document.querySelector("#trend-title"),
  trendNote: document.querySelector("#trend-note"),
  trendArea: document.querySelector("#trend-area"),
  trendLine: document.querySelector("#trend-line"),
  trendMarker: document.querySelector("#trend-marker"),
  trendMarkerRing: document.querySelector("#trend-marker-ring"),
  trendAxis: document.querySelector("#trend-axis"),

  kpiGrid: document.querySelector("#kpi-grid"),
  stateStrip: document.querySelector("#state-strip"),

  siteSearch: document.querySelector("#site-search"),
  serviceGrid: document.querySelector("#service-grid"),
  hotspotRows: document.querySelector("#hotspot-rows"),

  traceToolbar: document.querySelector("#trace-toolbar"),
  traceTitle: document.querySelector("#trace-title"),
  traceSubtitle: document.querySelector("#trace-subtitle"),
  traceArea: document.querySelector("#trace-area"),
  traceLine: document.querySelector("#trace-line"),
  traceMarker: document.querySelector("#trace-marker"),
  traceMetaGrid: document.querySelector("#trace-meta-grid"),
  traceBreakdownList: document.querySelector("#trace-breakdown-list"),
  traceNote: document.querySelector("#trace-note"),
  slowTraceRows: document.querySelector("#slow-trace-rows"),

  logRows: document.querySelector("#logRows"),

  settingsForm: document.querySelector("#settings-form"),
  autoEnabled: document.querySelector("#auto-enabled"),
  autoEnabledHint: document.querySelector("#auto-enabled-hint"),
  defaultFrequencyMinutes: document.querySelector("#default-frequency-minutes"),
  controllerUrl: document.querySelector("#controller-url"),
  defaultTimeoutMs: document.querySelector("#default-timeout-ms"),
  defaultPrompt: document.querySelector("#default-prompt"),
  controllerSecret: document.querySelector("#controller-secret"),
  clearControllerSecret: document.querySelector("#clear-controller-secret"),
  controllerSecretHint: document.querySelector("#controller-secret-hint"),
  addSiteBtn: document.querySelector("#add-site-btn"),
  settingsSiteSummary: document.querySelector("#settings-site-summary"),
  siteManageList: document.querySelector("#site-manage-list"),

  alertList: document.querySelector("#alertList"),
  alertNote: document.querySelector("#alert-note"),
  eventList: document.querySelector("#event-list"),
  footer: document.querySelector("#footer"),

  modalRoot: document.querySelector("#modal-root"),
  toastRoot: document.querySelector("#toast-root"),

  windowRadios: Array.from(document.querySelectorAll('input[name="window-range"]')),
  tabTraces: document.querySelector("#tab-traces"),
};

const ui = {
  appState: null,
  selectedSiteId: "",
  selectedWindow: "50",
  selectedHistory: null,
  historyRequestId: 0,
  loadingHistory: false,
  clearGlobalControllerSecret: false,
  settingsTouched: false,
  modal: null,
};

/* ---------------------------------------------------------------
   Small formatting helpers
   --------------------------------------------------------------- */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function msToMinutes(value) {
  const ms = safeNumber(value, 0);
  return ms > 0 ? Math.max(1, Math.round(ms / 60000)) : 5;
}

function minutesToMs(value) {
  const minutes = safeNumber(value, 0);
  return minutes > 0 ? minutes * 60000 : null;
}

function formatClock(ms) {
  const date = new Date(ms);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function formatDateTime(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) {
    return "--";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(time));
}

function formatRelativeTime(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) {
    return "--";
  }
  const diff = Date.now() - time;
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

function shortPreview(value, max = 160) {
  const text = String(value || "").trim();
  if (!text) {
    return "--";
  }
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function shortUrl(value, max = 34) {
  if (!value) {
    return "--";
  }
  const text = String(value).replace(/^https?:\/\//, "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

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

function formatMs(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ms` : "--";
}

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "--";
}

function getSelectedWindowRange() {
  const checked = refs.windowRadios.find((radio) => radio.checked);
  if (!checked) {
    return "1h";
  }
  return checked.id.replace("window-", "");
}

/* ---------------------------------------------------------------
   Network
   --------------------------------------------------------------- */
async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

/* ---------------------------------------------------------------
   Toast
   --------------------------------------------------------------- */
function showToast(message, tone = "success", durationMs = 4200) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.tone = tone;
  toast.textContent = message;
  refs.toastRoot.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    toast.style.transition = "opacity .25s, transform .25s";
    window.setTimeout(() => toast.remove(), 260);
  }, durationMs);
}

function setChipBusy(button, busy, busyLabel) {
  if (!button) {
    return;
  }
  if (!button.dataset.idleHtml) {
    button.dataset.idleHtml = button.innerHTML;
  }
  button.disabled = busy;
  button.classList.toggle("is-spinning", busy);
  button.innerHTML = busy ? busyLabel : button.dataset.idleHtml;
}

/* ---------------------------------------------------------------
   Selection helpers
   --------------------------------------------------------------- */
function sites() {
  return ui.appState?.sites || [];
}

function settings() {
  return ui.appState?.settings || {};
}

function pickSelectedSite() {
  return sites().find((site) => site.id === ui.selectedSiteId) || null;
}

function syncSelection() {
  const list = sites();
  if (!list.length) {
    ui.selectedSiteId = "";
    ui.selectedHistory = null;
    return;
  }
  if (!list.some((site) => site.id === ui.selectedSiteId)) {
    ui.selectedSiteId = list[0].id;
    ui.selectedHistory = null;
  }
}

function selectedResults() {
  const site = pickSelectedSite();
  if (!site) {
    return [];
  }
  if (ui.selectedHistory && ui.selectedHistory.siteId === site.id) {
    return ui.selectedHistory.results || [];
  }
  return site.recentResults || [];
}

/* ---------------------------------------------------------------
   Header + footer
   --------------------------------------------------------------- */
function runtimeStatusLabel() {
  const state = ui.appState;
  if (!state) {
    return "读取中";
  }
  const running = state.scheduler?.runningSiteIds?.length || 0;
  if (running > 0) {
    return `检测中 ${running}`;
  }
  if (state.settings?.autoEnabled) {
    return "自动运行";
  }
  return "手动模式";
}

function latestCheckAt() {
  return sites()
    .map((site) => site?.health?.lastCheckedAt || site?.lastResult?.finishedAt || "")
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function renderHeader() {
  refs.runtimeStatus.textContent = runtimeStatusLabel();
  const controller = settings().controllerUrl || "未配置控制器";
  refs.brandSub.textContent = `${controller} · 本地中转站延迟与链路监测`;
  const last = latestCheckAt();
  refs.updatedAt.textContent = last ? `最近检测 ${formatRelativeTime(last)}` : "最近检测 --";
}

function renderFooter() {
  const set = settings();
  const last = latestCheckAt();
  const parts = [
    `CONTROLLER ${set.controllerUrl || "--"}`,
    `NODES ${sites().length}`,
    `AUTO ${set.autoEnabled ? `ON · ${msToMinutes(set.defaultFrequencyMs)}m` : "OFF"}`,
    `LAST ${last ? formatDateTime(last) : "--"}`,
  ];
  refs.footer.innerHTML = parts.map((text) => `<span>${escapeHtml(text)}</span>`).join("");
}

/* ---------------------------------------------------------------
   Overview: title, focus, KPIs, trend
   --------------------------------------------------------------- */
function renderOverview() {
  const list = sites();
  const fleet = aggregateFleet(list);
  const windowKey = getSelectedWindowRange();

  if (!list.length) {
    refs.overviewTitle.textContent = "还没有中转站";
    refs.overviewSub.textContent = "到「配置」标签新增一个中转站，面板会开始累计它的延迟与链路历史。";
  } else {
    refs.overviewTitle.textContent = `${fleet.stable}/${fleet.total} 个节点稳定`;
    refs.overviewSub.textContent = `车队可用率 ${formatPercent(fleet.availablePct / 100)}，`
      + `波动 ${fleet.fluctuating} 个，不可用 ${fleet.unavailable} 个，暂停 ${fleet.paused} 个。`
      + `${fleet.testing ? ` 当前 ${fleet.testing} 个正在探测。` : ""}`;
  }

  // Focus card — the node that most needs attention
  const focus = pickFocusSite(list);
  if (focus) {
    const site = focus.site;
    const health = site.health || {};
    refs.focusTitle.textContent = site.name || "未命名节点";
    const toneText = {
      unavailable: "连续失败 / 严重错误，建议优先排查",
      fluctuating: "成功率或抖动异常，需要关注",
      paused: "已暂停自动检测",
      pending: "尚无足够采样",
      stable: "运行稳定",
    }[focus.tone] || "运行稳定";
    refs.focusDesc.textContent = toneText;
    refs.focusMeta1.textContent = hostOf(site.baseUrl);
    refs.focusMeta2.textContent = focus.tone === "unavailable"
      ? "立即检测 + 查看失败日志"
      : focus.tone === "fluctuating"
        ? "观察链路与 P95"
        : focus.tone === "paused"
          ? "手动检测以恢复"
          : "保持监控";
  } else {
    refs.focusTitle.textContent = "--";
    refs.focusDesc.textContent = "暂无节点";
    refs.focusMeta1.textContent = "--";
    refs.focusMeta2.textContent = "--";
  }

  renderOverviewKpis(fleet);
  renderTrend(windowKey);
  renderKpiGrid(fleet);
  renderStateStrip(fleet, list);
}

function renderOverviewKpis(fleet) {
  const tiles = [
    { cls: "good", label: "可用率", value: fleet.total ? formatPercent(fleet.availablePct / 100) : "--", meta: `${fleet.total} 个节点` },
    { cls: "", label: "节点总数", value: String(fleet.total), meta: `稳定 ${fleet.stable} · 暂停 ${fleet.paused}` },
    { cls: "warn", label: "平均 P95", value: fleet.avgP95 != null ? `${fleet.avgP95} ms` : "--", meta: "各节点 P95 均值" },
    { cls: "bad", label: "失败次数", value: String(fleet.failures), meta: `样本 ${fleet.samples} 次` },
  ];
  refs.overviewKpis.innerHTML = tiles.map((tile) => `
    <div class="overview-mini">
      <div class="label">${escapeHtml(tile.label)}</div>
      <div class="value ${tile.cls}">${escapeHtml(tile.value)}</div>
      <div class="meta">${escapeHtml(tile.meta)}</div>
    </div>
  `).join("");
}

function renderKpiGrid(fleet) {
  const cards = [
    { cls: "accent", label: "检测样本", value: String(fleet.samples), meta: "当前窗口内累计探测次数" },
    { cls: "danger", label: "失败率", value: formatPercent(fleet.errorRate), meta: `失败 ${fleet.failures} 次` },
    { cls: "warn", label: "平均延迟", value: fleet.avgLatency != null ? `${fleet.avgLatency} ms` : "--", meta: "各节点平均响应耗时" },
    { cls: "success", label: "稳定占比", value: fleet.total ? formatPercent(fleet.stablePct / 100) : "--", meta: `${fleet.stable}/${fleet.total} 稳定` },
  ];
  refs.kpiGrid.innerHTML = cards.map((card) => `
    <article class="card kpi-card">
      <div class="label">${escapeHtml(card.label)}</div>
      <div class="value ${card.cls}">${escapeHtml(card.value)}</div>
      <div class="meta">${escapeHtml(card.meta)}</div>
    </article>
  `).join("");
}

function renderStateStrip(fleet, list) {
  const needConfig = list.filter((site) => !site.hasApiKey || !(site.health?.sampleCount > 0)).length;
  const cards = [
    {
      cls: "loading",
      icon: "…",
      label: "检测中",
      title: fleet.testing ? `${fleet.testing} 个节点探测中` : "空闲",
      desc: fleet.testing ? "调度器或手动检测正在执行探测。" : "当前没有正在进行的探测任务。",
    },
    {
      cls: "empty",
      icon: String(needConfig),
      label: "待完善",
      title: needConfig ? `${needConfig} 个节点缺数据` : "全部就绪",
      desc: needConfig ? "存在未保存 API Key 或尚无采样的节点。" : "所有节点均已保存密钥并有采样。",
    },
    {
      cls: "error",
      icon: "!",
      label: "异常",
      title: fleet.unavailable ? `${fleet.unavailable} 个不可用` : "无异常",
      desc: fleet.unavailable ? "存在连续失败或严重错误的节点，请优先处理。" : "没有处于不可用状态的节点。",
    },
  ];
  refs.stateStrip.innerHTML = cards.map((card) => `
    <article class="card state-card ${card.cls}">
      <div class="state-head"><div class="state-label">${escapeHtml(card.label)}</div><div class="state-icon">${escapeHtml(card.icon)}</div></div>
      <div class="state-title">${escapeHtml(card.title)}</div>
      <div class="state-desc">${escapeHtml(card.desc)}</div>
    </article>
  `).join("");
}

function renderTrend(windowKey) {
  const merged = mergeRecentResults(sites());
  const windowResults = filterResultsByWindow(merged, windowKey);
  const values = windowResults
    .filter((result) => result.ok)
    .map((result) => Number(result.totalMs ?? result.firstTokenMs ?? result.headersMs))
    .filter((value) => Number.isFinite(value));

  const geometry = buildChartGeometry(values, { width: 840, height: 178 });
  refs.trendLine.setAttribute("points", geometry.linePoints);
  refs.trendArea.setAttribute("points", geometry.hasData ? geometry.areaPoints : "");
  refs.trendMarker.setAttribute("cx", geometry.markerX);
  refs.trendMarker.setAttribute("cy", geometry.markerY);
  refs.trendMarkerRing.setAttribute("cx", geometry.markerX);
  refs.trendMarkerRing.setAttribute("cy", geometry.markerY);
  refs.trendMarker.style.opacity = geometry.hasData ? "1" : "0";
  refs.trendMarkerRing.style.opacity = geometry.hasData ? "1" : "0";

  const windowLabel = { "15m": "近 15 分钟", "1h": "近 1 小时", "6h": "近 6 小时" }[windowKey] || windowKey;
  refs.trendTitle.textContent = "车队延迟趋势";
  refs.trendNote.textContent = geometry.hasData
    ? `${windowLabel} · ${values.length} 次成功 · ${geometry.min}–${geometry.max} ms`
    : `${windowLabel} · 暂无成功采样`;

  const now = Date.now();
  const spans = { "15m": 15 * 60000, "1h": 3600000, "6h": 6 * 3600000 };
  const span = spans[windowKey] || 3600000;
  const labels = [];
  for (let i = 0; i < 6; i += 1) {
    labels.push(formatClock(now - span + (span * i) / 5));
  }
  refs.trendAxis.innerHTML = labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("");
}

/* ---------------------------------------------------------------
   Services panel
   --------------------------------------------------------------- */
function renderServiceCards() {
  const list = sites();
  const cards = buildServiceCards(list);
  const runningIds = new Set(ui.appState?.scheduler?.runningSiteIds || []);

  if (!cards.length) {
    refs.serviceGrid.innerHTML = `<div class="empty-note">还没有中转站。到「配置」标签新增一个，面板会开始累计健康与链路历史。</div>`;
    refs.hotspotRows.innerHTML = `<tr><td colspan="4"><div class="empty-note">暂无节点。</div></td></tr>`;
    return;
  }

  refs.serviceGrid.innerHTML = cards.map((card) => {
    const chipCls = card.statusCls === "muted" ? "warn" : card.statusCls;
    const running = runningIds.has(card.id);
    const selected = card.id === ui.selectedSiteId;
    return `
      <article class="service-card ${selected ? "is-selected" : ""}" data-status="${escapeHtml(card.dataStatus)}" data-site-id="${escapeHtml(card.id)}">
        <div class="service-top">
          <div>
            <div class="service-name">${escapeHtml(card.name)}</div>
            <div class="service-domain">${escapeHtml(card.domain)} · ${escapeHtml(card.model)}</div>
          </div>
          <div class="status-chip ${chipCls}">${escapeHtml(card.statusLabel)}</div>
        </div>
        <div class="metric-grid">
          <div><div class="metric-label">成功率</div><div class="metric-value">${escapeHtml(card.apdexLabel)}</div></div>
          <div><div class="metric-label">P95</div><div class="metric-value">${escapeHtml(card.latencyLabel)}</div></div>
          <div><div class="metric-label">错误率</div><div class="metric-value">${escapeHtml(card.errorLabel)}</div></div>
          <div><div class="metric-label">样本</div><div class="metric-value">${escapeHtml(card.trafficLabel)}</div></div>
        </div>
        <div class="bar-meter"><div class="metric-label">抖动饱和度</div><div class="meter-line"><div class="meter-fill" style="width: ${escapeHtml(card.saturationWidth)};"></div></div></div>
        <div class="service-actions">
          ${running ? '<span class="service-running">检测中…</span>' : ""}
          <button type="button" class="mini-action" data-action="check" data-site-id="${escapeHtml(card.id)}"><span class="glyph">⚡</span>单次测速</button>
          <button type="button" class="mini-action" data-action="probe" data-site-id="${escapeHtml(card.id)}"><span class="glyph">▶</span>立即检测</button>
          <button type="button" class="mini-action" data-action="trace" data-site-id="${escapeHtml(card.id)}"><span class="glyph">◧</span>链路</button>
          <button type="button" class="mini-action" data-action="edit" data-site-id="${escapeHtml(card.id)}"><span class="glyph">✎</span>编辑</button>
          <button type="button" class="mini-action" data-action="pause" data-site-id="${escapeHtml(card.id)}" ${card.paused ? "disabled" : ""}><span class="glyph">■</span>${card.paused ? "已停" : "停止"}</button>
          <button type="button" class="mini-action danger" data-action="delete" data-site-id="${escapeHtml(card.id)}"><span class="glyph">✕</span>删除</button>
        </div>
      </article>
    `;
  }).join("");

  // Hotspot table: slowest nodes by P95
  const ranked = [...list].sort((a, b) => (Number(b.health?.p95Ms) || 0) - (Number(a.health?.p95Ms) || 0)).slice(0, 8);
  refs.hotspotRows.innerHTML = ranked.map((site) => {
    const health = site.health || {};
    const lastCheck = health.lastCheckedAt || site.lastResult?.finishedAt || "";
    return `
      <tr data-site-id="${escapeHtml(site.id)}">
        <td data-label="节点">${escapeHtml(site.name || "--")}</td>
        <td data-label="成功率">${escapeHtml(formatPercent(health.successRate ?? 0))}</td>
        <td data-label="P95">${escapeHtml(formatMs(health.p95Ms))}</td>
        <td data-label="最近检测">${escapeHtml(lastCheck ? formatRelativeTime(lastCheck) : "--")}</td>
      </tr>
    `;
  }).join("");
}

/* ---------------------------------------------------------------
   Traces panel (per selected site)
   --------------------------------------------------------------- */
function renderTraces() {
  const site = pickSelectedSite();

  if (!site) {
    refs.traceToolbar.innerHTML = `<div class="card-sub">选择上方任意节点查看链路。</div>`;
    refs.traceTitle.textContent = "--";
    refs.traceSubtitle.textContent = "还没有选中节点。";
    refs.traceLine.setAttribute("points", "");
    refs.traceArea.setAttribute("points", "");
    refs.traceMarker.style.opacity = "0";
    refs.traceMetaGrid.innerHTML = "";
    refs.traceBreakdownList.innerHTML = "";
    refs.traceNote.textContent = "--";
    refs.slowTraceRows.innerHTML = `<tr><td colspan="5"><div class="empty-note">暂无数据。</div></td></tr>`;
    return;
  }

  const results = selectedResults();
  const lastResult = [...results].reverse().find(Boolean) || null;
  const lastSuccess = [...results].reverse().find((result) => result?.ok) || null;
  const route = firstConnectionOf(lastSuccess || lastResult);

  // Toolbar: node name + window switches
  refs.traceToolbar.innerHTML = `
    <div class="card-sub">链路目标：<strong style="color:var(--fg)">${escapeHtml(site.name || "--")}</strong></div>
    <div class="window-switches">
      ${HISTORY_WINDOWS.map((key) => `
        <button type="button" class="window-switch ${key === ui.selectedWindow ? "is-active" : ""}" data-window="${escapeHtml(key)}">${escapeHtml(key)}</button>
      `).join("")}
    </div>
  `;

  const total = lastResult?.totalMs;
  refs.traceTitle.textContent = `${site.name || "--"}${Number.isFinite(Number(total)) ? ` · ${Math.round(Number(total))} ms` : ""}`;
  refs.traceSubtitle.textContent = ui.loadingHistory
    ? "正在切换窗口…"
    : `窗口 ${ui.selectedWindow} · 样本 ${results.length}${lastResult?.finishedAt ? ` · 最近 ${formatRelativeTime(lastResult.finishedAt)}` : ""}`;

  // Chart from successful latencies
  const values = results
    .filter((result) => result.ok)
    .map((result) => Number(result.totalMs ?? result.firstTokenMs ?? result.headersMs))
    .filter((value) => Number.isFinite(value));
  const geometry = buildChartGeometry(values, { width: 680, height: 184 });
  refs.traceLine.setAttribute("points", geometry.linePoints);
  refs.traceArea.setAttribute("points", geometry.hasData ? geometry.areaPoints : "");
  refs.traceMarker.setAttribute("cx", geometry.markerX);
  refs.traceMarker.setAttribute("cy", geometry.markerY);
  refs.traceMarker.style.opacity = geometry.hasData ? "1" : "0";

  // Meta grid: route inspection
  const meta = [
    { label: "端点", value: shortUrl(lastResult?.endpoint || site.baseUrl, 40), mono: true },
    { label: "链路", value: route?.chain || "--", mono: false },
    { label: "命中规则", value: route?.rule ? `${route.rule}${route.rulePayload ? `,${route.rulePayload}` : ""}` : "--", mono: true },
    { label: "远端 IP", value: route?.remoteDestination || "--", mono: true },
  ];
  refs.traceMetaGrid.innerHTML = meta.map((item) => `
    <div><div class="metric-label">${escapeHtml(item.label)}</div><div class="metric-value ${item.mono ? "mono" : ""}" style="font-size:14px;">${escapeHtml(item.value)}</div></div>
  `).join("");

  // Breakdown: stage timings from last result
  const breakdown = buildStageBreakdown(lastResult || {});
  refs.traceBreakdownList.innerHTML = breakdown.map((stage) => `
    <div class="break-row">
      <div class="break-top"><span class="break-label">${escapeHtml(stage.label)}</span><strong>${escapeHtml(stage.valueLabel)}</strong></div>
      <div class="break-track"><div class="break-fill ${stage.fill}" style="width: ${escapeHtml(stage.width)};"></div></div>
    </div>
  `).join("");
  refs.traceNote.textContent = `DNS ${route?.dnsMode || "--"} · 首 Token ${formatMs(lastResult?.firstTokenMs)} · 总时长 ${formatMs(lastResult?.totalMs)}`;

  // Slow trace table: recent results for this site, newest first
  const recent = [...results].reverse().slice(0, 8);
  if (!recent.length) {
    refs.slowTraceRows.innerHTML = `<tr><td colspan="5"><div class="empty-note">当前窗口还没有采样。切到「50」或先运行一次检测。</div></td></tr>`;
  } else {
    refs.slowTraceRows.innerHTML = recent.map((result) => {
      const conn = firstConnectionOf(result);
      const status = result.ok ? `${result.status || 200}` : (result.status ? `HTTP ${result.status}` : "失败");
      return `
        <tr>
          <td data-label="端点">${escapeHtml(shortUrl(result.endpoint || site.baseUrl, 28))}</td>
          <td data-label="节点">${escapeHtml(conn?.chain || site.name || "--")}</td>
          <td class="mono" data-label="时长">${escapeHtml(formatMs(result.totalMs ?? result.firstTokenMs ?? result.headersMs))}</td>
          <td data-label="结果">${escapeHtml(status)}</td>
          <td class="mono" data-label="发生时间">${escapeHtml(result.finishedAt ? formatDateTime(result.finishedAt) : "--")}</td>
        </tr>
      `;
    }).join("");
  }
}

/* ---------------------------------------------------------------
   Logs panel
   --------------------------------------------------------------- */
function renderLogs() {
  const merged = mergeRecentResults(sites());
  const rows = [...merged].reverse().slice(0, 40);

  if (!rows.length) {
    refs.logRows.innerHTML = `<tr><td colspan="6"><div class="empty-note">还没有探测记录。</div></td></tr>`;
    return;
  }

  refs.logRows.innerHTML = rows.map((result) => {
    const severity = classifyResultSeverity(result);
    const conn = firstConnectionOf(result);
    const message = result.ok
      ? shortPreview(result.preview || "ok", 80)
      : shortPreview(result.error || (result.status ? `HTTP ${result.status}` : "探测失败"), 80);
    return `
      <tr data-severity="${escapeHtml(severity)}">
        <td class="mono" data-label="时间">${escapeHtml(result.finishedAt ? formatDateTime(result.finishedAt) : "--")}</td>
        <td data-label="级别"><span class="level-pill ${severity}">${escapeHtml(severityLabel(severity))}</span></td>
        <td data-label="节点">${escapeHtml(result.siteName || "--")}</td>
        <td class="mono" data-label="端点">${escapeHtml(shortUrl(result.endpoint || result.baseUrl, 24))}</td>
        <td class="mono" data-label="远端 IP">${escapeHtml(conn?.remoteDestination || "--")}</td>
        <td data-label="消息">${escapeHtml(message)}</td>
      </tr>
    `;
  }).join("");
}

/* ---------------------------------------------------------------
   Rail: alerts + events
   --------------------------------------------------------------- */
function renderAlerts() {
  const list = sites();
  const alerts = [];
  for (const site of list) {
    const status = site.health?.status;
    if (site.enabled === false || site.paused === true) {
      continue;
    }
    if (status === "down") {
      alerts.push({ site, severity: "critical" });
    } else if (status === "unstable") {
      alerts.push({ site, severity: "warn" });
    }
  }

  if (!alerts.length) {
    refs.alertList.innerHTML = `<div class="empty-note">当前没有告警，所有活跃节点均稳定。</div>`;
    refs.alertNote.textContent = `${list.length} 个节点 · 无异常`;
    return;
  }

  alerts.sort((a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1));
  refs.alertList.innerHTML = alerts.map(({ site, severity }) => {
    const health = site.health || {};
    const desc = health.lastError
      ? shortPreview(health.lastError, 120)
      : `成功率 ${formatPercent(health.successRate ?? 0)} · P95 ${formatMs(health.p95Ms)} · 抖动 ${formatMs(health.jitterMs)}`;
    return `
      <article class="alert-item" data-severity="${severity}" data-site-id="${escapeHtml(site.id)}">
        <div class="alert-top"><div class="alert-title">${escapeHtml(site.name || "--")}</div><span class="level-pill ${severity}">${escapeHtml(severityLabel(severity))}</span></div>
        <div class="alert-meta">${escapeHtml(hostOf(site.baseUrl))} · ${escapeHtml(site.model || "--")} · ${escapeHtml(health.lastCheckedAt ? formatRelativeTime(health.lastCheckedAt) : "--")}</div>
        <div class="alert-desc">${escapeHtml(desc)}</div>
      </article>
    `;
  }).join("");
  refs.alertNote.textContent = `${alerts.length} 个节点需要关注`;
}

function renderEvents() {
  const merged = mergeRecentResults(sites());
  const rows = [...merged].reverse().slice(0, 6);

  if (!rows.length) {
    refs.eventList.innerHTML = `<div class="empty-note">还没有探测事件。</div>`;
    return;
  }

  refs.eventList.innerHTML = rows.map((result) => {
    const okText = result.ok ? "检测成功" : "检测失败";
    const detail = result.ok
      ? `${formatMs(result.totalMs)} · ${shortUrl(result.endpoint || result.baseUrl, 30)}`
      : shortPreview(result.error || (result.status ? `HTTP ${result.status}` : "探测失败"), 90);
    return `
      <article class="event-item">
        <div class="event-top"><div class="event-title">${escapeHtml(result.siteName || "--")} · ${escapeHtml(okText)}</div><div class="event-meta mono">${escapeHtml(result.finishedAt ? formatRelativeTime(result.finishedAt) : "--")}</div></div>
        <div class="event-desc">${escapeHtml(detail)}</div>
      </article>
    `;
  }).join("");
}

/* ---------------------------------------------------------------
   Settings panel
   --------------------------------------------------------------- */
function setInputIfIdle(input, value) {
  if (!input || document.activeElement === input) {
    return;
  }
  input.value = value;
}

function renderSettings() {
  const set = settings();

  if (!ui.settingsTouched) {
    refs.autoEnabled.setAttribute("aria-checked", set.autoEnabled ? "true" : "false");
    refs.autoEnabledHint.textContent = set.autoEnabled ? "调度器会按频率自动触发。" : "当前只接受手动检测。";
    setInputIfIdle(refs.defaultFrequencyMinutes, String(msToMinutes(set.defaultFrequencyMs)));
    setInputIfIdle(refs.controllerUrl, set.controllerUrl || "");
    setInputIfIdle(refs.defaultTimeoutMs, String(set.defaultTimeoutMs || 45000));
    setInputIfIdle(refs.defaultPrompt, set.defaultPrompt || "Say ok");
  }

  const hasSecret = Boolean(set.hasControllerSecret);
  if (ui.clearGlobalControllerSecret) {
    refs.controllerSecretHint.textContent = "已标记清除 Controller Secret，保存后生效。";
  } else if (hasSecret) {
    refs.controllerSecretHint.textContent = "Controller Secret 已保存；留空则保持不变。";
  } else {
    refs.controllerSecretHint.textContent = "当前未检测到已保存 Secret。";
  }

  const list = sites();
  refs.settingsSiteSummary.textContent = list.length ? `共 ${list.length} 个中转站` : "还没有中转站";
  if (!list.length) {
    refs.siteManageList.innerHTML = `<div class="empty-note">点击右上角「新增中转站」创建第一个节点。</div>`;
    return;
  }

  refs.siteManageList.innerHTML = list.map((site) => {
    const health = site.health || {};
    const freq = site.useGlobalFrequency === false && site.frequencyMs
      ? `单站 ${msToMinutes(site.frequencyMs)} 分`
      : `全局 ${msToMinutes(set.defaultFrequencyMs)} 分`;
    const stateText = site.enabled === false ? "已禁用" : (site.paused ? "已暂停" : "启用");
    return `
      <div class="site-manage-row" data-site-id="${escapeHtml(site.id)}">
        <div>
          <div class="name">${escapeHtml(site.name || "--")}</div>
          <div class="sub">${escapeHtml(shortUrl(site.baseUrl))} · ${escapeHtml(site.model || "--")} · ${escapeHtml(freq)} · ${escapeHtml(stateText)} · ${escapeHtml(site.hasApiKey ? "Key 已存" : "无 Key")}</div>
        </div>
        <div class="row-actions">
          <button type="button" class="mini-action" data-action="check" data-site-id="${escapeHtml(site.id)}"><span class="glyph">⚡</span>测速</button>
          <button type="button" class="mini-action" data-action="probe" data-site-id="${escapeHtml(site.id)}"><span class="glyph">▶</span>检测</button>
          <button type="button" class="mini-action" data-action="edit" data-site-id="${escapeHtml(site.id)}"><span class="glyph">✎</span>编辑</button>
          <button type="button" class="mini-action danger" data-action="delete" data-site-id="${escapeHtml(site.id)}"><span class="glyph">✕</span>删除</button>
        </div>
      </div>
    `;
  }).join("");
}

/* ---------------------------------------------------------------
   Master render
   --------------------------------------------------------------- */
function renderAll() {
  // Root cause: if the focused element lives inside a container we're about
  // to rebuild with innerHTML, that element gets destroyed while focused.
  // The browser's focus-recovery algorithm then picks the first focusable
  // node in the document — the hidden radio inputs at the top — and scrolls
  // it into view, yanking the page back to the top.
  //
  // Fix: proactively blur before rebuilding. When focus moves to body, body
  // is always present and never triggers a scroll, so there is nothing to
  // recover and the page position stays intact.
  const active = document.activeElement;
  if (active && active !== document.body) {
    const rebuiltZones = [
      refs.serviceGrid, refs.hotspotRows, refs.overviewKpis,
      refs.kpiGrid, refs.stateStrip, refs.logRows,
      refs.alertList, refs.eventList, refs.siteManageList,
      refs.traceToolbar, refs.traceMetaGrid, refs.traceBreakdownList,
      refs.slowTraceRows, refs.footer,
    ];
    if (rebuiltZones.some((zone) => zone && zone.contains(active))) {
      active.blur();
    }
  }

  renderHeader();
  renderOverview();
  renderServiceCards();
  renderTraces();
  renderLogs();
  renderAlerts();
  renderEvents();
  renderSettings();
  renderFooter();
}

/* ---------------------------------------------------------------
   State refresh + history
   --------------------------------------------------------------- */
async function refreshAppState({ loadHistory = true, silent = false } = {}) {
  try {
    const nextState = await fetchJson("/api/state", { headers: { "cache-control": "no-store" } });
    ui.appState = nextState;
    syncSelection();
    renderAll();
    if (loadHistory && ui.selectedSiteId) {
      await loadSelectedHistory(ui.selectedSiteId, ui.selectedWindow, { silent: true });
    }
  } catch (error) {
    if (!silent) {
      showToast(`读取状态失败：${error.message}`, "error");
    }
  }
}

async function loadSelectedHistory(siteId, windowKey, { silent = false } = {}) {
  if (!siteId) {
    ui.selectedHistory = null;
    renderTraces();
    return;
  }
  ui.selectedWindow = windowKey;
  const requestId = ++ui.historyRequestId;
  ui.loadingHistory = true;
  if (!silent) {
    renderTraces();
  }
  try {
    const history = await fetchJson(`/api/sites/${encodeURIComponent(siteId)}/history?window=${encodeURIComponent(windowKey)}`);
    if (requestId !== ui.historyRequestId) {
      return;
    }
    ui.selectedHistory = history;
  } catch (error) {
    if (requestId === ui.historyRequestId) {
      showToast(`读取历史失败：${error.message}`, "error");
    }
  } finally {
    if (requestId === ui.historyRequestId) {
      ui.loadingHistory = false;
      renderTraces();
    }
  }
}

function selectSite(siteId, { switchTab = false } = {}) {
  if (!siteId) {
    return;
  }
  const changed = siteId !== ui.selectedSiteId;
  ui.selectedSiteId = siteId;
  if (changed) {
    ui.selectedHistory = null;
  }
  if (switchTab && refs.tabTraces) {
    refs.tabTraces.checked = true;
  }
  renderServiceCards();
  renderTraces();
  if (changed) {
    loadSelectedHistory(siteId, ui.selectedWindow);
  }
}

/* ---------------------------------------------------------------
   Actions: run all / probe / pause / delete / save settings
   --------------------------------------------------------------- */
async function runAllNow() {
  setChipBusy(refs.runAllBtn, true, '<span class="chip-glyph">…</span>检测中');
  try {
    const payload = await fetchJson("/api/probe-all", { method: "POST", body: "{}" });
    ui.appState = payload.state;
    syncSelection();
    renderAll();
    await loadSelectedHistory(ui.selectedSiteId, ui.selectedWindow, { silent: true });

    const results = Array.isArray(payload.results) ? payload.results : [];
    const skipped = results.filter((item) => item?.skipped);
    const ran = results.filter((item) => !item?.skipped);
    const failures = ran.filter((item) => !item?.ok);
    if (!results.length) {
      showToast("没有可检测的节点。", "warning");
    } else if (failures.length === 0 && skipped.length === 0) {
      showToast(`已完成 ${ran.length} 个节点的检测。`, "success");
    } else if (failures.length === 0) {
      showToast(`已完成 ${ran.length} 个，跳过 ${skipped.length} 个。`, "warning");
    } else {
      showToast(`完成 ${ran.length} 个，失败 ${failures.length} 个，跳过 ${skipped.length} 个。`, "error");
    }
  } catch (error) {
    showToast(`全局检测失败：${error.message}`, "error");
  } finally {
    setChipBusy(refs.runAllBtn, false);
  }
}

async function probeSite(siteId) {
  try {
    const payload = await fetchJson(`/api/sites/${encodeURIComponent(siteId)}/probe`, { method: "POST", body: "{}" });
    ui.appState = payload.state;
    syncSelection();
    renderAll();
    if (ui.selectedSiteId === siteId) {
      await loadSelectedHistory(siteId, ui.selectedWindow, { silent: true });
    }
    flashProbeResult(payload.result, sites().find((item) => item.id === siteId)?.name || "节点");
  } catch (error) {
    showToast(`节点检测失败：${error.message}`, "error");
  }
}

function flashProbeResult(record, fallbackName) {
  if (!record) {
    showToast("未收到检测结果。", "error");
    return;
  }
  if (record.skipped) {
    const reason = {
      already_running: "该节点正在检测中，未重复触发。",
      missing_api_key: "节点未保存 API Key，已跳过。",
      site_not_found: "节点不存在，可能已被删除。",
    }[record.reason] || "节点未触发检测。";
    showToast(reason, "warning");
    return;
  }
  if (record.ok) {
    const total = Number.isFinite(record.totalMs) ? `${Math.round(record.totalMs)} ms` : "--";
    showToast(`${record.siteName || fallbackName} 检测成功（${total}）。`, "success");
    return;
  }
  const detail = record.error || (record.status ? `HTTP ${record.status}` : "失败");
  showToast(`${record.siteName || fallbackName} 检测失败：${detail}`, "error");
}

// One-off latency check: measures live, shows the result, and changes nothing.
// Does not write history, does not touch pause, does not reschedule, and
// deliberately never mutates ui.appState or re-renders — so the dashboard
// (stats, charts, timeline) stays exactly as it was.
async function checkSite(siteId, button) {
  const name = sites().find((item) => item.id === siteId)?.name || "节点";
  if (button) {
    setChipBusy(button, true, '<span class="glyph">…</span>测速中');
  }
  try {
    const payload = await fetchJson(`/api/sites/${encodeURIComponent(siteId)}/check`, { method: "POST", body: "{}" });
    const record = payload.result;
    if (!record) {
      showToast("未收到测速结果。", "error");
      return;
    }
    if (record.skipped) {
      const reason = {
        missing_api_key: "节点未保存 API Key，无法测速。",
        site_not_found: "节点不存在，可能已被删除。",
      }[record.reason] || "未能测速。";
      showToast(reason, "warning");
      return;
    }
    if (record.ok) {
      const total = Number.isFinite(record.totalMs) ? `${Math.round(record.totalMs)} ms` : "--";
      const firstToken = Number.isFinite(record.firstTokenMs) ? `${Math.round(record.firstTokenMs)} ms` : "--";
      showToast(`${name} 单次测速：${total}（首 Token ${firstToken}）· 未计入统计`, "success", 6000);
      return;
    }
    const detail = record.error || (record.status ? `HTTP ${record.status}` : "失败");
    showToast(`${name} 单次测速失败：${detail} · 未计入统计`, "error", 6000);
  } catch (error) {
    showToast(`单次测速失败：${error.message}`, "error");
  } finally {
    if (button) {
      setChipBusy(button, false);
    }
  }
}

async function pauseSite(siteId) {
  const site = sites().find((item) => item.id === siteId);
  if (!site || site.paused) {
    return;
  }
  try {
    const payload = await fetchJson(`/api/sites/${encodeURIComponent(siteId)}/pause`, {
      method: "POST",
      body: JSON.stringify({ paused: true }),
    });
    ui.appState = payload.state;
    syncSelection();
    renderAll();
    showToast(`已停止“${site.name}”的自动检测，下次手动检测后恢复。`, "warning");
  } catch (error) {
    showToast(`停止失败：${error.message}`, "error");
  }
}

async function deleteSite(siteId) {
  const site = sites().find((item) => item.id === siteId);
  if (!window.confirm(`确定删除中转站“${site?.name || siteId}”吗？`)) {
    return;
  }
  try {
    await fetchJson(`/api/sites/${encodeURIComponent(siteId)}`, { method: "DELETE", body: "{}" });
    if (ui.selectedSiteId === siteId) {
      ui.selectedSiteId = "";
      ui.selectedHistory = null;
    }
    await refreshAppState({ loadHistory: true, silent: true });
    showToast("节点已删除。", "success");
  } catch (error) {
    showToast(`删除失败：${error.message}`, "error");
  }
}

async function saveGlobalSettings(event) {
  event.preventDefault();
  const payload = {
    autoEnabled: refs.autoEnabled.getAttribute("aria-checked") === "true",
    defaultFrequencyMs: minutesToMs(refs.defaultFrequencyMinutes.value) || settings().defaultFrequencyMs || 300000,
    controllerUrl: refs.controllerUrl.value.trim(),
    controllerSecret: refs.controllerSecret.value.trim(),
    clearControllerSecret: Boolean(ui.clearGlobalControllerSecret && !refs.controllerSecret.value.trim()),
    defaultPrompt: refs.defaultPrompt.value.trim() || "Say ok",
    defaultTimeoutMs: safeNumber(refs.defaultTimeoutMs.value, 45000),
  };
  const submitButton = refs.settingsForm.querySelector('[type="submit"]');
  setChipBusy(submitButton, true, '<span class="glyph">…</span>保存中');
  try {
    const state = await fetchJson("/api/settings", { method: "POST", body: JSON.stringify(payload) });
    ui.appState = state;
    ui.clearGlobalControllerSecret = false;
    ui.settingsTouched = false;
    refs.controllerSecret.value = "";
    renderAll();
    showToast("全局设置已保存。", "success");
  } catch (error) {
    showToast(`保存全局设置失败：${error.message}`, "error");
  } finally {
    setChipBusy(submitButton, false);
  }
}

/* ---------------------------------------------------------------
   Site modal (create / edit / test connection)
   --------------------------------------------------------------- */
function openSiteModal(site = null) {
  ui.modal = {
    mode: site ? "edit" : "create",
    site: site ? JSON.parse(JSON.stringify(site)) : null,
    clearApiKey: false,
    clearControllerSecret: false,
  };

  const current = site || {};
  const timeoutMs = current.timeoutMs || settings().defaultTimeoutMs || 45000;
  const frequencyMinutes = current.frequencyMs ? msToMinutes(current.frequencyMs) : msToMinutes(settings().defaultFrequencyMs || 300000);

  refs.modalRoot.innerHTML = `
    <div class="modal-backdrop" data-modal-close="backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="site-modal-title">
        <div class="modal-header">
          <div>
            <h2 id="site-modal-title">${site ? "编辑中转站" : "新增中转站"}</h2>
            <p>${site ? "修改节点参数、凭证与覆盖频率。" : "保存一个新的中转站，并开始累计它的健康历史。"}</p>
          </div>
          <button type="button" class="modal-close" data-modal-close="button" title="关闭">✕</button>
        </div>

        <form id="site-form" class="modal-body">
          <div class="modal-grid">
            <label class="field"><span>节点名称</span><input name="name" type="text" value="${escapeHtml(current.name || "")}" placeholder="例如 HK-Primary" required /></label>
            <label class="field"><span>模型</span><input name="model" type="text" value="${escapeHtml(current.model || "")}" placeholder="gpt-4.1-mini" required /></label>
            <label class="field full"><span>Base URL</span><input name="baseUrl" type="text" value="${escapeHtml(current.baseUrl || "")}" placeholder="https://example.com/v1" required /></label>

            <div class="field full">
              <div class="secret-row"><span>API Key</span><button type="button" class="link-button" id="modal-clear-api-key">清除已保存 API Key</button></div>
              <input name="apiKey" type="password" placeholder="${current.hasApiKey ? "留空则保持已保存 API Key" : "sk-..."}" />
              <small id="modal-api-key-hint">${current.hasApiKey ? "当前已保存 API Key；保存时可继续沿用。" : "当前未保存 API Key。"}</small>
            </div>

            <label class="field"><span>Timeout（ms）</span><input name="timeoutMs" type="number" min="1000" step="1000" value="${escapeHtml(timeoutMs)}" /></label>
            <label class="field"><span>单站频率（分钟）</span><input id="modal-frequency-minutes" name="frequencyMinutes" type="number" min="1" step="1" value="${escapeHtml(frequencyMinutes)}" /></label>

            <label class="checkbox-line"><input name="enabled" type="checkbox" ${current.enabled === false ? "" : "checked"} /><span>启用自动健康检测</span></label>
            <label class="checkbox-line"><input id="modal-use-global-frequency" name="useGlobalFrequency" type="checkbox" ${current.useGlobalFrequency === false ? "" : "checked"} /><span>使用全局默认频率</span></label>

            <label class="field full"><span>Prompt</span><input name="prompt" type="text" value="${escapeHtml(current.prompt || "")}" placeholder="留空则继承全局默认 Say ok" /></label>
            <label class="field"><span>Controller URL 覆盖</span><input name="controllerUrl" type="text" value="${escapeHtml(current.controllerUrl || "")}" placeholder="留空则用全局" /></label>

            <div class="field">
              <div class="secret-row"><span>Controller Secret 覆盖</span><button type="button" class="link-button" id="modal-clear-controller-secret">清除</button></div>
              <input name="controllerSecret" type="password" placeholder="${current.hasControllerSecret ? "留空则保持已保存 Secret" : "留空则不覆盖"}" />
              <small id="modal-controller-secret-hint">${current.hasControllerSecret ? "当前节点已保存覆盖 Secret。" : "当前节点未保存覆盖 Secret。"}</small>
            </div>

            <label class="field full"><span>备注</span><textarea name="notes" rows="3" placeholder="记录用途、限制或注意事项">${escapeHtml(current.notes || "")}</textarea></label>
          </div>
        </form>

        <div class="modal-footer">
          <div id="modal-status" class="modal-status"></div>
          <div class="modal-buttons">
            <button type="button" class="btn btn-ghost" id="modal-cancel">取消</button>
            <button type="button" class="btn btn-ghost" id="modal-test"><span class="glyph">⚗</span>测试连接</button>
            <button type="submit" class="btn btn-primary" id="modal-save" form="site-form"><span class="glyph">✓</span>保存配置</button>
          </div>
        </div>
      </section>
    </div>
  `;

  bindModalEvents();
}

function closeModal() {
  ui.modal = null;
  refs.modalRoot.innerHTML = "";
}

function setModalStatus(message, tone = "") {
  const status = refs.modalRoot.querySelector("#modal-status");
  if (!status) {
    return;
  }
  status.textContent = message;
  if (tone) {
    status.dataset.tone = tone;
  } else {
    delete status.dataset.tone;
  }
}

function updateModalHints() {
  if (!ui.modal) {
    return;
  }
  const current = ui.modal.site || {};
  const apiHint = refs.modalRoot.querySelector("#modal-api-key-hint");
  const controllerHint = refs.modalRoot.querySelector("#modal-controller-secret-hint");
  if (apiHint) {
    apiHint.textContent = ui.modal.clearApiKey
      ? "已标记清除 API Key，保存后生效。"
      : (current.hasApiKey ? "当前已保存 API Key；保存时可继续沿用。" : "当前未保存 API Key。");
  }
  if (controllerHint) {
    controllerHint.textContent = ui.modal.clearControllerSecret
      ? "已标记清除覆盖 Secret，保存后生效。"
      : (current.hasControllerSecret ? "当前节点已保存覆盖 Secret。" : "当前节点未保存覆盖 Secret。");
  }
}

function updateModalFrequencyState() {
  const checkbox = refs.modalRoot.querySelector("#modal-use-global-frequency");
  const field = refs.modalRoot.querySelector("#modal-frequency-minutes")?.closest(".field");
  if (checkbox && field) {
    field.classList.toggle("is-disabled", checkbox.checked);
  }
}

function collectSiteFormPayload() {
  const form = refs.modalRoot.querySelector("#site-form");
  if (!form) {
    throw new Error("表单不存在");
  }
  const current = ui.modal?.site || {};
  const data = new FormData(form);
  const useGlobalFrequency = data.get("useGlobalFrequency") === "on";
  const apiKey = String(data.get("apiKey") || "").trim();
  const controllerSecret = String(data.get("controllerSecret") || "").trim();

  return {
    id: current.id,
    name: String(data.get("name") || "").trim(),
    model: String(data.get("model") || "").trim(),
    baseUrl: String(data.get("baseUrl") || "").trim(),
    apiKey,
    clearApiKey: Boolean(ui.modal?.clearApiKey && !apiKey),
    prompt: String(data.get("prompt") || "").trim(),
    timeoutMs: safeNumber(data.get("timeoutMs"), settings().defaultTimeoutMs || 45000),
    enabled: data.get("enabled") === "on",
    useGlobalFrequency,
    frequencyMs: useGlobalFrequency ? null : minutesToMs(data.get("frequencyMinutes")),
    controllerUrl: String(data.get("controllerUrl") || "").trim(),
    controllerSecret,
    clearControllerSecret: Boolean(ui.modal?.clearControllerSecret && !controllerSecret),
    notes: String(data.get("notes") || "").trim(),
  };
}

async function saveSiteFromModal(event) {
  event.preventDefault();
  const payload = collectSiteFormPayload();
  const saveButton = refs.modalRoot.querySelector("#modal-save");
  setChipBusy(saveButton, true, '<span class="glyph">…</span>保存中');
  setModalStatus("正在保存配置…");
  try {
    const saved = await fetchJson("/api/sites", { method: "POST", body: JSON.stringify(payload) });
    ui.selectedSiteId = saved.id;
    ui.selectedHistory = null;
    closeModal();
    await refreshAppState({ loadHistory: true, silent: true });
    showToast(`已保存节点：${saved.name}`, "success");
  } catch (error) {
    setModalStatus(`保存失败：${error.message}`, "error");
    setChipBusy(saveButton, false);
  }
}

async function testSiteFromModal() {
  const payload = collectSiteFormPayload();
  const testButton = refs.modalRoot.querySelector("#modal-test");
  if (!payload.apiKey) {
    setModalStatus("直接测试当前表单时需要重新输入 API Key。保存时仍可保留已存 Key。", "warning");
    return;
  }
  setChipBusy(testButton, true, '<span class="glyph">…</span>检测中');
  setModalStatus("正在发起一次 token 节省版探测…");
  try {
    const set = settings();
    const result = await fetchJson("/api/probe", {
      method: "POST",
      body: JSON.stringify({
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey,
        model: payload.model,
        prompt: payload.prompt || set.defaultPrompt || "Say ok",
        timeoutMs: payload.timeoutMs || set.defaultTimeoutMs || 45000,
        controllerUrl: payload.controllerUrl || set.controllerUrl || "",
        controllerSecret: payload.controllerSecret || "",
      }),
    });
    const route = result.connections?.[0]?.chain || "--";
    const total = result.probe?.totalMs ? `${Math.round(result.probe.totalMs)} ms` : "--";
    const firstToken = result.probe?.firstTokenMs ? `${Math.round(result.probe.firstTokenMs)} ms` : "--";
    setModalStatus(`测试成功：HTTP ${result.probe?.status || "--"} / Total ${total} / TTFT ${firstToken} / Route ${route}`, "success");
  } catch (error) {
    setModalStatus(`测试失败：${error.message}`, "error");
  } finally {
    setChipBusy(testButton, false);
  }
}

function bindModalEvents() {
  const backdrop = refs.modalRoot.querySelector(".modal-backdrop");
  const form = refs.modalRoot.querySelector("#site-form");
  const apiKeyInput = refs.modalRoot.querySelector('input[name="apiKey"]');
  const controllerSecretInput = refs.modalRoot.querySelector('input[name="controllerSecret"]');

  backdrop?.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeModal();
    }
  });
  refs.modalRoot.querySelectorAll('[data-modal-close="button"]').forEach((button) => button.addEventListener("click", closeModal));
  refs.modalRoot.querySelector("#modal-cancel")?.addEventListener("click", closeModal);
  form?.addEventListener("submit", saveSiteFromModal);
  refs.modalRoot.querySelector("#modal-test")?.addEventListener("click", testSiteFromModal);
  refs.modalRoot.querySelector("#modal-use-global-frequency")?.addEventListener("change", updateModalFrequencyState);

  refs.modalRoot.querySelector("#modal-clear-api-key")?.addEventListener("click", () => {
    ui.modal.clearApiKey = !ui.modal.clearApiKey;
    if (apiKeyInput && ui.modal.clearApiKey) {
      apiKeyInput.value = "";
    }
    updateModalHints();
  });
  refs.modalRoot.querySelector("#modal-clear-controller-secret")?.addEventListener("click", () => {
    ui.modal.clearControllerSecret = !ui.modal.clearControllerSecret;
    if (controllerSecretInput && ui.modal.clearControllerSecret) {
      controllerSecretInput.value = "";
    }
    updateModalHints();
  });
  apiKeyInput?.addEventListener("input", () => {
    if (apiKeyInput.value.trim()) {
      ui.modal.clearApiKey = false;
      updateModalHints();
    }
  });
  controllerSecretInput?.addEventListener("input", () => {
    if (controllerSecretInput.value.trim()) {
      ui.modal.clearControllerSecret = false;
      updateModalHints();
    }
  });

  updateModalFrequencyState();
  updateModalHints();
}

/* ---------------------------------------------------------------
   Event wiring
   --------------------------------------------------------------- */
function handleSiteAction(event) {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    event.stopPropagation();
    const siteId = actionButton.dataset.siteId;
    const action = actionButton.dataset.action;
    if (action === "check") {
      checkSite(siteId, actionButton);
    } else if (action === "probe") {
      probeSite(siteId);
    } else if (action === "trace") {
      selectSite(siteId, { switchTab: true });
    } else if (action === "edit") {
      openSiteModal(sites().find((item) => item.id === siteId));
    } else if (action === "pause") {
      pauseSite(siteId);
    } else if (action === "delete") {
      deleteSite(siteId);
    }
    return true;
  }
  return false;
}

function bindEvents() {
  refs.refreshBtn.addEventListener("click", () => refreshAppState({ loadHistory: true }));
  refs.runAllBtn.addEventListener("click", runAllNow);
  refs.addSiteBtn.addEventListener("click", () => openSiteModal());
  refs.settingsForm.addEventListener("submit", saveGlobalSettings);

  // Overview window range → recompute overview
  refs.windowRadios.forEach((radio) => radio.addEventListener("change", () => renderOverview()));

  // Settings switch (auto probe)
  refs.autoEnabled.addEventListener("click", () => {
    const next = refs.autoEnabled.getAttribute("aria-checked") !== "true";
    refs.autoEnabled.setAttribute("aria-checked", next ? "true" : "false");
    refs.autoEnabledHint.textContent = next ? "调度器会按频率自动触发（保存后生效）。" : "当前只接受手动检测。";
    ui.settingsTouched = true;
  });
  [refs.defaultFrequencyMinutes, refs.controllerUrl, refs.defaultTimeoutMs, refs.defaultPrompt].forEach((input) => {
    input.addEventListener("input", () => { ui.settingsTouched = true; });
  });
  refs.controllerSecret.addEventListener("input", () => {
    ui.settingsTouched = true;
    if (refs.controllerSecret.value.trim()) {
      ui.clearGlobalControllerSecret = false;
      renderSettings();
    }
  });
  refs.clearControllerSecret.addEventListener("click", () => {
    ui.clearGlobalControllerSecret = !ui.clearGlobalControllerSecret;
    if (ui.clearGlobalControllerSecret) {
      refs.controllerSecret.value = "";
    }
    ui.settingsTouched = true;
    renderSettings();
  });

  // Search filters service cards live
  refs.siteSearch.addEventListener("input", () => {
    const query = refs.siteSearch.value.trim().toLowerCase();
    refs.serviceGrid.querySelectorAll(".service-card").forEach((card) => {
      const site = sites().find((item) => item.id === card.dataset.siteId);
      const haystack = [site?.name, site?.baseUrl, site?.model, site?.notes].join(" ").toLowerCase();
      card.classList.toggle("hidden-item", Boolean(query) && !haystack.includes(query));
    });
  });

  // Service grid: card actions + selection
  refs.serviceGrid.addEventListener("click", (event) => {
    if (handleSiteAction(event)) {
      return;
    }
    const card = event.target.closest(".service-card[data-site-id]");
    if (card) {
      selectSite(card.dataset.siteId);
    }
  });

  // Hotspot rows select
  refs.hotspotRows.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-site-id]");
    if (row) {
      selectSite(row.dataset.siteId, { switchTab: true });
    }
  });

  // Trace window switches
  refs.traceToolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-window]");
    if (button && pickSelectedSite()) {
      loadSelectedHistory(ui.selectedSiteId, button.dataset.window);
    }
  });

  // Alerts select
  refs.alertList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-site-id]");
    if (item) {
      selectSite(item.dataset.siteId, { switchTab: true });
    }
  });

  // Settings site management actions
  refs.siteManageList.addEventListener("click", handleSiteAction);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ui.modal) {
      closeModal();
    }
  });
}

/* ---------------------------------------------------------------
   Boot
   --------------------------------------------------------------- */
bindEvents();
refreshAppState({ loadHistory: true });
window.setInterval(() => refreshAppState({ loadHistory: true, silent: true }), POLL_MS);
