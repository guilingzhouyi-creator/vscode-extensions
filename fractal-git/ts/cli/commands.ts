/**
 * Module: Fractal Git — Developer CLI Commands & Structural Branch Grammar
 * File Path: ts/cli/commands.ts
 * Architecture Role: Provides developer-facing CLI commands (`status`, `graph`, `reclaim`)
 *   and structural 5-tier fractal branch coordinate parsing/derivation matching `fg-topology`.
 * Dependencies & Triggers: Consumes `../constants` and Node `fs`/`path`.
 * Responsibilities: Query fractal refs on disk, parse 5-tier coordinates without substring heuristics,
 *   derive child branch names from active parents, and format status trees.
 * Exit Semantics & Design Rationale: CC <= 15 and Depth <= 4; eliminates D/F collisions via `/main` leaf.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    parseFractalTier,
    TIER_CARD,
    TIER_CELL,
    TIER_SUB,
    TIER_SYSTEM_TRUNK,
    TIER_TRUNK,
    type FractalRefTier,
} from './branch-parser';

export {
    hasForbiddenBranchPrefix,
    isValidKebabSegment,
    normalizeCellId,
    parseFractalCoordinate,
    parseFractalTier,
    TIER_CARD,
    TIER_CELL,
    TIER_SUB,
    TIER_SYSTEM_TRUNK,
    TIER_TRUNK,
    type FractalRefTier,
    type ParsedFractalCoordinate,
} from './branch-parser';
export { deriveChildBranch } from './branch-derivation';

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

    const trunks = refs.filter((r) => r.tier === TIER_SYSTEM_TRUNK || r.tier === TIER_TRUNK);
    const cells = refs.filter((r) => r.tier === TIER_CELL);
    const cards = refs.filter((r) => r.tier === TIER_CARD);
    const subs = refs.filter((r) => r.tier === TIER_SUB);

    appendRefGroup(lines, `Trunk Ref (${trunks.length}):`, trunks, '*');
    appendRefGroup(lines, `\nCell Integration Mains (${cells.length}):`, cells, '├──');
    appendRefGroup(lines, `\nCard Worktrees (${cards.length}):`, cards, '├──');
    appendRefGroup(lines, `\nActive SubAgent Probes (${subs.length}):`, subs, '└──');

    return lines.join('\n');
}
