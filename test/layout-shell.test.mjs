import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("NiyuLab template design tokens are preserved as the visual source of truth", () => {
  // Core palette + type tokens copied byte-for-byte from the approved template.
  assert.match(styles, /--bg:\s*oklch\(18\.54% 0\.025 303\.14\);/);
  assert.match(styles, /--accent:\s*oklch\(77\.55% 0\.078 316\.22\);/);
  assert.match(styles, /--display:\s*"Noto Serif SC"/);
  assert.match(styles, /--body:\s*"Noto Sans SC"/);
});

test("shell uses the editorial two-column grid with a sticky header", () => {
  // The redesigned page scrolls (no locked 100vh viewport) and pins the header.
  assert.match(styles, /\.app-header\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;/);
  assert.match(styles, /\.shell\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 360px;/);
  assert.doesNotMatch(styles, /\.app-shell\s*\{[\s\S]*height:\s*100vh;/);
});

test("index.html mounts the main + rail columns and live-data containers", () => {
  assert.match(html, /class="shell"/);
  assert.match(html, /class="main-column"/);
  assert.match(html, /class="rail-column"/);
  // Live containers app.js renders into.
  for (const id of ["overview-kpis", "service-grid", "logRows", "alertList", "site-manage-list"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
