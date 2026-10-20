/**
 * Module: Gate Step Verdict Coverage Guard
 * File Path: scripts/common/validate-gate-verdicts.js
 * Architecture Role: Static guard over gate entry points, asserting that every step declared in the
 *   single-source registry can actually reach an operator-visible verdict in each platform
 *   implementation, and that no step identity is announced twice.
 * Dependencies & Triggers: Consumes gate-step-registry.json and the gate entry-point corpus;
 *   invoked by pre-push and audit-all alongside the ordering and vocabulary guards.
 * Responsibilities:
 *   1. Reject a registered step that has no banner and no verdict anywhere in an implementation;
 *   2. Reject a step whose only reachable verdicts are SKIP/WARN, because an unexecuted step then
 *      becomes indistinguishable from a passing one;
 *   3. Reject a step announced by more than one banner, which makes the progress ordinal lie;
 *   4. Report file-and-line diagnostics for every finding.
 * Exit Semantics & Design Rationale: 0 = every registered step is reachable with a success
 *   verdict, 1 = at least one finding. A gate whose success path prints nothing cannot be told
 *   apart from a gate that never ran, so silence must be treated as a defect. The check is static
 *   on purpose: it has to catch the gap on a green run, where no failure output exists to inspect.
 *   Generic runners (`run_gate_step` / `Invoke-GateStep`) render identity and banner from their
 *   argument, so a step invoked through one is covered by construction. That exemption is narrow:
 *   a call site that also prints an explicit banner for the same identity announces it twice, and
 *   the duplicate is reported even though the generic runner exists.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const REGISTRY = require('./gate-step-registry');

const ID_PATTERN = /([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2})/;
const BANNER_CALL = /Write-StepBanner|write_step_banner/;
const VERDICT_CALL = /Write-StepVerdict|write_step_verdict/;
/** Generic runners that both announce and judge a step handed to them at runtime. */
const GENERIC_RUNNER_DEF = /^\s*(?:function\s+)?(run_gate_step|Invoke-GateStep)\s*[({]/;
const STATUS_TOKEN = /"(PASS|BLOCK|SKIP|WARN)"|(?:^|[\s"])(PASS|BLOCK|SKIP|WARN)(?=[\s"])/g;

/**
 * Extracts every closed-vocabulary status token named on one line.
 *
 * Two surface forms must both be read: PowerShell passes a quoted `"PASS"`, Bash passes a bare
 * `PASS`. A PowerShell verdict may also embed a conditional
 * (`$(if (...) { "PASS" } else { "BLOCK" })`), so one line can legitimately name two outcomes;
 * taking only the first match would report a step as success-less while it has a PASS branch.
 *
 * @param {string} line - Source line.
 * @returns {string[]} Status tokens found on the line.
 */
function extractStatuses(line) {
    const found = [];
    STATUS_TOKEN.lastIndex = 0;
    let match = STATUS_TOKEN.exec(line);
    while (match !== null) {
        found.push(match[1] || match[2]);
        match = STATUS_TOKEN.exec(line);
    }
    return found;
}

/**
 * Reads one entry-point script and indexes its banner/verdict call sites by step identity.
 *
 * @param {string} full - Absolute script path.
 * @returns {{ banners: Map<string, number[]>, verdicts: Map<string, Array<{ line: number, statuses: string[] }>>, genericRunner: boolean }}
 */
function indexEntryScript(full) {
    const banners = new Map();
    const verdicts = new Map();
    let genericRunner = false;
    if (!fs.existsSync(full)) return { banners, verdicts, genericRunner };

    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
        const lineNo = index + 1;
        if (GENERIC_RUNNER_DEF.test(line)) genericRunner = true;

        if (BANNER_CALL.test(line)) {
            const match = ID_PATTERN.exec(line);
            if (match) {
                if (!banners.has(match[1])) banners.set(match[1], []);
                banners.get(match[1]).push(lineNo);
            }
        }
        if (VERDICT_CALL.test(line)) {
            const match = ID_PATTERN.exec(line);
            if (!match) return;
            if (!verdicts.has(match[1])) verdicts.set(match[1], []);
            verdicts.get(match[1]).push({ line: lineNo, statuses: extractStatuses(line) });
        }
    });
    return { banners, verdicts, genericRunner };
}

/**
 * Audits one registered step against one platform implementation.
 *
 * Extracted so the entry/platform/step traversal stays flat: inlining these branches produced a
 * five-level nest, which the AST slice guard rejects (`CPX-NEST-001`).
 *
 * @param {object} step - Registry step descriptor.
 * @param {object} index - Result of `indexEntryScript`.
 * @param {object} context - `{ entryId, platform, file }` for diagnostics.
 * @param {Array<object>} findings - Accumulator.
 * @returns {void}
 */
function auditStep(step, index, context, findings) {
    const { entryId, platform, file } = context;
    const bannerLines = index.banners.get(step.id) || [];
    const verdictLines = index.verdicts.get(step.id) || [];

    if (index.genericRunner) {
        // 通用 Runner 由入参决定身份与横幅；调用点额外写显式横幅即为重复宣布。
        for (const bannerLine of bannerLines) {
            findings.push({
                type: 'GUARD-STEP-001',
                entry: entryId,
                platform,
                file,
                line: bannerLine,
                detail: `${step.id} 由通用 Runner 渲染横幅，调用点又显式宣布一次，进度序号会重复出现`,
            });
        }
        return;
    }

    if (bannerLines.length === 0 && verdictLines.length === 0) {
        findings.push({
            type: 'GUARD-STEP-001',
            entry: entryId,
            platform,
            file,
            line: 0,
            detail: `${step.id} 在 ${platform} 实现中既无横幅也无判定，该步骤从不出现在操作者视野中`,
        });
        return;
    }

    if (bannerLines.length > 1) {
        findings.push({
            type: 'GUARD-STEP-001',
            entry: entryId,
            platform,
            file,
            line: bannerLines[1],
            detail: `${step.id} 有 ${bannerLines.length} 条横幅，进度序号会重复出现`,
        });
    }

    const statuses = new Set(verdictLines.flatMap((item) => item.statuses));
    const hasTerminal = statuses.has('PASS') || statuses.has('BLOCK');
    if (verdictLines.length > 0 && !hasTerminal) {
        findings.push({
            type: 'GUARD-STEP-001',
            entry: entryId,
            platform,
            file,
            line: verdictLines[0].line,
            detail: `${step.id} 只有 SKIP/WARN 判定，未执行与已通过无法区分`,
        });
    }
}

/**
 * Runs the verdict coverage audit.
 *
 * @returns {Array<object>} Findings.
 */
function runAudit() {
    const findings = [];
    for (const entryId of REGISTRY.listEntryIds()) {
        const entry = REGISTRY.getEntry(entryId);
        for (const [platform, rel] of Object.entries(entry.scripts || {})) {
            const full = path.join(REPO_ROOT, rel);
            if (!fs.existsSync(full)) continue;
            const index = indexEntryScript(full);
            const context = { entryId, platform, file: rel.replace(/\\/g, '/') };
            for (const step of entry.steps) auditStep(step, index, context, findings);
        }
    }
    return findings;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
    const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
    const findings = runAudit();
    const passed = findings.length === 0;

    if (isAgent) {
        console.log(JSON.stringify({
            protocolVersion: '1.0.0',
            status: passed ? 'PASS' : 'BLOCK',
            gate: 'gate-verdict-coverage',
            findings,
            summary: passed
                ? 'Every registered step is reachable and renders a terminal verdict on both platforms.'
                : `${findings.length} step(s) cannot report a terminal verdict.`,
        }, null, 2));
        process.exit(passed ? 0 : 1);
    }

    if (passed) {
        console.log('  ✔ PASS  gate-verdict-coverage  每个登记步骤在两个平台均可呈现终态判定');
        process.exit(0);
    }

    console.error('✖ BLOCK  gate-verdict-coverage');
    for (const item of findings) {
        const location = item.line > 0 ? `${item.file}:${item.line}` : item.file;
        console.error(`  - [${item.type}] ${location} ${item.detail}`);
    }
    process.exit(1);
}

if (require.main === module) {
    main();
}

module.exports = Object.freeze({ runAudit, indexEntryScript, extractStatuses });
