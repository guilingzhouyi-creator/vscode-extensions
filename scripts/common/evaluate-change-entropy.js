/**
 * Module: Workspace Governance — Change Shannon Entropy & Diffusion Evaluator
 * File Path: scripts/common/evaluate-change-entropy.js
 * Architecture Role: Evaluates Hassan (ICSE 2009) Change Shannon Entropy H(C) and Kamei (IEEE TSE 2013)
 *   Just-In-Time diffusion metrics (NF, ND, NS) across Git change sets to prevent chaotic,
 *   cross-domain code dispersal and enforce cohesive atomic commits.
 * Dependencies & Triggers: Node.js standard libraries (path, child_process);
 *   invoked by pre-push-gate (ps1/sh) as the CHANGE-ENTROPY step; optional compiled changeset miner
 *   from auto-refactor/dist when present, degrading to git numstat parsing otherwise.
 * Responsibilities:
 *   1. Parse numstat outputs from git diff into file change distributions;
 *   2. Compute discrete Shannon entropy H(C) and normalized entropy H_hat(C) in [0.0, 1.0];
 *   3. Extract Kamei diffusion vectors: Files (NF), Directories (ND), and Subsystems (NS);
 *   4. Flag high-entropy cross-subsystem modifications (GUARD-ENT-001) that exceed cognitive budgets;
 *   5. Output structured JSON for agent and tooling consumption.
 * Exit Semantics & Design Rationale: 0 = PASS, 1 = FAIL when --fail-on-diffusion is set and violated.
 */
'use strict';

const path = require('path');
const { execSync } = require('child_process');

let compiledMiner = null;
try {
    compiledMiner = require(path.join(__dirname, '../../auto-refactor/dist/core/evolution/git-changeset-miner'));
} catch {
    compiledMiner = null;
}

const ENTROPY_RULE_ID = 'GUARD-ENT-001';
const DEFAULT_MAX_DIFFUSION_ENTROPY = 0.85;
const DEFAULT_MIN_FILES_FOR_ENTROPY_CHECK = 8;
const DEFAULT_MIN_SUBSYSTEMS_FOR_DIFFUSION = 2;

/**
 * Known top-level project subsystems in the monorepo.
 */
const KNOWN_SUBSYSTEMS = Object.freeze([
    'auto-refactor',
    'workspace-timing',
    'WebGames',
    'fractal-git',
    'scripts',
    'docs',
    '.agents',
]);

/**
 * Extracts the top-level subsystem identifier from a repository-relative path.
 *
 * @param {string} relPath - Relative file path.
 * @returns {string} Subsystem identifier.
 */
function resolveSubsystem(relPath) {
    const normalized = relPath.replace(/\\/g, '/');
    for (let i = 0; i < KNOWN_SUBSYSTEMS.length; i++) {
        const sub = KNOWN_SUBSYSTEMS[i];
        if (normalized === sub || normalized.startsWith(sub + '/')) {
            return sub;
        }
    }
    const firstSlash = normalized.indexOf('/');
    return firstSlash === -1 ? 'root' : normalized.slice(0, firstSlash);
}

/**
 * Parses a single numstat line into structured file change metrics.
 *
 * @param {string} line - Single raw line from `git diff --numstat`.
 * @returns {{ filePath: string, added: number, deleted: number, total: number } | null}
 */
function parseNumstatLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(/\t+/);
    if (parts.length < 3) return null;

    const addedRaw = parts[0];
    const deletedRaw = parts[1];
    const filePath = parts.slice(2).join('\t').trim();

    if (addedRaw === '-' || deletedRaw === '-') {
        return null; // Skip binary files
    }

    const added = parseInt(addedRaw, 10) || 0;
    const deleted = parseInt(deletedRaw, 10) || 0;
    const total = added + deleted;

    return { filePath, added, deleted, total };
}

/**
 * Computes Hassan (ICSE 2009) Change Shannon Entropy and Kamei JIT diffusion metrics.
 *
 * @param {Array<{ filePath: string, added: number, deleted: number, total: number }>} fileChanges
 * @returns {object} Formatted ChangeEntropyMetrics result.
 */
function computeChangeEntropyFromRecords(fileChanges) {
    if (compiledMiner && typeof compiledMiner.computeChangeEntropy === 'function') {
        return compiledMiner.computeChangeEntropy(fileChanges);
    }
    const fileCount = fileChanges.length;
    if (fileCount <= 1) {
        return {
            fileCount,
            totalChangedLoc: fileCount === 1 ? fileChanges[0].total : 0,
            entropy: 0.0,
            normalizedEntropy: 0.0,
            subsystemsCount: fileCount,
            directoriesCount: fileCount,
            isDiffused: false,
            subsystems: fileCount === 1 ? [resolveSubsystem(fileChanges[0].filePath)] : [],
        };
    }

    let sumDelta = 0;
    const dirSet = new Set();
    const subSet = new Set();

    for (let i = 0; i < fileCount; i++) {
        const item = fileChanges[i];
        sumDelta += item.total;
        dirSet.add(path.dirname(item.filePath).replace(/\\/g, '/'));
        subSet.add(resolveSubsystem(item.filePath));
    }

    if (sumDelta === 0) {
        return {
            fileCount,
            totalChangedLoc: 0,
            entropy: 0.0,
            normalizedEntropy: 0.0,
            subsystemsCount: subSet.size,
            directoriesCount: dirSet.size,
            isDiffused: false,
            subsystems: Array.from(subSet).sort(),
        };
    }

    // Shannon Entropy: H(C) = -∑ p_k * log2(p_k)
    let rawEntropy = 0.0;
    for (let i = 0; i < fileCount; i++) {
        const item = fileChanges[i];
        if (item.total > 0) {
            const p = item.total / sumDelta;
            rawEntropy -= p * (Math.log(p) / Math.LN2);
        }
    }

    const maxTheoreticalEntropy = Math.log(fileCount) / Math.LN2;
    const normalizedEntropy = maxTheoreticalEntropy > 0
        ? Math.min(1.0, rawEntropy / maxTheoreticalEntropy)
        : 0.0;

    const isDiffused =
        fileCount >= DEFAULT_MIN_FILES_FOR_ENTROPY_CHECK &&
        normalizedEntropy > DEFAULT_MAX_DIFFUSION_ENTROPY &&
        subSet.size >= DEFAULT_MIN_SUBSYSTEMS_FOR_DIFFUSION;

    let recommendation;
    if (isDiffused) {
        recommendation =
            `High Change Shannon Entropy (H_hat=${normalizedEntropy.toFixed(3)} > ${DEFAULT_MAX_DIFFUSION_ENTROPY}) ` +
            `spread across ${fileCount} files in ${subSet.size} subsystems. ` +
            `Consider decomposing this patch into atomic, domain-scoped commits.`;
    }

    return {
        fileCount,
        totalChangedLoc: sumDelta,
        entropy: +rawEntropy.toFixed(4),
        normalizedEntropy: +normalizedEntropy.toFixed(4),
        subsystemsCount: subSet.size,
        directoriesCount: dirSet.size,
        isDiffused,
        subsystems: Array.from(subSet).sort(),
        recommendation,
    };
}

/**
 * Evaluates raw numstat string content into full change entropy metrics.
 *
 * @param {string} numstatText - Complete stdout of `git diff --numstat`.
 * @returns {object} Formatted ChangeEntropyMetrics result.
 */
function evaluateChangeEntropy(numstatText) {
    if (compiledMiner && typeof compiledMiner.evaluateChangeEntropy === 'function') {
        return compiledMiner.evaluateChangeEntropy(numstatText);
    }
    const lines = numstatText.split(/\r?\n/);
    const records = [];

    for (let i = 0; i < lines.length; i++) {
        const parsed = parseNumstatLine(lines[i]);
        if (parsed) {
            records.push(parsed);
        }
    }

    return computeChangeEntropyFromRecords(records);
}

/**
 * Retrieves git diff numstat text safely.
 *
 * @param {boolean} isStaged - Whether to inspect cached/staged diff.
 * @param {string} [commitRange] - Optional revision range.
 * @returns {string} Git diff numstat output.
 */
function getGitNumstat(isStaged, commitRange) {
    try {
        let cmd = 'git diff --numstat';
        if (isStaged) {
            cmd += ' --cached';
        } else if (commitRange) {
            cmd += ` ${commitRange}`;
        }
        return execSync(cmd, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 10 * 1024 * 1024,
        });
    } catch {
        return '';
    }
}

/**
 * CLI execution entry point.
 */
function main() {
    const args = process.argv.slice(2);
    const isStaged = args.includes('--staged');
    const isJson = args.includes('--json') || args.includes('--agent');
    const failOnDiffusion = args.includes('--fail-on-diffusion');

    let commitRange;
    const rangeIdx = args.indexOf('--range');
    if (rangeIdx !== -1 && rangeIdx + 1 < args.length) {
        commitRange = args[rangeIdx + 1];
    }

    const numstat = getGitNumstat(isStaged, commitRange);
    const result = evaluateChangeEntropy(numstat);

    if (isJson) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log('=== [Hassan ICSE 2009] Change Shannon Entropy & Diffusion Evaluation ===');
        console.log(`Files Touched (NF)    : ${result.fileCount}`);
        console.log(`Directories (ND)      : ${result.directoriesCount}`);
        console.log(`Subsystems (NS)       : ${result.subsystemsCount} [${result.subsystems.join(', ')}]`);
        console.log(`Total Changed LOC     : ${result.totalChangedLoc}`);
        console.log(`Shannon Entropy H(C)  : ${result.entropy}`);
        console.log(`Normalized Entropy    : ${(result.normalizedEntropy * 100).toFixed(1)}%`);
        console.log(`Diffusion Status      : ${result.isDiffused ? '⚠️ HIGH DISPERSION' : '✔ COHESIVE'}`);
        if (result.recommendation) {
            console.log(`Guidance              : ${result.recommendation}`);
        }
    }

    if (failOnDiffusion && result.isDiffused) {
        process.exit(1);
    }
    process.exit(0);
}

if (require.main === module) {
    main();
}

module.exports = {
    ENTROPY_RULE_ID,
    DEFAULT_MAX_DIFFUSION_ENTROPY,
    resolveSubsystem,
    parseNumstatLine,
    computeChangeEntropyFromRecords,
    evaluateChangeEntropy,
};
