import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("workspace navigation uses the four CSS-driven tabs (no legacy hash sidebar)", () => {
  // The four workspace tabs, including the added 配置 (settings) tab that hosts
  // global settings + relay CRUD so no original feature is lost.
  for (const id of ["tab-services", "tab-traces", "tab-logs", "tab-settings"]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(`for="${id}"`));
  }

  // Legacy sidebar navigation is fully gone.
  assert.doesNotMatch(html, /class="sidebar-nav"/);
  assert.doesNotMatch(html, /data-view="overview"/);
});

test("each tab reveals exactly its own panel via the checked-radio selectors", () => {
  for (const panel of ["panel-services", "panel-traces", "panel-logs", "panel-settings"]) {
    assert.match(html, new RegExp(`id="${panel}"`));
  }

  // CSS switches the visible panel off the hidden radio inputs.
  assert.match(styles, /#tab-services:checked ~ \.shell #panel-services/);
  assert.match(styles, /#tab-settings:checked ~ \.shell #panel-settings\s*\{[\s\S]*display:\s*block;/);
});

test("the settings tab exposes the global settings + add-site entry points", () => {
  for (const id of [
    "settings-form",
    "auto-enabled",
    "default-frequency-minutes",
    "controller-url",
    "controller-secret",
    "add-site-btn",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
