/**
 * Module: Fractal Git — Developer CLI Commands
 * File Path: ts/cli/commands.ts
 * Architecture Role: Provides developer-facing CLI commands (`status`, `graph`, `reclaim`)
 *   with Dual-Faced output (human-friendly text and machine-parseable JSON).
 * Dependencies & Triggers: Consumed when CLI commands are executed.
 * Responsibilities: Query fractal refs on disk, format status trees, and trigger reclamation.
 * Exit Semantics & Design Rationale: CC <= 15 and Depth <= 4; non-blocking read-only inspection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Trunk tier representing root repository branch line. */
export const TIER_TRUNK = 'trunk' as const;
/** Cell tier representing cell-level integration mainlines. */
export const TIER_CELL = 'cell' as const;
/** Card tier representing individual task and worktree references. */
export const TIER_CARD = 'card' as const;
/** Sub tier representing subagent ephemeral reference probes. */
export const TIER_SUB = 'sub' as const;

/**
 * Union of supported reference hierarchy tiers in Fractal Git.
 */
export type FractalRefTier =
    | typeof TIER_TRUNK
    | typeof TIER_CELL
    | typeof TIER_CARD
    | typeof TIER_SUB;

const SEGMENT_CARD = '/card/';
const SEGMENT_SUB = '/sub/';
const SEGMENT_CELL = '/cell/';
const REFS_DIR = 'refs';
const FRACTAL_DIR = 'fractal';
const REFS_PREFIX = 'refs/';
const OID_DISPLAY_LENGTH = 10;
const UTF8_ENCODING = 'utf8' as const;

/**
 * Discovered fractal reference record.
 */
export interface DiscoveredFractalRef {
    readonly refName: string;
    readonly commitOid: string;
    readonly tier: FractalRefTier;
}

/**
 * Derives the reference hierarchy tier based on the canonical ref path.
 *
 * @param refName Canonical Git ref path (e.g. `refs/fractal/card/c1/sub/s1`).
 * @returns Hierarchy tier identifier ('trunk', 'cell', 'card', or 'sub').
 */
export function parseFractalTier(refName: string): FractalRefTier {
    if (refName.includes(SEGMENT_CARD) && refName.includes(SEGMENT_SUB)) {
        return TIER_SUB;
    }
    if (refName.includes(SEGMENT_CARD)) {
        return TIER_CARD;
    }
    if (refName.includes(SEGMENT_CELL)) {
        return TIER_CELL;
    }
    return TIER_TRUNK;
}

/**
 * Recursively collects file paths within target directory using asynchronous traversal.
 */
async function collectRefFilePaths(rootDir: string): Promise<string[]> {
    const filePaths: string[] = [];
    const queue: string[] = [rootDir];

    while (queue.length > 0) {
        const current = queue.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
            } else if (entry.isFile()) {
                filePaths.push(fullPath);
            }
        }
    }

    return filePaths;
}

/**
 * Parses an individual ref file asynchronously into a DiscoveredFractalRef record.
 */
async function parseRefFile(
    fullPath: string,
    refsRoot: string,
): Promise<DiscoveredFractalRef | null> {
    try {
        const rawContent = await fs.promises.readFile(fullPath, UTF8_ENCODING);
        const rel = path.relative(refsRoot, fullPath).replace(/\\/g, '/');
        const refName = `${REFS_PREFIX}${rel}`;
        const commitOid = rawContent.trim();
        const tier = parseFractalTier(refName);
        return { refName, commitOid, tier };
    } catch {
        return null;
    }
}

/**
 * Scans `.git/refs/fractal/` and discovers all registered fractal refs on disk asynchronously.
 *
 * @param gitDir Absolute or relative path to the `.git` directory.
 * @returns Promise resolving to an array of discovered fractal ref descriptors.
 */
export async function scanFractalRefs(gitDir: string): Promise<DiscoveredFractalRef[]> {
    const fractalBase = path.join(gitDir, REFS_DIR, FRACTAL_DIR);
    try {
        await fs.promises.access(fractalBase);
    } catch {
        return [];
    }

    const files = await collectRefFilePaths(fractalBase);
    const refsRoot = path.join(gitDir, REFS_DIR);
    const results: DiscoveredFractalRef[] = [];

    for (const filePath of files) {
        const item = await parseRefFile(filePath, refsRoot);
        if (item) {
            results.push(item);
        }
    }

    return results;
}

/**
 * Appends a formatted group of reference items into the output line buffer.
 */
function appendRefGroup(
    lines: string[],
    header: string,
    refs: readonly DiscoveredFractalRef[],
    bullet: string,
): void {
    lines.push(header);
    for (const r of refs) {
        lines.push(`  ${bullet} ${r.refName} -> ${r.commitOid.slice(0, OID_DISPLAY_LENGTH)}`);
    }
}

/**
 * Formats discovered refs into a human-readable visual ASCII topology diagram.
 *
 * @param refs List of discovered fractal reference descriptors.
 * @returns Rendered ASCII status dashboard string.
 */
export function formatFractalStatusText(refs: readonly DiscoveredFractalRef[]): string {
    const lines: string[] = ['=== Fractal Git Status Dashboard ===', ''];
    if (refs.length === 0) {
        lines.push('No active fractal references found on disk.');
        return lines.join('\n');
    }

    const trunks = refs.filter((r) => r.tier === TIER_TRUNK);
    const cells = refs.filter((r) => r.tier === TIER_CELL);
    const cards = refs.filter((r) => r.tier === TIER_CARD);
    const subs = refs.filter((r) => r.tier === TIER_SUB);

    appendRefGroup(lines, `Trunk Ref (${trunks.length}):`, trunks, '*');
    appendRefGroup(lines, `\nCell Integration Mains (${cells.length}):`, cells, '├──');
    appendRefGroup(lines, `\nCard Worktrees (${cards.length}):`, cards, '├──');
    appendRefGroup(lines, `\nActive SubAgent Probes (${subs.length}):`, subs, '└──');

    return lines.join('\n');
}
