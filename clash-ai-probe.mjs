#!/usr/bin/env node

import process from "node:process";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { executeProbe, normalizeControllerUrl, readAutoConfig } from "./probe-core.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) {
      continue;
    }

    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = next;
    i += 1;
  }
  return args;
}

function formatMs(value) {
  return `${value.toFixed(0)} ms`;
}

class MutableStdout extends Writable {
  constructor(target) {
    super();
    this.target = target;
    this.muted = false;
  }

  _write(chunk, encoding, callback) {
    if (!this.muted) {
      this.target.write(chunk, encoding);
    }
    callback();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    console.log("Usage: node clash-ai-probe.mjs [--base-url URL] [--api-key KEY] [--model MODEL]");
    console.log("Optional: --prompt TEXT --controller URL --secret SECRET --timeout 45000");
    process.exit(0);
  }
  const cwd = process.cwd();
  const autoConfig = readAutoConfig(cwd);
  const mutableStdout = new MutableStdout(process.stdout);
  const rl = createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true,
  });

  const ask = async (label, defaultValue = "") => {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = await rl.question(`${label}${suffix}: `);
    return (answer.trim() || defaultValue).trim();
  };

  const askSecret = async (label, defaultValue = "") => {
    const suffix = defaultValue ? " [press Enter to keep current]" : "";
    process.stdout.write(`${label}${suffix}: `);
    mutableStdout.muted = true;
    const answer = await rl.question("");
    mutableStdout.muted = false;
    process.stdout.write("\n");
    return (answer.trim() || defaultValue).trim();
  };

  try {
    const baseUrl =
      args["base-url"] ||
      (await ask("Base URL", "https://gpt-agent.cc/v1"));
    const apiKey =
      args["api-key"] ||
      process.env.OPENAI_API_KEY ||
      (await askSecret("API key"));
    const model =
      args.model ||
      (await ask("Model", "gpt-4.1-mini"));
    const promptText =
      args.prompt ||
      (await ask("Prompt", "Say ok"));
    const timeoutMs = Number(args.timeout || 45000);

    const controllerDefault = normalizeControllerUrl(
      args.controller || process.env.CLASH_CONTROLLER || autoConfig.controller || "http://192.168.100.1:9090",
      "192.168.100.1",
    );
    const controllerInput =
      args.controller ||
      process.env.CLASH_CONTROLLER ||
      (await ask("OpenClash controller URL (type none to skip)", controllerDefault));
    const controllerUrl =
      controllerInput.toLowerCase() === "none"
        ? ""
        : controllerInput;
    const secret =
      args.secret ||
      process.env.CLASH_SECRET ||
      (controllerUrl ? await askSecret("OpenClash controller secret", autoConfig.secret) : "");

    console.log("");
    console.log("Running probe...");
    const result = await executeProbe({
      baseUrl,
      apiKey,
      model,
      prompt: promptText,
      timeoutMs,
      controllerUrl,
      secret,
    });

    console.log("");
    console.log("Result");
    console.log(`Endpoint: ${result.probe?.endpoint || result.endpointCandidates[0]}`);
    console.log(`Target host: ${result.targetHost}`);

    if (!result.probe?.ok) {
      console.log(`HTTP status: ${result.probe?.status ?? "request failed"}`);
      if (result.probe?.headersMs != null) {
        console.log(`Response headers: ${formatMs(result.probe.headersMs)}`);
      }
      if (result.probe?.bodyText) {
        console.log("Error body:");
        console.log(result.probe.bodyText.slice(0, 800));
      }
    } else {
      console.log(`HTTP status: ${result.probe.status}`);
      console.log(`Response headers: ${formatMs(result.probe.headersMs)}`);
      console.log(`First chunk: ${formatMs(result.probe.firstChunkMs)}`);
      console.log(`First token: ${formatMs(result.probe.firstTokenMs)}`);
      console.log(`Total time: ${formatMs(result.probe.totalMs)}`);
      console.log(`Content-Type: ${result.probe.contentType}`);
      console.log("Preview:");
      console.log((result.probe.preview || "").slice(0, 300) || "<empty>");
    }

    console.log("");
    console.log("OpenClash");
    if (result.controllerError) {
      console.log(`Controller unavailable: ${result.controllerError}`);
    }
    if (result.connections.length === 0) {
      console.log("No matching connection captured.");
    } else {
      for (const conn of result.connections.slice(0, 5)) {
        console.log(`- host: ${conn.host}`);
        console.log(`  chain: ${conn.chain || "<none>"}`);
        console.log(`  rule: ${conn.rule}${conn.rulePayload ? ` (${conn.rulePayload})` : ""}`);
        console.log(`  inbound: ${conn.inbound || "<none>"} / ${conn.type || "<none>"}`);
        console.log(`  dnsMode: ${conn.dnsMode || "<none>"}`);
        console.log(`  remoteDestination: ${conn.remoteDestination || "<none>"}`);
        console.log(`  bytes: up ${conn.upload}, down ${conn.download}`);
        console.log(`  newConnection: ${conn.isNew ? "yes" : "no"}`);
      }
    }

    rl.close();

    if (!result.probe?.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    rl.close();
    console.error("");
    console.error(`Probe failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
