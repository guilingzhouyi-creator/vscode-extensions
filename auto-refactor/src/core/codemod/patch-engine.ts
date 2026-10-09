/**
 * Module: Core Codemod — Patch Engine & Conflict Resolver
 * File Path: src/core/codemod/patch-engine.ts
 * Architecture Role: Orchestrates transform passes, resolves conflicts, and renders diffs.
 * Dependencies & Triggers: Consumed by CLI runner and API consumers when `--fix` is passed.
 * Responsibilities: Coordinate fix generation, filter by safety level, and execute atomic writes.
 * Exit Semantics & Design Rationale: Produces PatchApplyResult with unified diff; idempotent.
 */

import * as fs from 'fs';
import type { Issue } from '../types';
import { FormatPreserver } from './format-preserver';
import { TextEditApplier } from './text-edit-applier';
import type {
    CodemodOptions,
    FixDescriptor,
    PatchApplyResult,
    TextEdit,
    TransformContext,
} from './types';

/**
 * Single hunk in a unified diff representation.
 */
interface DiffHunk {
    readonly oldStart: number;
    readonly oldCount: number;
    readonly newStart: number;
    readonly newCount: number;
    readonly lines: readonly string[];
}

const syncFsWriteText = fs.writeFileSync.bind(fs);

/**
 * Low-level I/O barrier handling synchronized atomic writes and fallbacks.
 */
class PatchIoBarrier {
    public static writeSync(filePath: string, content: string): void {
        syncFsWriteText(filePath, content, 'utf8');
    }

    public static async writeAsync(filePath: string, content: string): Promise<void> {
        await fs.promises.writeFile(filePath, content, 'utf8');
    }
}

function tryRenameSync(source: string, destination: string): boolean {
    try {
        fs.renameSync(source, destination);
        return true;
    } catch {
        return false;
    }
}

function tryUnlinkSync(target: string): boolean {
    try {
        fs.unlinkSync(target);
        return true;
    } catch {
        return false;
    }
}

async function tryRenameAsync(source: string, destination: string): Promise<boolean> {
    try {
        await fs.promises.rename(source, destination);
        return true;
    } catch {
        return false;
    }
}

async function tryUnlinkAsync(target: string): Promise<boolean> {
    try {
        await fs.promises.unlink(target);
        return true;
    } catch {
        return false;
    }
}

/**
 * Synchronous atomic rename write with fallback.
 */
function writeAtomicSync(filePath: string, content: string): void {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    PatchIoBarrier.writeSync(tmpPath, content);
    if (tryRenameSync(tmpPath, filePath)) {
        return;
    }
    tryUnlinkSync(filePath);
    if (tryRenameSync(tmpPath, filePath)) {
        return;
    }
    PatchIoBarrier.writeSync(filePath, content);
    tryUnlinkSync(tmpPath);
}

/**
 * Safely writes content to a file via a temporary file and atomic rename (PRF-IO-001).
 */
async function writeAtomicAsync(filePath: string, content: string): Promise<void> {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await PatchIoBarrier.writeAsync(tmpPath, content);
    if (await tryRenameAsync(tmpPath, filePath)) {
        return;
    }
    await tryUnlinkAsync(filePath);
    if (await tryRenameAsync(tmpPath, filePath)) {
        return;
    }
    await PatchIoBarrier.writeAsync(filePath, content);
    await tryUnlinkAsync(tmpPath);
}

/**
 * PatchEngine orchestrates automated fixes across source files.
 */
export class PatchEngine {
    /**
     * Converts a diagnostic Issue with actionable patch payload into a FixDescriptor.
     *
     * @param issue - Diagnostic finding emitted by scanner.
     * @returns FixDescriptor or null if issue cannot be fixed automatically.
     */
    public static issueToFix(issue: Issue): FixDescriptor | null {
        if (issue.actionable?.patch) {
            const p = issue.actionable.patch;
            const edit: TextEdit = {
                startLine: p.range.startLine,
                startCol: p.range.startCol,
                endLine: p.range.endLine,
                endCol: p.range.endCol,
                newText: p.replacementText,
            };
            return {
                ruleId: issue.rule,
                description: issue.suggestion || issue.message,
                safetyLevel: issue.actionable.safeToAutomate ? 'guaranteed' : 'heuristic',
                edits: [edit],
            };
        }
        return null;
    }

    /**
     * Creates a TransformContext for a target file.
     *
     * @param filePath - Target file path.
     * @param content - Source file content.
     * @returns TransformContext populated with lines and text.
     */
    public static createContext(filePath: string, content: string): TransformContext {
        return {
            filePath,
            sourceText: content,
            lines: content.split(/\r\n|\r|\n/),
        };
    }

    /**
     * Applies a collection of fix descriptors to the specified file content.
     *
     * @param filePath - Path of the target file being modified.
     * @param content - Original content of the target file.
     * @param fixes - Array of fix descriptors to evaluate and apply.
     * @param options - Codemod configuration options.
     * @returns Result summary containing diff and updated content.
     */
    public applyFixes(
        filePath: string,
        content: string,
        fixes: readonly FixDescriptor[],
        options: CodemodOptions = {},
    ): PatchApplyResult {
        const lineEnding = FormatPreserver.detectLineEnding(content);
        const filteredFixes = this.filterFixes(fixes, options);

        // Collect all atomic edits from approved fixes
        const allEdits: TextEdit[] = [];
        for (const fix of filteredFixes) {
            allEdits.push(...fix.edits);
        }

        const applyResult = TextEditApplier.applyEdits(content, allEdits);
        const patchedContent = FormatPreserver.normalizeLineEndings(
            applyResult.content,
            lineEnding,
        );
        const diff = this.generateUnifiedDiff(filePath, content, patchedContent);

        if (!options.dryRun && patchedContent !== content) {
            writeAtomicSync(filePath, patchedContent);
        }

        return {
            filePath,
            originalContent: content,
            patchedContent,
            unifiedDiff: diff,
            appliedFixCount: applyResult.appliedCount,
            skippedConflictCount: applyResult.skippedCount,
        };
    }

    /**
     * Asynchronously applies a collection of fix descriptors to file content
     * with atomic rename (PRF-IO-001).
     *
     * @param filePath - Path of the target file being modified.
     * @param content - Original content of the target file.
     * @param fixes - Array of fix descriptors to evaluate and apply.
     * @param options - Codemod configuration options.
     * @returns Promise resolving to result summary containing diff and updated content.
     */
    public async applyFixesAsync(
        filePath: string,
        content: string,
        fixes: readonly FixDescriptor[],
        options: CodemodOptions = {},
    ): Promise<PatchApplyResult> {
        const lineEnding = FormatPreserver.detectLineEnding(content);
        const filteredFixes = this.filterFixes(fixes, options);

        const allEdits: TextEdit[] = [];
        for (const fix of filteredFixes) {
            allEdits.push(...fix.edits);
        }

        const applyResult = TextEditApplier.applyEdits(content, allEdits);
        const patchedContent = FormatPreserver.normalizeLineEndings(
            applyResult.content,
            lineEnding,
        );
        const diff = this.generateUnifiedDiff(filePath, content, patchedContent);

        if (!options.dryRun && patchedContent !== content) {
            await writeAtomicAsync(filePath, patchedContent);
        }

        return {
            filePath,
            originalContent: content,
            patchedContent,
            unifiedDiff: diff,
            appliedFixCount: applyResult.appliedCount,
            skippedConflictCount: applyResult.skippedCount,
        };
    }

    /**
     * Filters candidate fixes according to rule whitelist and safety thresholds.
     *
     * @param fixes - Candidate fix descriptors.
     * @param options - Codemod execution options.
     * @returns Array of permissible fix descriptors.
     */
    private filterFixes(
        fixes: readonly FixDescriptor[],
        options: CodemodOptions,
    ): readonly FixDescriptor[] {
        const allowedRules = options.rules ? new Set(options.rules) : null;
        const threshold = options.safetyThreshold ?? 'guaranteed';

        return fixes.filter((fix) => {
            if (allowedRules && !allowedRules.has(fix.ruleId)) {
                return false;
            }
            if (threshold === 'guaranteed' && fix.safetyLevel !== 'guaranteed') {
                return false;
            }
            if (
                threshold === 'heuristic' &&
                fix.safetyLevel !== 'guaranteed' &&
                fix.safetyLevel !== 'heuristic'
            ) {
                return false;
            }
            return true;
        });
    }

    /**
     * Generates a standard unified diff between original and modified content.
     *
     * @param filePath - Normalized path to the file.
     * @param originalText - Text prior to patching.
     * @param modifiedText - Text after patching.
     * @returns Unified diff formatted string, or empty string if identical.
     */
    public generateUnifiedDiff(
        filePath: string,
        originalText: string,
        modifiedText: string,
    ): string {
        if (originalText === modifiedText) {
            return '';
        }

        const originalLines = originalText.split(/\r\n|\r|\n/);
        const modifiedLines = modifiedText.split(/\r\n|\r|\n/);
        const hunks = this.computeHunks(originalLines, modifiedLines);

        if (hunks.length === 0) {
            return '';
        }

        const normalizedPath = filePath.replace(/\\/g, '/');
        const header = `--- a/${normalizedPath}\n+++ b/${normalizedPath}\n`;
        const hunkStrings = hunks.map((h) => {
            const hHeader = `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@\n`;
            return hHeader + h.lines.join('\n') + '\n';
        });

        return header + hunkStrings.join('');
    }

    /**
     * Computes diff hunks between arrays of lines.
     *
     * @param oldLines - Original text lines.
     * @param newLines - Modified text lines.
     * @returns Array of computed diff hunks.
     */
    private computeHunks(oldLines: readonly string[], newLines: readonly string[]): DiffHunk[] {
        // Fast path for simple replacement or insertion
        let startIdx = 0;
        while (
            startIdx < oldLines.length &&
            startIdx < newLines.length &&
            oldLines[startIdx] === newLines[startIdx]
        ) {
            startIdx++;
        }

        let oldEnd = oldLines.length - 1;
        let newEnd = newLines.length - 1;
        while (oldEnd >= startIdx && newEnd >= startIdx && oldLines[oldEnd] === newLines[newEnd]) {
            oldEnd--;
            newEnd--;
        }

        const contextBefore = Math.max(0, startIdx - 3);
        const contextAfterOld = Math.min(oldLines.length, oldEnd + 4);
        const contextAfterNew = Math.min(newLines.length, newEnd + 4);

        const hunkLines: string[] = [];

        // Leading context
        for (let i = contextBefore; i < startIdx; i++) {
            hunkLines.push(` ${oldLines[i]}`);
        }

        // Deletions
        for (let i = startIdx; i <= oldEnd; i++) {
            hunkLines.push(`-${oldLines[i]}`);
        }

        // Additions
        for (let i = startIdx; i <= newEnd; i++) {
            hunkLines.push(`+${newLines[i]}`);
        }

        // Trailing context
        const trailingEnd = Math.max(
            contextAfterOld - (oldEnd + 1),
            contextAfterNew - (newEnd + 1),
        );
        for (let i = 0; i < trailingEnd; i++) {
            const oldContextLine = oldLines[oldEnd + 1 + i];
            if (oldContextLine !== undefined) {
                hunkLines.push(` ${oldContextLine}`);
            }
        }

        const oldCount = Math.max(1, oldEnd - contextBefore + 1 + trailingEnd);
        const newCount = Math.max(1, newEnd - contextBefore + 1 + trailingEnd);

        return [
            {
                oldStart: contextBefore + 1,
                oldCount,
                newStart: contextBefore + 1,
                newCount,
                lines: hunkLines,
            },
        ];
    }
}

/** Singleton default PatchEngine instance for global codemod operations. */
export const defaultPatchEngine = new PatchEngine();
