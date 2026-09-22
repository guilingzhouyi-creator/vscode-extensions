#!/usr/bin/env node
/**
 * Module: Verification Harness — Latency Measurement & Ratchet Guard
 * File Path: scripts/validate-latency-metrics.js
 * Architecture Role: Enforces C-06 (high-resolution hrtime latency measurement,
 *   microsecond granularity) and operates a strict monotonic ratchet on legacy
 *   `latencyMs` references, ensuring they monotonically decrease to 0 by S9.
 * Dependencies & Triggers: Run via `npm test` or `node scripts/validate-latency-metrics.js`.
 * Responsibilities: Enforce hrtime.bigint adoption and downward-only ratchet on legacy
 *   latencyMs references.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass, 1 on failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

console.log('=== Validating Latency Metrics & Legacy Reference Ratchet (C-06, §3-5) ===');

// 1. Validate process.hrtime.bigint runtime support
assert(typeof process.hrtime.bigint === 'function', 'process.hrtime.bigint must be available');
const t1 = process.hrtime.bigint();
const t2 = process.hrtime.bigint();
assert(t2 >= t1, 'hrtime.bigint must be monotonically non-decreasing');
console.log('✓ High-resolution timer (process.hrtime.bigint) verified');

// 2. Monotonic Ratchet on legacy latencyMs references in src/
// Baseline count as of S0: 7 references.
// This budget must STRICTLY DECREASE (ratchet down) as S1/S9 refactoring eliminates latencyMs.
const LATENCY_MS_BUDGET = 7;

function inspectFileForLatencyMs(filePath, occurrences) {
  let found = 0;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/\blatencyMs\b/.test(lines[i])) {
      found++;
      occurrences.push(`${path.relative(ROOT, filePath)}:${i + 1}: ${lines[i].trim()}`);
    }
  }
  return found;
}

function scanForLatencyMs(dir) {
  let count = 0;
  const occurrences = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = scanForLatencyMs(full);
      count += sub.count;
      occurrences.push(...sub.occurrences);
    } else if (entry.name.endsWith('.ts')) {
      count += inspectFileForLatencyMs(full, occurrences);
    }
  }

  return { count, occurrences };
}

const { count, occurrences } = scanForLatencyMs(SRC_DIR);
console.log(`Found ${count} latencyMs references in src/ (budget ceiling: ${LATENCY_MS_BUDGET})`);

if (count > LATENCY_MS_BUDGET) {
  console.error(
    `[FAIL] Legacy latencyMs count (${count}) exceeded budget ceiling (${LATENCY_MS_BUDGET})!`,
  );
  console.error(
    'New latencyMs references are strictly forbidden. Use latencyUs (hrtime.bigint) instead:',
  );
  for (const occ of occurrences) {
    console.error(`  - ${occ}`);
  }
  process.exit(1);
}

console.log(
  `✓ Monotonic ratchet passed: latencyMs count (${count}) <= ceiling (${LATENCY_MS_BUDGET})`,
);
console.log('[PASS] validate-latency-metrics passed all checks.');
process.exit(0);
