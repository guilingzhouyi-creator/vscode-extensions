/**
 * Module: Core Trajectory — AST Block Fingerprint Cache & Unique ELOC Deduplicator
 * File Path: src/core/trajectory/block-fingerprint-cache.ts
 * Architecture Role: Extracts AST function/class/interface blocks, generates content-invariant
 *   structural fingerprints, and tracks unique logic code lines across multi-run revisions
 *   to guarantee true deduplication (ELOC_unique vs ELOC_processed).
 * Dependencies & Triggers: Consumes eloc-types; called by semantic-delta-classifier,
 *   trajectory metrics engine, and quality reviewers.
 * Responsibilities: Extract AST block structural spans, compute normalized SHA-256 fingerprints,
 *   and maintain in-memory block deduplication cache.
 * Exit Semantics & Design Rationale: In-memory AST tokenization and SHA-256 hashing; zero I/O;
 *   never throws unhandled exceptions during block analysis.
 */

import * as crypto from 'crypto';
import type { AstBlockKind, BlockFingerprint } from './eloc-types';

/** Regular expressions for extracting high-level AST blocks in TS/JS/GDScript/Python */
const FN_DECL_RE = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/;
const METHOD_DECL_RE =
    /^(?:public|private|protected|static|async|\s)*([A-Za-z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^,{]+)?\s*\{/;
const CLASS_DECL_RE = /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/;
const INTERFACE_DECL_RE = /^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/;
const TYPE_DECL_RE = /^(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/;
const GDSCRIPT_FUNC_RE = /^func\s+([A-Za-z0-9_$]+)\s*\(/;
const GDSCRIPT_CLASS_RE = /^class_name\s+([A-Za-z0-9_$]+)/;
const PYTHON_DEF_RE = /^def\s+([A-Za-z0-9_$]+)\s*\(/;
const PYTHON_CLASS_RE = /^class\s+([A-Za-z0-9_$]+)/;

/**
 * Computes a normalized structural fingerprint hash of code text,
 * invariant to comments and formatting.
 *
 * @param text - Raw code snippet.
 * @returns SHA-256 hex digest of normalized token string.
 */
export function computeNormalizedFingerprint(text: string): string {
    const normalized = text
        .replace(/\/\*[\s\S]*?\*\//g, '') // remove multi-line comments
        .replace(/\/\/[^\n]*/g, '') // remove single-line comments
        .replace(/#[^\n]*/g, '') // remove script comments (#)
        .replace(/\s+/g, ' ') // collapse all whitespace/indentation
        .trim();

    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Counts effective logic lines (ELOC) in a block by skipping blank lines and pure comments.
 *
 * @param content - Block text content.
 * @returns Count of non-blank, non-comment lines.
 */
export function countBlockEloc(content: string): number {
    const lines = content.split(/\r?\n/);
    let count = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (
            trimmed.length > 0 &&
            !trimmed.startsWith('//') &&
            !trimmed.startsWith('/*') &&
            !trimmed.startsWith('*') &&
            !trimmed.startsWith('#') &&
            !trimmed.startsWith(';')
        ) {
            count++;
        }
    }
    return count;
}

/**
 * Detects AST construct kind and name from a line header.
 */
function detectBlockDeclaration(trimmed: string): { kind: AstBlockKind; name: string } | null {
    let match: RegExpMatchArray | null = null;

    if ((match = trimmed.match(FN_DECL_RE))) {
        return { kind: 'function', name: match[1] };
    }
    if (
        (match = trimmed.match(CLASS_DECL_RE)) ||
        (match = trimmed.match(GDSCRIPT_CLASS_RE)) ||
        (match = trimmed.match(PYTHON_CLASS_RE))
    ) {
        return { kind: 'class', name: match[1] };
    }
    if ((match = trimmed.match(INTERFACE_DECL_RE))) {
        return { kind: 'interface', name: match[1] };
    }
    if ((match = trimmed.match(TYPE_DECL_RE))) {
        return { kind: 'type', name: match[1] };
    }
    if ((match = trimmed.match(GDSCRIPT_FUNC_RE)) || (match = trimmed.match(PYTHON_DEF_RE))) {
        return { kind: 'function', name: match[1] };
    }
    if ((match = trimmed.match(METHOD_DECL_RE))) {
        return { kind: 'method', name: match[1] };
    }
    return null;
}

/**
 * Calculates net brace balance delta for a line.
 */
function computeBraceBalance(line: string): number {
    let delta = 0;
    for (let c = 0; c < line.length; c++) {
        if (line[c] === '{') delta++;
        else if (line[c] === '}') delta--;
    }
    return delta;
}

/**
 * Checks if current block has terminated based on brace depth or indentation.
 */
function checkBlockTermination(
    normPath: string,
    braceDepth: number,
    indent: number,
    line: string,
    trimmed: string,
    lineCount: number,
): boolean {
    if (braceDepth <= 0 && lineCount > 1) {
        return true;
    }
    const isIndentedLanguage = normPath.endsWith('.py') || normPath.endsWith('.gd');
    if (
        isIndentedLanguage &&
        trimmed.length > 0 &&
        !trimmed.startsWith('#') &&
        line.search(/\S/) <= indent &&
        lineCount > 1
    ) {
        return true;
    }
    return false;
}

interface ActiveBlockState {
    kind: AstBlockKind;
    name: string;
    startLine: number;
    lines: string[];
    braceDepth: number;
    indent: number;
}

/**
 * Converts accumulated block state into a BlockFingerprint record.
 */
function finalizeBlockRecord(
    normPath: string,
    state: ActiveBlockState,
    endLine: number,
): BlockFingerprint {
    const blockContent = state.lines.join('\n');
    const fp = computeNormalizedFingerprint(blockContent);
    const eloc = countBlockEloc(blockContent);

    return {
        blockId: `${normPath}:${state.startLine}:${state.name}`,
        kind: state.kind,
        name: state.name,
        fingerprint: fp,
        eloc,
        filePath: normPath,
        startLine: state.startLine,
        endLine,
    };
}

/**
 * Extracts AST block fingerprints from a source file string.
 *
 * @param filePath - Repository-relative file path.
 * @param content - Source file content.
 * @returns Array of identified block fingerprints.
 */
export function extractBlockFingerprints(filePath: string, content: string): BlockFingerprint[] {
    const lines = content.split(/\r?\n/);
    const blocks: BlockFingerprint[] = [];
    const normPath = filePath.replace(/\\/g, '/');

    let currentBlock: ActiveBlockState | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const lineNo = i + 1;

        if (currentBlock) {
            currentBlock.lines.push(line);
            currentBlock.braceDepth += computeBraceBalance(line);

            if (
                checkBlockTermination(
                    normPath,
                    currentBlock.braceDepth,
                    currentBlock.indent,
                    line,
                    trimmed,
                    currentBlock.lines.length,
                )
            ) {
                blocks.push(finalizeBlockRecord(normPath, currentBlock, lineNo));
                currentBlock = null;
            }
            continue;
        }

        const decl = detectBlockDeclaration(trimmed);
        if (decl) {
            const initialDepth = computeBraceBalance(line);
            currentBlock = {
                kind: decl.kind,
                name: decl.name,
                startLine: lineNo,
                lines: [line],
                braceDepth: Math.max(1, initialDepth),
                indent: line.search(/\S/),
            };
        }
    }

    if (currentBlock) {
        blocks.push(finalizeBlockRecord(normPath, currentBlock, lines.length));
    }

    return blocks;
}

/**
 * In-memory global/session AST Block Fingerprint Cache for unique ELOC deduplication.
 */
export class BlockFingerprintCache {
    private readonly seenFingerprints = new Map<string, BlockFingerprint>();
    private totalUniqueEloc = 0;

    /**
     * Records a batch of extracted block fingerprints, calculating unique and duplicate increments.
     *
     * @param blocks - Extracted AST blocks from recent files.
     * @returns Incremental deduplication statistics.
     */
    public recordAndDeduplicate(blocks: BlockFingerprint[]): {
        newBlocksCount: number;
        duplicateBlocksCount: number;
        uniqueElocIncrement: number;
    } {
        let newBlocksCount = 0;
        let duplicateBlocksCount = 0;
        let uniqueElocIncrement = 0;

        for (const block of blocks) {
            if (this.seenFingerprints.has(block.fingerprint)) {
                duplicateBlocksCount++;
            } else {
                this.seenFingerprints.set(block.fingerprint, block);
                newBlocksCount++;
                uniqueElocIncrement += block.eloc;
                this.totalUniqueEloc += block.eloc;
            }
        }

        return { newBlocksCount, duplicateBlocksCount, uniqueElocIncrement };
    }

    /**
     * Gets cumulative unique ELOC registered across all historical runs.
     */
    public getTotalUniqueEloc(): number {
        return this.totalUniqueEloc;
    }

    /**
     * Clears cache state.
     */
    public clear(): void {
        this.seenFingerprints.clear();
        this.totalUniqueEloc = 0;
    }
}
