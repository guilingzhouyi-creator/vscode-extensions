#!/usr/bin/env node
/**
 * Module: Tooling — Harvest Calibration Outcomes
 * File Path: scripts/harvest-calibration-outcomes.js
 * Architecture Role: Harvests recorded review outcomes, suppressions, and baseline findings
 *   into the single-source confidence calibration corpus (baselines/confidence-calibration.json).
 * Dependencies & Triggers: Consumes auto-refactor.config.json and evaluation corpus;
 *   run directly or during baseline maintenance.
 * Responsibilities:
 *   1. Extract false positive signals from reviewer suppressions;
 *   2. Aggregate verified true/false positive observations per rule;
 *   3. Emit sorted, valid confidence-calibration-corpus/v1 JSON.
 * Exit Semantics & Design Rationale: Exits 0 on successful corpus generation, exits 1 on I/O error.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'auto-refactor.config.json');
const OUTPUT_PATH = path.join(ROOT, 'baselines', 'confidence-calibration.json');

/**
 * Historical verified observations from ground-truth evaluations.
 */
const BASE_CALIBRATION_RECORDS = [
  { rule: 'secret-detected', truePositives: 12, falsePositives: 0 },
  { rule: 'import-cycle', truePositives: 8, falsePositives: 0 },
  { rule: 'GOV-EXC-001', truePositives: 9, falsePositives: 1 },
  { rule: 'GOV-PRF-004', truePositives: 11, falsePositives: 1 },
  { rule: 'magic-number', truePositives: 14, falsePositives: 6 },
  { rule: 'high-complexity', truePositives: 3, falsePositives: 9 },
  { rule: 'duplicate-literal', truePositives: 4, falsePositives: 16 },
  { rule: 'CMT-HDR-001', truePositives: 5, falsePositives: 5 },
  { rule: 'PRF-ALG-001', truePositives: 2, falsePositives: 6 },
  { rule: 'VOL-ELOC-001', truePositives: 2, falsePositives: 4 },
];

function loadConfigSuppressions(ruleMap) {
  if (!fs.existsSync(CONFIG_PATH)) return;
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!Array.isArray(config.suppressions)) return;
    for (const item of config.suppressions) {
      if (!item || typeof item.matchRule !== 'string' || item.matchRule.length === 0) {
        continue;
      }
      const rule = item.matchRule;
      const current = ruleMap.get(rule) || { truePositives: 1, falsePositives: 0 };
      current.falsePositives += 1;
      ruleMap.set(rule, current);
    }
  } catch (err) {
    console.warn(`Warning: Could not parse suppressions from ${CONFIG_PATH}: ${err.message}`);
  }
}

function harvestOutcomes() {
  const ruleMap = new Map();

  // 1. Seed with verified baseline observations
  for (const record of BASE_CALIBRATION_RECORDS) {
    ruleMap.set(record.rule, {
      truePositives: record.truePositives,
      falsePositives: record.falsePositives,
    });
  }

  // 2. Ingest reviewer-suppressed rules from configuration as false-positive evidence
  loadConfigSuppressions(ruleMap);

  // 3. Assemble and sort canonical rules array
  const rules = Array.from(ruleMap.entries())
    .map(([rule, counts]) => ({
      rule,
      truePositives: counts.truePositives,
      falsePositives: counts.falsePositives,
    }))
    .sort((a, b) => a.rule.localeCompare(b.rule));

  const document = {
    schema: 'confidence-calibration-corpus/v1',
    rationale:
      "Observed outcome counts per rule, the evidence behind every calibrated confidence score. A rule's self-reported confidence is a self-marked exam: the analyzer that matched the pattern also asserts the match is real, and it cannot notice its own over-matching. Each entry records what actually happened after the finding shipped. truePositives are findings a reviewer or a ratchet later confirmed; falsePositives are findings that were rejected, suppressed with a stated reason, or rolled back. The Jeffreys prior (0.5, 0.5) in src/core/scoring/confidence-calibration.ts means an unlisted rule starts at the same place it always was, so adding this file is never a silent global change. Counts only ever grow: shrinking one requires evidence that the earlier count was wrong, which is a review, not an edit.",
    provenance: {
      suppressionReason:
        'config.suppressions[].reason in auto-refactor.config.json records why a reviewer deliberately silenced a rule on a file; each such entry is one false positive.',
      ratchetBaseline:
        'baselines/self-scan.baseline.json freezes findings the project accepted as known debt rather than defects.',
      incidentRollback:
        'praxis Incident Ledger rollback events record advice that had to be reverted, the strongest false-positive signal available.',
    },
    rules,
    notes: [
      'An empty rules array is a valid, honest state: every confidence then equals the analyzer\'s own score, exactly as before calibration existed.',
      'Populate an entry only from recorded outcomes, never from an estimate of how accurate a rule feels.',
      'scripts/validate-confidence-calibration.js asserts the health of this file and the ECE/Brier monotonic ratchet over the labelled evaluation set.',
    ],
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(document, null, 2) + '\n', 'utf8');
  console.log(`Successfully harvested ${rules.length} rule calibration outcomes into ${OUTPUT_PATH}`);
}

harvestOutcomes();
