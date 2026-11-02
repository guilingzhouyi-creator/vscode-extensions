/**
 * Module: Tooling / Cryptographic Audit Hash Chain Engine
 * File Path: scripts/common/lib/audit-hash-chain.js
 * Architecture Role: Tamper-evident Merkle hash chain calculator and verifier for gate telemetry ledgers
 * Dependencies & Triggers: Consumed by gate-telemetry-logger.js, pre-push-gate, and CLI audits
 * Responsibilities:
 *   1. Calculate sequential hash signatures using hardware-accelerated OpenSSL SM3 (or SHA-256 fallback);
 *   2. Link current record to previous record's hash signature (Merkle chain);
 *   3. Provide full ledger chain integrity verification and detect broken links or modified entries.
 * Exit Semantics & Design Rationale: Pure cryptographic verification utility.
 *   Extracted from gate-telemetry-logger.js to comply with single-file differential envelope bounds
 *   and provide a single point of truth for Chinese commercial cryptographic SM3 hashing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UTF8 = 'utf8';
const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Computes hash over payload using native SM3 if available, else SHA-256.
 *
 * @param {string} text - Canonical string payload
 * @returns {{ hash: string, algo: string }}
 */
function computeAuditHash(text) {
  const algo = crypto.getHashes().includes('sm3') ? 'sm3' : 'sha256';
  const hash = crypto.createHash(algo).update(text, UTF8).digest('hex');
  return { hash, algo };
}

/**
 * Reads the latest history entry to obtain previous hash and sequence number.
 *
 * @param {string} ledgerPath - Path to jsonl file
 * @returns {{ prev_hash: string, seq: number }}
 */
function readLatestHistoryLink(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) {
    return { prev_hash: GENESIS_PREV_HASH, seq: 0 };
  }
  try {
    const raw = fs.readFileSync(ledgerPath, UTF8);
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      return { prev_hash: GENESIS_PREV_HASH, seq: 0 };
    }
    const lastLine = lines[lines.length - 1];
    const parsed = JSON.parse(lastLine);
    const prev_hash =
      typeof parsed.entry_hash === 'string' && parsed.entry_hash.length === 64
        ? parsed.entry_hash
        : GENESIS_PREV_HASH;
    const seq = Number.isInteger(parsed.seq) ? parsed.seq : lines.length;
    return { prev_hash, seq };
  } catch {
    return { prev_hash: GENESIS_PREV_HASH, seq: 0 };
  }
}

/**
 * Verifies cryptographic integrity of a gate history jsonl ledger.
 *
 * @param {string} historyPath - Path to history jsonl ledger
 * @returns {{ valid: boolean, totalEntries: number, error?: string, brokenLine?: number }}
 */
function verifyHistoryChainFile(historyPath) {
  if (!fs.existsSync(historyPath)) {
    return { valid: true, totalEntries: 0 };
  }
  try {
    const raw = fs.readFileSync(historyPath, UTF8);
    const lines = raw.split(/\r?\n/).filter(Boolean);
    let expectedPrevHash = null;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const parsed = JSON.parse(lines[i]);
      if (typeof parsed !== 'object' || !parsed) {
        return { valid: false, brokenLine: lineNum, error: 'Malformed JSON line' };
      }

      if (parsed.entry_hash) {
        if (expectedPrevHash !== null && parsed.prev_hash && parsed.prev_hash !== expectedPrevHash) {
          return {
            valid: false,
            brokenLine: lineNum,
            error: `Hash chain link broken: expected prev_hash ${expectedPrevHash}, got ${parsed.prev_hash}`,
          };
        }
        const algo = parsed.algo || (crypto.getHashes().includes('sm3') ? 'sm3' : 'sha256');
        const restPayload = {
          ts: parsed.ts,
          rev: parsed.rev,
          gate: parsed.gate,
          status: parsed.status,
          ms: parsed.ms,
          files: parsed.files,
          passed: parsed.passed,
          failed: parsed.failed,
          skipped: parsed.skipped,
        };
        const canonical = `${parsed.prev_hash || GENESIS_PREV_HASH}:${parsed.seq || lineNum}:${JSON.stringify(restPayload)}`;
        const recomputed = crypto.createHash(algo).update(canonical, UTF8).digest('hex');
        if (recomputed !== parsed.entry_hash) {
          return {
            valid: false,
            brokenLine: lineNum,
            error: `Entry hash mismatch at line ${lineNum}: expected ${parsed.entry_hash}, computed ${recomputed}`,
          };
        }
        expectedPrevHash = parsed.entry_hash;
      }
    }
    return { valid: true, totalEntries: lines.length };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = Object.freeze({
  GENESIS_PREV_HASH,
  computeAuditHash,
  readLatestHistoryLink,
  verifyHistoryChainFile,
});
