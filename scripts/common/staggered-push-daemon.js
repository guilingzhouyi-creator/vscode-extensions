/**
 * Module: Staggered Push Background Daemon
 * File Path: scripts/common/staggered-push-daemon.js
 * Architecture Role: Persistent workspace daemon polling UTC time to execute daily
 *   staggered Git pushes when the UTC time reaches 13:30 (equivalent to 21:30 CST)
 *   and the current UTC day is unpushed.
 * Dependencies & Triggers: Launched automatically by .vscode/tasks.json on folderOpen;
 *   imports execution engine from scripts/common/staggered-push-orchestrator.js.
 * Responsibilities:
 *   1. Passively inspect UTC time at regular intervals (POLL_INTERVAL_MS);
 *   2. Determine whether the current time has reached the target window (>= 13:30 UTC);
 *   3. Enforce daily idempotence using hasPushedToday;
 *   4. Execute push batch and emit formatted heartbeat and outcome logs;
 *   5. Listen for termination signals (SIGINT, SIGTERM) to exit cleanly on VSCode close.
 * Exit Semantics & Design Rationale: Non-blocking event loop with minimal CPU footprint;
 *   exits with code 0 on termination signals. Objective UTC-based scheduling ensures immunity
 *   to local OS timezone shifts and proxy cascades.
 *
 * @module staggered-push-daemon
 */

'use strict';

const {
  executeStaggeredPush,
  hasPushedToday,
  getUtcDateString,
  getLocalDateString,
  getStaggeredPushStatus,
} = require('./staggered-push-orchestrator');

// Timing constants (Objective UTC standard: 13:30 UTC = 21:30 CST / 05:30 PST / 06:30 PDT)
const TARGET_UTC_HOUR = 13;
const TARGET_UTC_MINUTE = 30;
const POLL_INTERVAL_MS = 30000; // 30 seconds
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes backoff cooldown on failure

let lastFailureEpoch = 0;

/**
 * Checks whether the current time falls within or after the daily scheduled trigger window (in UTC).
 *
 * @param {Date} [d=new Date()] - Date object to evaluate.
 * @returns {boolean} True if within or after 13:30 UTC.
 */
function isWindowActive(d = new Date()) {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return h > TARGET_UTC_HOUR || (h === TARGET_UTC_HOUR && m >= TARGET_UTC_MINUTE);
}

/**
 * Performs a single check tick. If within window and unpushed, triggers push.
 *
 * @returns {object|null} Outcome object or null if skipped.
 */
function checkAndRunTick() {
  const now = new Date();
  const todayStr = getUtcDateString(now);

  if (!isWindowActive(now)) {
    return null;
  }

  if (hasPushedToday(todayStr)) {
    return null;
  }

  // Failure backoff protection: avoid rapid spin if offline or proxy is temporarily down
  if (lastFailureEpoch > 0 && Date.now() - lastFailureEpoch < FAILURE_COOLDOWN_MS) {
    return null;
  }

  console.log(`[${now.toISOString()}] Target window active (13:30+ UTC / 21:30 CST), executing staggered push...`);
  const outcome = executeStaggeredPush();

  if (outcome.status === 'PASS') {
    lastFailureEpoch = 0;
    console.log(`✔ [STAGGERED-PUSH] ${outcome.summary}`);
    if (outcome.commits && outcome.commits.length > 0) {
      outcome.commits.forEach((c) => console.log(`   - ${c}`));
    }
  } else if (outcome.status === 'SKIP') {
    lastFailureEpoch = 0;
    console.log(`⚡ [SKIP] ${outcome.summary}`);
  } else if (outcome.status === 'IDLE') {
    lastFailureEpoch = 0;
    console.log(`✔ [IDLE] ${outcome.summary}`);
  } else {
    lastFailureEpoch = Date.now();
    console.error(`✖ [BLOCK] ${outcome.summary} (cooling down 5m before retry)`);
  }

  return outcome;
}

/**
 * Main daemon startup routine.
 */
function startDaemon() {
  const startMsg = `[${new Date().toISOString()}] Staggered Push Daemon started (target: 13:30 UTC / 21:30 CST daily).`;
  console.log(startMsg);

  // Initial check on startup (in case VSCode was opened after 13:30 UTC today)
  checkAndRunTick();

  // Periodic polling interval
  const timer = setInterval(() => {
    checkAndRunTick();
  }, POLL_INTERVAL_MS);

  // Graceful shutdown handlers
  const shutdown = () => {
    clearInterval(timer);
    console.log(`[${new Date().toISOString()}] Staggered Push Daemon stopping.`);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--status') || args.includes('-s')) {
    if (typeof getStaggeredPushStatus === 'function') {
      const statusObj = getStaggeredPushStatus();
      if (args.includes('--json')) {
        process.stdout.write(JSON.stringify(statusObj, null, 2) + '\n');
      } else {
        console.log('=== Staggered Push Daemon Objective Status ===');
        console.log(`Current Time (UTC): ${statusObj.currentTimeUtc}`);
        console.log(`Today Date (UTC):   ${statusObj.todayUtcDate}`);
        console.log(`Target Window:      ${statusObj.targetUtcWindow}`);
        console.log(`Window Active:      ${statusObj.isWindowActive ? 'YES (Window Open)' : 'NO (Waiting)'}`);
        console.log(`Pushed Today (UTC): ${statusObj.hasPushedToday ? 'YES (Completed)' : 'NO (Pending)'}`);
        console.log(`Backlog Commits:    ${statusObj.backlogCount >= 0 ? statusObj.backlogCount : 'Unknown'}`);
      }
    }
    process.exit(0);
  }
  startDaemon();
}

module.exports = {
  isWindowActive,
  checkAndRunTick,
  TARGET_HOUR: TARGET_UTC_HOUR,
  TARGET_MINUTE: TARGET_UTC_MINUTE,
  TARGET_UTC_HOUR,
  TARGET_UTC_MINUTE,
  POLL_INTERVAL_MS,
  FAILURE_COOLDOWN_MS,
};
