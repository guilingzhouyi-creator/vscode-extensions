/**
 * Module: CLI — Automated Codemod Repair & MCTS Conflict Planner
 * File Path: src/cli/fix-cmd.ts
 * Architecture Role: Orchestrates `--fix` and `--fix-dry-run` automated AST codemod repairs,
 *   invoking MctsExplorer when multi-rule patch candidates overlap on a file and persisting
 *   objective pre/post quality score and line-delta trajectories.
 * Dependencies & Triggers: Consumes ../api (scan), ../core/codemod, ../core/praxis/mcts,
 *   ../core/trajectory, and ../core/intelligence/elastic-debt-budget; invoked by src/index.ts.
 * Responsibilities:
 *   1. Group actionable scan findings into per-file FixDescriptor lists.
 *   2. Detect overlapping patch conflicts via dry-run probe and rank conflict-free rule orders
 *      through MctsExplorer.
 *   3. Apply codemod patches asynchronously and measure changed/semantic line deltas.
 *   4. Persist truthful pre/post composite scores and weighted debt deltas to trajectory ledger.
 * Exit Semantics & Design Rationale: Strictly asynchronous filesystem I/O (zero *Sync calls);
 *   never fabricates synthetic baseline scores when trajectory directory or post-scan score is
 *   unavailable.
 */

import * as fs from 'fs';
import * as path from 'path';
import { scan, type ScanReport } from '../api';
import type { CliOptions } from './cli-parser';
import { defaultPatchEngine, PatchEngine, type FixDescriptor } from '../core/codemod';
import { MctsExplorer } from '../core/praxis/mcts/mcts-explorer';
import type { CandidateStrategy } from '../core/praxis/mcts/mcts-contracts';
import { TrajectoryAccumulator, recordToVector } from '../core/trajectory';
import { buildDebtLedger } from '../core/intelligence/elastic-debt-budget';
import { sha256Hex } from '../core/cache-key';

const ENCODING_UTF8 = 'utf8';
const LOG_LEVEL_SILENT = 'silent';
const SEVERITY_ERROR = 'error';
const TRAJECTORY_DIR_NAME = '.refactor-trajectory';
const MODE_DRY_RUN = 'DRY-RUN';
const MODE_IN_PLACE = 'IN-PLACE';
const DEFAULT_AGENT_REVISION = 'codemod';
const DEFAULT_AGENT_NAME = 'codemod-fix';
const RULE_STRATEGY_PREFIX = 'rule-';
const REVISION_ID_DISPLAY_LENGTH = 8;
const MIN_COMPETING_STRATEGIES = 2;
const DEBT_WEIGHT_CRITICAL = 10;
const DEBT_WEIGHT_HIGH = 3;
const DEBT_WEIGHT_MEDIUM = 1;

interface CodemodChangeMetrics {
    changedLines: number;
    semanticLines: number;
    modifiedFiles: number;
}

interface PreFixSnapshot {
    readonly relPath: string;
    readonly fullPath: string;
    readonly content: string;
    readonly sha256: string;
}

interface CodemodTrajectoryInput {
    readonly rootDir: string;
    readonly fixesByFile: ReadonlyMap<string, readonly FixDescriptor[]>;
    readonly totalApplied: number;
    readonly cli: CliOptions;
    readonly beforeReport: ScanReport;
    readonly postReport: ScanReport;
    readonly changeMetrics: CodemodChangeMetrics;
}

async function pathExistsAsync(targetPath: string): Promise<boolean> {
    try {
        await fs.promises.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

function getOrCreateFixList(
    fixesByFile: Map<string, FixDescriptor[]>,
    key: string,
): FixDescriptor[] {
    let existing = fixesByFile.get(key);
    if (!existing) {
        existing = [];
        fixesByFile.set(key, existing);
    }
    return existing;
}

function isCommentOrBlankLine(trimmedLine: string): boolean {
    return (
        trimmedLine.length === 0 ||
        trimmedLine.startsWith('//') ||
        trimmedLine.startsWith('/*') ||
        trimmedLine.startsWith('*') ||
        trimmedLine.startsWith('#')
    );
}

function countChangedAndSemanticLines(
    beforeText: string,
    afterText: string,
): { changed: number; semantic: number } {
    const beforeLines = beforeText.split('\n');
    const afterLines = afterText.split('\n');
    const maxLen = Math.max(beforeLines.length, afterLines.length);
    let changed = 0;
    let semantic = 0;
    for (let index = 0; index < maxLen; index++) {
        const prevLine = (beforeLines[index] ?? '').trim();
        const nextLine = (afterLines[index] ?? '').trim();
        if (prevLine === nextLine) continue;
        changed += 1;
        const activeLine = nextLine.length > 0 ? nextLine : prevLine;
        if (!isCommentOrBlankLine(activeLine)) {
            semantic += 1;
        }
    }
    return { changed, semantic };
}

function groupFixesByRuleId(fixes: readonly FixDescriptor[]): Map<string, FixDescriptor[]> {
    const grouped = new Map<string, FixDescriptor[]>();
    for (const fixItem of fixes) {
        getOrCreateFixList(grouped, fixItem.ruleId).push(fixItem);
    }
    return grouped;
}

function buildRuleCandidateStrategy(
    ruleId: string,
    ruleSubset: readonly FixDescriptor[],
    fileContext: { relPath: string; fullPath: string; content: string; fixRules?: string[] },
): CandidateStrategy | undefined {
    const preview = defaultPatchEngine.applyFixes(
        fileContext.fullPath,
        fileContext.content,
        ruleSubset,
        {
            dryRun: true,
            rules: fileContext.fixRules,
        },
    );
    if (preview.appliedFixCount === 0) return undefined;
    const fileModifications = new Map<string, string>();
    fileModifications.set(fileContext.relPath, preview.patchedContent);
    return {
        strategyId: `${RULE_STRATEGY_PREFIX}${ruleId}`,
        label: `Apply ${ruleId} fixes on ${fileContext.relPath}`,
        fileModifications,
    };
}

async function selectConflictFreeFixesViaMcts(
    fileContext: { relPath: string; fullPath: string; content: string },
    fixes: readonly FixDescriptor[],
    cli: CliOptions,
): Promise<readonly FixDescriptor[]> {
    const fixesByRule = groupFixesByRuleId(fixes);
    if (fixesByRule.size < MIN_COMPETING_STRATEGIES) return fixes;

    const candidates: CandidateStrategy[] = [];
    const strategyContext = { ...fileContext, fixRules: cli.fixRules };
    for (const [ruleId, ruleSubset] of fixesByRule.entries()) {
        const candidate = buildRuleCandidateStrategy(ruleId, ruleSubset, strategyContext);
        if (candidate) candidates.push(candidate);
    }
    if (candidates.length < MIN_COMPETING_STRATEGIES) return fixes;

    const explorer = new MctsExplorer();
    const verdict = await explorer.explore(
        {
            cardId: `codemod-${Date.now()}`,
            cardType: 'refactor',
            cellId: 'cli-fix',
            agentUid: cli.agentUid || DEFAULT_AGENT_NAME,
        },
        candidates,
    );
    const topWinner = verdict.leaderboard[0];
    if (!topWinner) return fixes;
    const winningRule = topWinner.strategyId.slice(RULE_STRATEGY_PREFIX.length);
    const prioritized = fixes.filter((fixItem) => fixItem.ruleId === winningRule);
    const remaining = fixes.filter((fixItem) => fixItem.ruleId !== winningRule);
    return [...prioritized, ...remaining];
}

async function applyFixesToTargetFile(
    target: { relPath: string; fixes: readonly FixDescriptor[]; rootDir: string },
    cli: CliOptions,
    changeMetrics: CodemodChangeMetrics,
    snapshots: PreFixSnapshot[],
): Promise<{ applied: number; skipped: number }> {
    const fullPath = path.resolve(target.rootDir, target.relPath);
    if (!(await pathExistsAsync(fullPath))) {
        return { applied: 0, skipped: 0 };
    }

    const content = await fs.promises.readFile(fullPath, ENCODING_UTF8);
    const snapshotSha = sha256Hex(content);
    const dryProbe = defaultPatchEngine.applyFixes(fullPath, content, target.fixes, {
        dryRun: true,
        rules: cli.fixRules,
    });
    const orderedFixes =
        dryProbe.skippedConflictCount > 0
            ? await selectConflictFreeFixesViaMcts(
                  { relPath: target.relPath, fullPath, content },
                  target.fixes,
                  cli,
              )
            : target.fixes;

    if (!cli.fixDryRun) {
        const currentContent = await fs.promises.readFile(fullPath, ENCODING_UTF8);
        if (sha256Hex(currentContent) !== snapshotSha) {
            return { applied: 0, skipped: orderedFixes.length };
        }
    }

    const patchApplyResult = await defaultPatchEngine.applyFixesAsync(
        fullPath,
        content,
        orderedFixes,
        {
            dryRun: cli.fixDryRun,
            rules: cli.fixRules,
        },
    );
    if (patchApplyResult.appliedFixCount === 0) {
        return { applied: 0, skipped: 0 };
    }

    if (!cli.fixDryRun) {
        snapshots.push({
            relPath: target.relPath,
            fullPath,
            content,
            sha256: snapshotSha,
        });
    }
    const lineDelta = countChangedAndSemanticLines(content, patchApplyResult.patchedContent);
    changeMetrics.changedLines += lineDelta.changed;
    changeMetrics.semanticLines += lineDelta.semantic;
    changeMetrics.modifiedFiles += 1;
    if (patchApplyResult.unifiedDiff) {
        process.stdout.write(patchApplyResult.unifiedDiff + '\n');
    }
    return {
        applied: patchApplyResult.appliedFixCount,
        skipped: patchApplyResult.skippedConflictCount,
    };
}

function countWeightedDebtPoints(issues: readonly ScanReport['issues'][number][]): number {
    const { debtByTier } = buildDebtLedger(issues.filter((issueItem) => !issueItem.clusteredInto));
    return (
        debtByTier.critical * DEBT_WEIGHT_CRITICAL +
        debtByTier.high * DEBT_WEIGHT_HIGH +
        debtByTier.medium * DEBT_WEIGHT_MEDIUM
    );
}

async function readModifiedFilesSnapshot(
    rootDir: string,
    fixesByFile: ReadonlyMap<string, readonly FixDescriptor[]>,
): Promise<Array<{ filePath: string; content: string }>> {
    const modifiedFilesList: Array<{ filePath: string; content: string }> = [];
    for (const relPath of fixesByFile.keys()) {
        const fullPath = path.resolve(rootDir, relPath);
        if (await pathExistsAsync(fullPath)) {
            modifiedFilesList.push({
                filePath: relPath,
                content: await fs.promises.readFile(fullPath, ENCODING_UTF8),
            });
        }
    }
    return modifiedFilesList;
}

function countActiveErrorIssues(report: ScanReport): number {
    return report.issues.filter(
        (issueItem) => issueItem.severity === SEVERITY_ERROR && !issueItem.suppression,
    ).length;
}

async function verifyAndRollbackIfRegressed(
    cli: CliOptions,
    beforeReport: ScanReport,
    snapshots: readonly PreFixSnapshot[],
): Promise<{ postReport: ScanReport; rolledBack: boolean }> {
    const postReport = await scan({ ...cli, logLevel: LOG_LEVEL_SILENT });
    const beforeErrors = countActiveErrorIssues(beforeReport);
    const afterErrors = countActiveErrorIssues(postReport);
    if (afterErrors > beforeErrors && snapshots.length > 0) {
        for (const snap of snapshots) {
            await fs.promises.writeFile(snap.fullPath, snap.content, ENCODING_UTF8);
        }
        process.stderr.write(
            `[auto-refactor] Codemod introduced ${afterErrors - beforeErrors} new error(s); ` +
                `rolled back ${snapshots.length} file(s) to pre-fix snapshot.\n`,
        );
        return { postReport, rolledBack: true };
    }
    return { postReport, rolledBack: false };
}

async function recordCodemodTrajectory(input: CodemodTrajectoryInput): Promise<void> {
    const { rootDir, fixesByFile, totalApplied, cli, beforeReport, postReport, changeMetrics } =
        input;
    if (cli.fixDryRun || totalApplied === 0) return;
    try {
        const trajectoryDir = path.join(rootDir, TRAJECTORY_DIR_NAME);
        if (!(await pathExistsAsync(trajectoryDir))) return;

        const beforeScore = beforeReport.qualityScore?.compositeScore;
        const afterScore = postReport.qualityScore?.compositeScore;
        if (typeof beforeScore !== 'number' || typeof afterScore !== 'number') return;

        const beforeDebt = countWeightedDebtPoints(beforeReport.issues);
        const afterDebt = countWeightedDebtPoints(postReport.issues);
        const regressionCount = countActiveErrorIssues(postReport);
        const modifiedFilesList = await readModifiedFilesSnapshot(rootDir, fixesByFile);
        const maybeRevision = (cli as Record<string, unknown>).revision;
        const accumulator = new TrajectoryAccumulator(trajectoryDir, rootDir);
        await accumulator.recordAuditRun({
            runId: `fix-${Date.now()}`,
            revision: maybeRevision
                ? String(maybeRevision).slice(0, REVISION_ID_DISPLAY_LENGTH)
                : DEFAULT_AGENT_REVISION,
            module: path.basename(rootDir),
            agent: DEFAULT_AGENT_NAME,
            timestamp: Date.now(),
            scannedFiles: modifiedFilesList,
            beforeScore,
            afterScore,
            scoreVector: postReport.qualityScore?.indices
                ? recordToVector(postReport.qualityScore.indices)
                : undefined,
            resolvedDebtPoints: Math.max(0, beforeDebt - afterDebt),
            addedDebtPoints: Math.max(0, afterDebt - beforeDebt),
            regressionFindingsCount: regressionCount,
            diffCounters: {
                changed: changeMetrics.changedLines,
                semantic: changeMetrics.semanticLines,
                modified: changeMetrics.modifiedFiles,
            },
        });
    } catch (trajectoryErr: unknown) {
        if (cli.logLevel && cli.logLevel !== LOG_LEVEL_SILENT) {
            process.stderr.write(
                `[codemod] trajectory persistence skipped: ${String(trajectoryErr)}\n`,
            );
        }
    }
}

async function collectFixesByFile(
    rootDir: string,
    issues: readonly ScanReport['issues'][number][],
): Promise<Map<string, FixDescriptor[]>> {
    const fileIssuesByPath = new Map<string, ScanReport['issues'][number][]>();
    for (const issue of issues) {
        if (issue.clusteredInto) continue;
        let groupedIssues = fileIssuesByPath.get(issue.location.file);
        if (!groupedIssues) {
            groupedIssues = [];
            fileIssuesByPath.set(issue.location.file, groupedIssues);
        }
        groupedIssues.push(issue);
    }

    const fileFixesByPath = new Map<string, FixDescriptor[]>();
    for (const [relPath, fileIssues] of fileIssuesByPath.entries()) {
        const fullPath = path.resolve(rootDir, relPath);
        const sourceText = (await pathExistsAsync(fullPath))
            ? await fs.promises.readFile(fullPath, ENCODING_UTF8)
            : undefined;
        const fileFixes = PatchEngine.issuesToFixes(fileIssues, sourceText, fullPath);
        if (fileFixes.length > 0) {
            fileFixesByPath.set(relPath, fileFixes);
        }
    }
    return fileFixesByPath;
}

/**
 * Executes automated AST codemod repairs for actionable scan findings.
 * Concurrency: Requires external synchronization on target workspace files during in-place writes.
 *
 * @param cli - Parsed command-line options including fix and fixDryRun flags.
 * @returns Exit code 0 on successful repair completion.
 */
export async function handleFixWorkflow(cli: CliOptions): Promise<number> {
    const report = await scan(cli);
    const rootDir = cli.root || process.cwd();
    const fixesByFile = await collectFixesByFile(rootDir, report.issues);

    if (fixesByFile.size === 0) {
        process.stdout.write(
            '[auto-refactor] No automated codemod fixes available for detected issues.\n',
        );
        return 0;
    }

    let totalApplied = 0;
    let totalSkipped = 0;
    const changeMetrics: CodemodChangeMetrics = {
        changedLines: 0,
        semanticLines: 0,
        modifiedFiles: 0,
    };

    const snapshots: PreFixSnapshot[] = [];

    process.stdout.write(
        `\n=== Automated Codemod Repair (${cli.fixDryRun ? MODE_DRY_RUN : MODE_IN_PLACE}) ===\n`,
    );

    for (const [relPath, fixes] of fixesByFile.entries()) {
        const outcome = await applyFixesToTargetFile(
            { relPath, fixes, rootDir },
            cli,
            changeMetrics,
            snapshots,
        );
        totalApplied += outcome.applied;
        totalSkipped += outcome.skipped;
    }

    process.stdout.write(
        `[auto-refactor] Fix summary: ${totalApplied} applied, ` +
            `${totalSkipped} conflicts skipped across ${fixesByFile.size} files.\n\n`,
    );

    if (!cli.fixDryRun && totalApplied > 0) {
        const { postReport, rolledBack } = await verifyAndRollbackIfRegressed(
            cli,
            report,
            snapshots,
        );
        if (rolledBack) {
            return 1;
        }
        await recordCodemodTrajectory({
            rootDir,
            fixesByFile,
            totalApplied,
            cli,
            beforeReport: report,
            postReport,
            changeMetrics,
        });
    }

    return 0;
}
