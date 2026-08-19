#!/usr/bin/env node
/* ============================================================================
 * check-colors.js -- hardcoded-color ratchet guard.
 *
 * The app themes per-nation through CSS tokens (var(--...)). New UI code should
 * use tokens, not hardcoded hex. This guard counts hardcoded color literals per
 * tracked file and compares to a committed baseline (tools/color-baseline.json):
 *   - a file's count going UP fails the check (a new hardcoded color slipped in),
 *   - a file's count going DOWN is fine (cleanup) and you should re-baseline.
 *
 * It deliberately does NOT try to distinguish screen vs print/jsPDF/canvas (that
 * needs a parser); the ratchet just prevents regressions while the neutral-color
 * cleanup continues. It ignores emoji HTML entities (&#1234;) and var() fallback
 * hexes (var(--x,#hex)), which are already tokenized.
 *
 * Usage:
 *   node tools/check-colors.js            # check against baseline (exit 1 on regression)
 *   node tools/check-colors.js --update   # regenerate the baseline from current counts
 * ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'color-baseline.json');

// Root-level UI JavaScript that renders on-screen. (Edge functions, service
// worker, and config are excluded -- they aren't themed UI.)
const EXCLUDE = new Set(['sw.js', 'shared-config.js']);
function trackedFiles() {
  return fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.js') && !EXCLUDE.has(f))
    .filter(f => fs.statSync(path.join(ROOT, f)).isFile())
    .sort();
}

// Count hardcoded color literals in a file's source.
function countColors(src) {
  // Drop emoji entities (&#128196;) and var() fallback hexes so neither counts.
  const cleaned = src
    .replace(/&#[0-9]+;?/g, '')                        // HTML numeric entities
    .replace(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/gi, 'var()'); // tokenized fallbacks
  const hex = cleaned.match(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/g) || [];
  const rgb = cleaned.match(/\brgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g) || [];
  // rgba(var(--accent-rgb),..) is already tokenized -> not matched by the rgb regex above.
  return hex.length + rgb.length;
}

function currentCounts() {
  const out = {};
  for (const f of trackedFiles()) out[f] = countColors(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  return out;
}

const update = process.argv.includes('--update');
const counts = currentCounts();

if (update) {
  fs.writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log('Wrote baseline for ' + Object.keys(counts).length + ' files (' + total + ' hardcoded colors).');
  process.exit(0);
}

let baseline = {};
try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); }
catch (e) { console.error('No baseline found. Run: node tools/check-colors.js --update'); process.exit(2); }

const regressions = [];
for (const f of Object.keys(counts)) {
  const base = baseline[f];
  if (base === undefined) { if (counts[f] > 0) regressions.push(f + ': new file with ' + counts[f] + ' hardcoded color(s) — re-baseline or tokenize'); continue; }
  if (counts[f] > base) regressions.push(f + ': ' + base + ' -> ' + counts[f] + ' (+' + (counts[f] - base) + ' hardcoded color(s))');
}

if (regressions.length) {
  console.error('Hardcoded-color guard FAILED — new literals detected (use theme tokens var(--...)):\n');
  regressions.forEach(r => console.error('  ' + r));
  console.error('\nIf this is an intentional exception (print/jsPDF/canvas literal), re-baseline with:\n  node tools/check-colors.js --update');
  process.exit(1);
}
console.log('Hardcoded-color guard passed (' + Object.keys(counts).length + ' files checked).');
