import fs from "node:fs";
import path from "node:path";

export function ensureScheme(value) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
}

export function normalizeBaseUrl(value) {
  const url = new URL(ensureScheme(value.trim()));
  url.hash = "";
  url.search = "";
  return url;
}

export function buildEndpointCandidates(baseInput) {
  const baseUrl = normalizeBaseUrl(baseInput);
  const pathname = baseUrl.pathname.replace(/\/+$/, "");
  const candidates = [];

  if (pathname === "") {
    candidates.push(new URL("/v1/chat/completions", baseUrl));
    candidates.push(new URL("/chat/completions", baseUrl));
  } else if (pathname.endsWith("/chat/completions")) {
    candidates.push(baseUrl);
  } else {
    candidates.push(new URL(`${pathname}/chat/completions`, baseUrl));
    if (!pathname.endsWith("/v1")) {
      candidates.push(new URL("/v1/chat/completions", baseUrl));
    }
    candidates.push(new URL("/chat/completions", baseUrl));
  }

  const seen = new Set();
  return candidates.filter((url) => {
    if (seen.has(url.href)) {
      return false;
    }
    seen.add(url.href);
    return true;
  });
}

export function readAutoConfig(cwd) {
  const fileNames = [
    "运行配置config.yaml",
    "codexconfig.yaml",
    "原始配置config.yaml",
  ];

  for (const fileName of fileNames) {
    const filePath = path.join(cwd, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const text = fs.readFileSync(filePath, "utf8");
    const controllerMatch = text.match(/^external-controller:\s*(.+)$/m);
    const secretMatch = text.match(/^secret:\s*(.+)$/m);

    if (controllerMatch || secretMatch) {
      return {
        filePath,
        controller: controllerMatch ? controllerMatch[1].trim() : "",
        secret: secretMatch ? secretMatch[1].trim() : "",
      };
    }
  }

  return {
    filePath: "",
    controller: "",
    secret: "",
  };
}

export function normalizeControllerUrl(value, fallbackHost = "") {
  if (!value) {
    return "";
  }

  const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
  if (["0.0.0.0", "127.0.0.1", "::", "[::]"].includes(url.hostname) && fallbackHost) {
    url.hostname = fallbackHost;
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function matchesHost(actualHost, targetHost) {
  if (!actualHost || !targetHost) {
    return false;
  }

  const a = actualHost.toLowerCase();
  const b = targetHost.toLowerCase();
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function flattenText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(flattenText).join("");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if (typeof value.text === "string") {
    return value.text;
  }

  if (typeof value.content === "string") {
    return value.content;
  }

  return Object.values(value).map(flattenText).join("");
}

export function extractChunkText(payload) {
  const choice = payload?.choices?.[0];
  if (!choice) {
    return "";
  }

  return (
    flattenText(choice.delta?.content) ||
    flattenText(choice.delta?.reasoning_content) ||
    flattenText(choice.message?.content) ||
    flattenText(choice.text)
  );
}

export function summarizeConnection(conn, baselineIds) {
  return {
    id: conn.id,
    host: conn.metadata?.host || "",
    remoteDestination: conn.metadata?.remoteDestination || "",
    inbound: conn.metadata?.inboundName || "",
    type: conn.metadata?.type || "",
    dnsMode: conn.metadata?.dnsMode || "",
    chain: Array.isArray(conn.chains) ? conn.chains.join(" -> ") : "",
    rule: conn.rule || "",
    rulePayload: conn.rulePayload || "",
    upload: conn.upload || 0,
    download: conn.download || 0,
    start: conn.start || "",
    isNew: !baselineIds.has(conn.id),
  };
}

export async function fetchConnections(controllerUrl, secret) {
  const response = await fetch(`${controllerUrl}/connections`, {
    headers: {
      Authorization: `Bearer ${secret}`,
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`OpenClash controller returned ${response.status}`);
  }

  return response.json();
}

export function startConnectionPoller({ controllerUrl, secret, targetHost, baselineIds }) {
  const observed = new Map();
  let active = true;

  const done = (async () => {
    while (active) {
      try {
        const payload = await fetchConnections(controllerUrl, secret);
        for (const conn of payload.connections || []) {
          if (matchesHost(conn.metadata?.host, targetHost)) {
            observed.set(conn.id, summarizeConnection(conn, baselineIds));
          }
        }
      } catch {
      }

      if (!active) {
        break;
      }
      await sleep(350);
    }
  })();

  return {
    async finish() {
      active = false;
      await done;
      return Array.from(observed.values()).sort((a, b) => {
        if (a.isNew !== b.isNew) {
          return Number(b.isNew) - Number(a.isNew);
        }

        const aTraffic = a.upload + a.download;
        const bTraffic = b.upload + b.download;
        return bTraffic - aTraffic;
      });
    },
  };
}

export async function runOneProbe(endpoint, apiKey, model, promptText, timeoutMs) {
  const requestBody = {
    model,
    stream: true,
    temperature: 0,
    max_tokens: 2,
    messages: [
      {
        role: "user",
        content: promptText,
      },
    ],
  };

  const startedAt = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const headersMs = performance.now() - startedAt;

  if (!response.ok) {
    const bodyText = await response.text();
    return {
      ok: false,
      endpoint,
      status: response.status,
      headersMs,
      bodyText,
    };
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !/text\/event-stream/i.test(contentType)) {
    const bodyText = await response.text();
    const bodyMs = performance.now() - startedAt;
    let preview = bodyText;

    try {
      const payload = JSON.parse(bodyText);
      preview =
        flattenText(payload?.choices?.[0]?.message?.content) ||
        flattenText(payload?.choices?.[0]?.text) ||
        bodyText;
    } catch {
    }

    return {
      ok: true,
      endpoint,
      status: response.status,
      headersMs,
      firstChunkMs: bodyMs,
      firstTokenMs: bodyMs,
      totalMs: bodyMs,
      preview,
      contentType,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let preview = "";
  let firstChunkMs = null;
  let firstTokenMs = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    if (value && value.length > 0 && firstChunkMs === null) {
      firstChunkMs = performance.now() - startedAt;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) {
        continue;
      }

      const payloadText = line.slice(5).trim();
      if (!payloadText || payloadText === "[DONE]") {
        continue;
      }

      try {
        const payload = JSON.parse(payloadText);
        const chunkText = extractChunkText(payload);
        if (chunkText && firstTokenMs === null) {
          firstTokenMs = performance.now() - startedAt;
        }
        preview += chunkText;
      } catch {
      }
    }
  }

  const flushed = decoder.decode();
  if (flushed) {
    buffer += flushed;
  }

  const trailing = buffer.trim();
  if (trailing.startsWith("data:")) {
    const payloadText = trailing.slice(5).trim();
    if (payloadText && payloadText !== "[DONE]") {
      try {
        const payload = JSON.parse(payloadText);
        const chunkText = extractChunkText(payload);
        if (chunkText && firstTokenMs === null) {
          firstTokenMs = performance.now() - startedAt;
        }
        preview += chunkText;
      } catch {
      }
    }
  }

  return {
    ok: true,
    endpoint,
    status: response.status,
    headersMs,
    firstChunkMs: firstChunkMs ?? headersMs,
    firstTokenMs: firstTokenMs ?? firstChunkMs ?? headersMs,
    totalMs: performance.now() - startedAt,
    preview,
    contentType,
  };
}

export function shouldTryNextCandidate(result) {
  if (result.ok) {
    return false;
  }

  if (result.status === 404 || result.status === 405) {
    return true;
  }

  const text = (result.bodyText || "").toLowerCase();
  return (
    text.includes("not found") ||
    text.includes("cannot post") ||
    text.includes("unknown path")
  );
}

export async function runProbeWithCandidates(candidates, apiKey, model, promptText, timeoutMs) {
  let lastResult = null;

  for (const endpoint of candidates) {
    const result = await runOneProbe(endpoint, apiKey, model, promptText, timeoutMs);
    if (result.ok) {
      return result;
    }

    lastResult = result;
    if (!shouldTryNextCandidate(result)) {
      return result;
    }
  }

  return lastResult;
}

export async function executeProbe({
  baseUrl,
  apiKey,
  model,
  prompt,
  timeoutMs = 45000,
  controllerUrl = "",
  secret = "",
  fallbackControllerHost = "192.168.100.1",
}) {
  const normalizedController = controllerUrl
    ? normalizeControllerUrl(controllerUrl, fallbackControllerHost)
    : "";
  const targetHost = normalizeBaseUrl(baseUrl).hostname;

  let baselineIds = new Set();
  let poller = null;
  let controllerError = "";

  if (normalizedController && secret) {
    try {
      const baseline = await fetchConnections(normalizedController, secret);
      baselineIds = new Set((baseline.connections || []).map((conn) => conn.id));
      poller = startConnectionPoller({
        controllerUrl: normalizedController,
        secret,
        targetHost,
        baselineIds,
      });
    } catch (error) {
      controllerError = error.message;
    }
  }

  const candidates = buildEndpointCandidates(baseUrl).map((url) => url.toString());
  const probeResult = await runProbeWithCandidates(
    candidates,
    apiKey,
    model,
    prompt,
    timeoutMs,
  );

  await sleep(800);
  const connections = poller ? await poller.finish() : [];

  return {
    targetHost,
    controllerUrl: normalizedController,
    controllerError,
    endpointCandidates: candidates,
    probe: probeResult,
    connections,
  };
}
