import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { executeProbe, normalizeControllerUrl, readAutoConfig } from "./probe-core.mjs";
import { calculateHealth } from "./health.mjs";
import { createScheduler } from "./scheduler.mjs";
import { createStore } from "./store.mjs";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const cwd = process.cwd();
const autoConfig = readAutoConfig(cwd);
const publicDir = path.join(cwd, "public");
const dataDir = path.join(cwd, "data");
const defaultControllerUrl = normalizeControllerUrl(
  process.env.CLASH_CONTROLLER ||
    autoConfig.controller ||
    "http://192.168.100.1:9090",
  "192.168.100.1",
);
const store = createStore(dataDir, {
  defaults: {
    settings: {
      controllerUrl: defaultControllerUrl,
      controllerSecret: process.env.CLASH_SECRET || autoConfig.secret,
    },
  },
});
const scheduler = createScheduler({
  store,
  probe: ({ input }) => executeProbe({
    ...input,
    fallbackControllerHost: "192.168.100.1",
  }),
});

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js") {
    return "application/javascript; charset=utf-8";
  }
  if (ext === ".css") {
    return "text/css; charset=utf-8";
  }
  if (ext === ".html") {
    return "text/html; charset=utf-8";
  }
  if (ext === ".json") {
    return "application/json; charset=utf-8";
  }
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  if (ext === ".png") {
    return "image/png";
  }
  return "application/octet-stream";
}

function trySendPublicAsset(res, requestPath) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const resolvedPath = path.resolve(publicDir, relativePath);
  const publicRoot = `${path.resolve(publicDir)}${path.sep}`;
  if (!resolvedPath.startsWith(publicRoot) && resolvedPath !== path.resolve(publicDir, "index.html")) {
    sendJson(res, 404, { error: "Not found" });
    return true;
  }

  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    return false;
  }

  sendFile(res, resolvedPath, contentTypeFor(resolvedPath));
  return true;
}

function sendError(res, statusCode, error) {
  sendJson(res, statusCode, {
    error: error.message || String(error),
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);
  return JSON.parse(body || "{}");
}

function sanitizeResult(result) {
  return {
    targetHost: result.targetHost,
    controllerUrl: result.controllerUrl,
    controllerError: result.controllerError,
    endpointCandidates: result.endpointCandidates,
    probe: result.probe,
    connections: result.connections,
  };
}

function summarizeSite(site) {
  const history = store.readHistory(site.id, "50");
  return {
    ...site,
    health: calculateHealth(history),
    recentResults: history,
    lastResult: history.at(-1) || null,
  };
}

function getStatePayload() {
  const state = store.readState();
  return {
    settings: state.settings,
    scheduler: scheduler.getRuntimeState(),
    sites: state.sites.map(summarizeSite),
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const siteProbeMatch = requestUrl.pathname.match(/^\/api\/sites\/([^/]+)\/probe$/);
  const siteCheckMatch = requestUrl.pathname.match(/^\/api\/sites\/([^/]+)\/check$/);
  const siteHistoryMatch = requestUrl.pathname.match(/^\/api\/sites\/([^/]+)\/history$/);
  const sitePauseMatch = requestUrl.pathname.match(/^\/api\/sites\/([^/]+)\/pause$/);
  const siteMatch = requestUrl.pathname.match(/^\/api\/sites\/([^/]+)$/);

  if (req.method === "GET" && requestUrl.pathname === "/api/config") {
    const state = store.readState();
    sendJson(res, 200, {
      controllerUrl: state.settings.controllerUrl || defaultControllerUrl,
      hasControllerSecret: state.settings.hasControllerSecret,
      configPath: autoConfig.filePath,
      defaultPrompt: state.settings.defaultPrompt || "Say ok",
      defaultTimeoutMs: state.settings.defaultTimeoutMs || 45000,
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/state") {
    try {
      sendJson(res, 200, getStatePayload());
    } catch (error) {
      sendError(res, 500, error);
    }
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/settings") {
    try {
      const input = await readJsonBody(req);
      store.updateSettings(input);
      sendJson(res, 200, getStatePayload());
    } catch (error) {
      sendError(res, 400, error);
    }
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/sites") {
    try {
      const input = await readJsonBody(req);
      const site = store.upsertSite(input);
      sendJson(res, 200, summarizeSite(site));
    } catch (error) {
      sendError(res, 400, error);
    }
    return;
  }

  if (req.method === "DELETE" && siteMatch) {
    try {
      const siteId = decodeURIComponent(siteMatch[1]);
      sendJson(res, 200, store.deleteSite(siteId));
    } catch (error) {
      sendError(res, 400, error);
    }
    return;
  }

  if (req.method === "POST" && siteProbeMatch) {
    try {
      const siteId = decodeURIComponent(siteProbeMatch[1]);
      const result = await scheduler.runSiteNow(siteId);
      sendJson(res, 200, {
        result,
        state: getStatePayload(),
      });
    } catch (error) {
      sendError(res, 500, error);
    }
    return;
  }

  if (req.method === "POST" && siteCheckMatch) {
    try {
      const siteId = decodeURIComponent(siteCheckMatch[1]);
      const result = await scheduler.checkSiteNow(siteId);
      sendJson(res, 200, { result });
    } catch (error) {
      sendError(res, 500, error);
    }
    return;
  }

  if (req.method === "POST" && sitePauseMatch) {
    try {
      const siteId = decodeURIComponent(sitePauseMatch[1]);
      const input = await readJsonBody(req).catch(() => ({}));
      const paused = input?.paused === undefined ? true : Boolean(input.paused);
      const site = store.setSitePaused(siteId, paused);
      if (!site) {
        sendJson(res, 404, { error: "site_not_found" });
        return;
      }
      sendJson(res, 200, {
        site,
        state: getStatePayload(),
      });
    } catch (error) {
      sendError(res, 500, error);
    }
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/probe-all") {
    try {
      const results = await scheduler.runAllNow();
      sendJson(res, 200, {
        results,
        state: getStatePayload(),
      });
    } catch (error) {
      sendError(res, 500, error);
    }
    return;
  }

  if (req.method === "GET" && siteHistoryMatch) {
    try {
      const siteId = decodeURIComponent(siteHistoryMatch[1]);
      const window = requestUrl.searchParams.get("window") || "50";
      const results = store.readHistory(siteId, window);
      sendJson(res, 200, {
        siteId,
        window,
        health: calculateHealth(results),
        results,
      });
    } catch (error) {
      sendError(res, 500, error);
    }
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/probe") {
    try {
      const input = await readJsonBody(req);

      if (!input.baseUrl || !input.apiKey || !input.model) {
        sendJson(res, 400, { error: "baseUrl, apiKey, and model are required" });
        return;
      }

      const settings = store.readRawConfig().settings;

      const result = await executeProbe({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        prompt: input.prompt || settings.defaultPrompt || "Say ok",
        timeoutMs: Number(input.timeoutMs || settings.defaultTimeoutMs || 45000),
        controllerUrl:
          input.controllerUrl ||
          settings.controllerUrl ||
          process.env.CLASH_CONTROLLER ||
          autoConfig.controller,
        secret:
          input.controllerSecret ||
          settings.controllerSecret ||
          process.env.CLASH_SECRET ||
          autoConfig.secret,
        fallbackControllerHost: "192.168.100.1",
      });

      sendJson(res, 200, sanitizeResult(result));
    } catch (error) {
      sendJson(res, 500, {
        error: error.message,
      });
    }
    return;
  }

  if (req.method === "GET") {
    if (trySendPublicAsset(res, requestUrl.pathname)) {
      return;
    }
  }

  sendJson(res, 404, { error: "Not found" });
});

scheduler.start();

server.listen(port, host, () => {
  console.log(`Clash AI Probe Web listening on http://${host}:${port}`);
});
