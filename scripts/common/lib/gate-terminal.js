/**
 * Module: Gate Terminal Formatting & Feedback Protocol
 * File Path: scripts/common/lib/gate-terminal.js
 * Architecture Role: Shared terminal formatting utility enforcing semantic status vocabulary
 *   (GUARD-FBK-001 / GUARD-STEP-001) and consistent console output across workspace gates.
 * Dependencies & Triggers: Consumes Node.js standard libraries (process); imported by gate scripts
 *   and validators in scripts/common/.
 * Responsibilities:
 *   1. Expose closed status vocabulary: PASS, WARN, BLOCK, INFO, SKIP;
 *   2. Provide terminal color helpers with NO_COLOR and TTY detection;
 *   3. Render structured section banners and key-value metrics tables;
 *   4. Provide deterministic exit helpers for gate execution pipelines.
 * Exit Semantics & Design Rationale: Provides pure formatters and optional exit helpers that
 *   strictly map BLOCK -> 1 and PASS -> 0.
 */

'use strict';

const isColorSupported = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR);

const COLORS = {
  reset: isColorSupported ? '\x1b[0m' : '',
  bold: isColorSupported ? '\x1b[1m' : '',
  dim: isColorSupported ? '\x1b[2m' : '',
  green: isColorSupported ? '\x1b[32m' : '',
  yellow: isColorSupported ? '\x1b[33m' : '',
  red: isColorSupported ? '\x1b[31m' : '',
  cyan: isColorSupported ? '\x1b[36m' : '',
  gray: isColorSupported ? '\x1b[90m' : '',
};

const STATUS_LABELS = Object.freeze({
  PASS: `${COLORS.green}✔ PASS${COLORS.reset}`,
  WARN: `${COLORS.yellow}⚠ WARN${COLORS.reset}`,
  BLOCK: `${COLORS.red}✖ BLOCK${COLORS.reset}`,
  INFO: `${COLORS.cyan}ℹ INFO${COLORS.reset}`,
  SKIP: `${COLORS.gray}↷ SKIP${COLORS.reset}`,
});

/**
 * Prints a stylized section banner.
 *
 * @param {string} title
 */
function printBanner(title) {
  const line = '═'.repeat(Math.max(60, title.length + 6));
  console.log(`\n${COLORS.cyan}${line}${COLORS.reset}`);
  console.log(`  ${COLORS.bold}${title}${COLORS.reset}`);
  console.log(`${COLORS.cyan}${line}${COLORS.reset}\n`);
}

/**
 * Prints a structured step feedback line conforming to GUARD-FBK-001.
 *
 * @param {'PASS'|'WARN'|'BLOCK'|'INFO'|'SKIP'} status
 * @param {string} stepId
 * @param {string} message
 */
function printStep(status, stepId, message) {
  const label = STATUS_LABELS[status] || status;
  const idStr = stepId ? `[${stepId}] ` : '';
  console.log(`  ${label}  ${COLORS.bold}${idStr}${COLORS.reset}${message}`);
}

/**
 * Prints an aligned key-value metric line.
 *
 * @param {string} key
 * @param {string|number} value
 * @param {number} [keyWidth=30]
 */
function printMetric(key, value, keyWidth = 30) {
  const paddedKey = (key + ' ').padEnd(keyWidth, '.');
  console.log(`  • ${paddedKey}: ${COLORS.bold}${value}${COLORS.reset}`);
}

/**
 * Exits the current process with standard gate exit code based on condition.
 *
 * @param {boolean} isPassing
 * @param {string} [failureMessage]
 */
function exitGate(isPassing, failureMessage) {
  if (!isPassing) {
    if (failureMessage) {
      console.error(`\n${STATUS_LABELS.BLOCK}  ${failureMessage}\n`);
    }
    process.exit(1);
  }
  process.exit(0);
}

module.exports = {
  COLORS,
  STATUS_LABELS,
  printBanner,
  printStep,
  printMetric,
  exitGate,
};
