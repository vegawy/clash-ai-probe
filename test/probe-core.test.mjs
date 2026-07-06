import test from "node:test";
import assert from "node:assert/strict";

import { runOneProbe } from "../probe-core.mjs";

test("runOneProbe sends a token-efficient streaming request", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;

  globalThis.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "ok",
          },
        },
      ],
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  try {
    const result = await runOneProbe(
      "https://relay.example/v1/chat/completions",
      "sk-test",
      "gpt-test",
      "Say ok",
      5000,
    );

    assert.equal(result.ok, true);
    assert.equal(requestBody.stream, true);
    assert.equal(requestBody.temperature, 0);
    assert.equal(requestBody.max_tokens, 2);
    assert.deepEqual(requestBody.messages, [
      {
        role: "user",
        content: "Say ok",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
