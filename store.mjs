import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SETTINGS = {
  autoEnabled: false,
  defaultFrequencyMs: 300000,
  defaultPrompt: "Say ok",
  defaultTimeoutMs: 45000,
  controllerUrl: "",
  controllerSecret: "",
};

const WINDOW_MS = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return clone(fallback);
  }

  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) {
    return clone(fallback);
  }

  return JSON.parse(text);
}

function writeJsonAtomic(filePath, payload) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function createNow(options) {
  return () => {
    const value = options.now ? options.now() : Date.now();
    return value instanceof Date ? value.getTime() : Number(value);
  };
}

function isoFromMs(ms) {
  return new Date(ms).toISOString();
}

function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    autoEnabled: Boolean(settings?.autoEnabled ?? DEFAULT_SETTINGS.autoEnabled),
    defaultFrequencyMs: safeNumber(settings?.defaultFrequencyMs, DEFAULT_SETTINGS.defaultFrequencyMs),
    defaultTimeoutMs: safeNumber(settings?.defaultTimeoutMs, DEFAULT_SETTINGS.defaultTimeoutMs),
  };
}

function sanitizeSettings(settings) {
  const normalized = normalizeSettings(settings);
  const { controllerSecret, ...safe } = normalized;
  return {
    ...safe,
    hasControllerSecret: Boolean(controllerSecret),
  };
}

function sanitizeSite(site) {
  const { apiKey, controllerSecret, ...safe } = site;
  return {
    ...safe,
    hasApiKey: Boolean(apiKey),
    hasControllerSecret: Boolean(controllerSecret),
  };
}

function normalizeSite(input, existing, nowIso) {
  if (!existing && (!input.name || !input.baseUrl || !input.model)) {
    throw new Error("name, baseUrl, and model are required");
  }

  const id = existing?.id || input.id || crypto.randomUUID();
  let apiKey = existing?.apiKey || "";
  if (input.clearApiKey) {
    apiKey = "";
  } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    apiKey = input.apiKey.trim();
  }

  let controllerSecret = existing?.controllerSecret || "";
  if (input.clearControllerSecret) {
    controllerSecret = "";
  } else if (typeof input.controllerSecret === "string" && input.controllerSecret.trim()) {
    controllerSecret = input.controllerSecret.trim();
  }

  return {
    id,
    name: String(input.name ?? existing?.name ?? "").trim(),
    baseUrl: String(input.baseUrl ?? existing?.baseUrl ?? "").trim(),
    model: String(input.model ?? existing?.model ?? "").trim(),
    apiKey,
    prompt: String(input.prompt ?? existing?.prompt ?? "").trim(),
    timeoutMs: safeNumber(input.timeoutMs, existing?.timeoutMs || DEFAULT_SETTINGS.defaultTimeoutMs),
    enabled: Boolean(input.enabled ?? existing?.enabled ?? true),
    paused: Boolean(input.paused ?? existing?.paused ?? false),
    useGlobalFrequency: Boolean(input.useGlobalFrequency ?? existing?.useGlobalFrequency ?? true),
    frequencyMs: input.frequencyMs === null || input.frequencyMs === ""
      ? null
      : safeNumber(input.frequencyMs, existing?.frequencyMs || null),
    controllerUrl: String(input.controllerUrl ?? existing?.controllerUrl ?? "").trim(),
    controllerSecret,
    notes: String(input.notes ?? existing?.notes ?? "").trim(),
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

function parseHistoryLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function resultTime(result) {
  const time = Date.parse(result.finishedAt || result.recordedAt || "");
  return Number.isFinite(time) ? time : 0;
}

export function createStore(rootDir, options = {}) {
  const now = createNow(options);
  const configPath = path.join(rootDir, "config.json");
  const historyPath = path.join(rootDir, "probe-results.jsonl");
  const defaults = {
    settings: normalizeSettings(options.defaults?.settings),
    sites: [],
  };

  function readRawConfig() {
    ensureDir(rootDir);
    const config = readJson(configPath, defaults);
    return {
      settings: normalizeSettings(config.settings),
      sites: Array.isArray(config.sites) ? config.sites : [],
    };
  }

  function saveConfig(config) {
    writeJsonAtomic(configPath, {
      settings: normalizeSettings(config.settings),
      sites: Array.isArray(config.sites) ? config.sites : [],
    });
  }

  function readState() {
    const config = readRawConfig();
    return {
      settings: sanitizeSettings(config.settings),
      sites: config.sites.map(sanitizeSite),
    };
  }

  function updateSettings(input) {
    const config = readRawConfig();
    let controllerSecret = config.settings.controllerSecret || "";
    if (input.clearControllerSecret) {
      controllerSecret = "";
    } else if (typeof input.controllerSecret === "string" && input.controllerSecret.trim()) {
      controllerSecret = input.controllerSecret.trim();
    }

    config.settings = normalizeSettings({
      ...config.settings,
      ...input,
      controllerSecret,
    });
    saveConfig(config);
    return sanitizeSettings(config.settings);
  }

  function upsertSite(input) {
    const config = readRawConfig();
    const existingIndex = config.sites.findIndex((site) => site.id === input.id);
    const existing = existingIndex >= 0 ? config.sites[existingIndex] : null;
    const site = normalizeSite(input, existing, isoFromMs(now()));

    if (existingIndex >= 0) {
      config.sites[existingIndex] = site;
    } else {
      config.sites.push(site);
    }

    saveConfig(config);
    return sanitizeSite(site);
  }

  function deleteSite(id) {
    const config = readRawConfig();
    const before = config.sites.length;
    config.sites = config.sites.filter((site) => site.id !== id);
    saveConfig(config);
    return { deleted: config.sites.length !== before };
  }

  function getSiteWithSecret(id) {
    const config = readRawConfig();
    const site = config.sites.find((item) => item.id === id);
    return site ? clone(site) : null;
  }

  function appendResult(result) {
    ensureDir(rootDir);
    const entry = {
      id: result.id || crypto.randomUUID(),
      recordedAt: result.recordedAt || isoFromMs(now()),
      finishedAt: result.finishedAt || result.recordedAt || isoFromMs(now()),
      ...result,
    };
    fs.appendFileSync(historyPath, `${JSON.stringify(entry)}\n`, "utf8");
    return clone(entry);
  }

  function readAllHistory() {
    if (!fs.existsSync(historyPath)) {
      return [];
    }

    return fs.readFileSync(historyPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseHistoryLine)
      .filter(Boolean)
      .sort((a, b) => resultTime(a) - resultTime(b));
  }

  function readHistory(siteId, window = "50") {
    const siteResults = readAllHistory().filter((result) => result.siteId === siteId);
    if (window === "50") {
      return siteResults.slice(-50).map(clone);
    }

    const durationMs = WINDOW_MS[window] || WINDOW_MS["24h"];
    const minTime = now() - durationMs;
    return siteResults
      .filter((result) => resultTime(result) >= minTime)
      .map(clone);
  }

  function setSitePaused(id, paused) {
    const config = readRawConfig();
    const index = config.sites.findIndex((site) => site.id === id);
    if (index < 0) {
      return null;
    }
    const next = !!paused;
    if (config.sites[index].paused === next) {
      return sanitizeSite(config.sites[index]);
    }
    config.sites[index] = {
      ...config.sites[index],
      paused: next,
      updatedAt: isoFromMs(now()),
    };
    saveConfig(config);
    return sanitizeSite(config.sites[index]);
  }

  return {
    readState,
    updateSettings,
    upsertSite,
    deleteSite,
    getSiteWithSecret,
    appendResult,
    readHistory,
    readRawConfig,
    setSitePaused,
  };
}
