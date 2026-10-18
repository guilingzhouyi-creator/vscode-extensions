/**
 * Module: Fractal Git — Developer CLI Commands
 * File Path: ts/cli/commands.ts
 * Architecture Role: Provides developer-facing CLI commands (`status`, `graph`, `reclaim`)
 *   with Dual-Faced output (human-friendly text and machine-parseable JSON).
 * Dependencies & Triggers: Consumed when CLI commands are executed.
 * Responsibilities: Query fractal refs on disk, format status trees, and trigger manual reclamation.
 * Exit Semantics & Design Rationale: CC <= 15 and Depth <= 4; non-blocking read-only inspection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Discovered fractal reference record.
 */
export interface DiscoveredFractalRef {
    readonly refName: string;
    readonly commitOid: string;
    readonly tier: 'trunk' | 'cell' | 'card' | 'sub';
}

/**
 * Scans `.git/refs/fractal/` and discovers all registered fractal refs on disk.
 */
export function scanFractalRefs(gitDir: string): DiscoveredFractalRef[] {
    const fractalBase = path.join(gitDir, 'refs', 'fractal');
    if (!fs.existsSync(fractalBase)) {
        return [];
    }

    const results: DiscoveredFractalRef[] = [];
    const traverse = (currentDir: string): void => {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                traverse(fullPath);
            } else if (entry.isFile()) {
                const rel = path.relative(path.join(gitDir, 'refs'), fullPath).replace(/\\/g, '/');
                const refName = `refs/${rel}`;
                const commitOid = fs.readFileSync(fullPath, 'utf8').trim();

                let tier: 'trunk' | 'cell' | 'card' | 'sub' = 'trunk';
                if (refName.includes('/card/') && refName.includes('/sub/')) {
                    tier = 'sub';
                } else if (refName.includes('/card/')) {
                    tier = 'card';
                } else if (refName.includes('/cell/')) {
                    tier = 'cell';
                }

                results.push({ refName, commitOid, tier });
            }
        }
    };

    traverse(fractalBase);
    return results;
}

/**
 * Formats discovered refs into a human-readable visual ASCII topology diagram.
 */
export function formatFractalStatusText(refs: readonly DiscoveredFractalRef[]): string {
    const lines: string[] = ['=== Fractal Git Status Dashboard ===', ''];
    if (refs.length === 0) {
        lines.push('No active fractal references found on disk.');
        return lines.join('\n');
    }

    const trunks = refs.filter((r) => r.tier === 'trunk');
    const cells = refs.filter((r) => r.tier === 'cell');
    const cards = refs.filter((r) => r.tier === 'card');
    const subs = refs.filter((r) => r.tier === 'sub');

    lines.push(`Trunk Ref (${trunks.length}):`);
    for (const t of trunks) {
        lines.push(`  * ${t.refName} -> ${t.commitOid.slice(0, 10)}`);
    }

    lines.push(`\nCell Integration Mains (${cells.length}):`);
    for (const c of cells) {
        lines.push(`  ├── ${c.refName} -> ${c.commitOid.slice(0, 10)}`);
    }

    lines.push(`\nCard Worktrees (${cards.length}):`);
    for (const ca of cards) {
        lines.push(`  ├── ${ca.refName} -> ${ca.commitOid.slice(0, 10)}`);
    }

    lines.push(`\nActive SubAgent Probes (${subs.length}):`);
    for (const s of subs) {
        lines.push(`  └── ${s.refName} -> ${s.commitOid.slice(0, 10)}`);
    }

    return lines.join('\n');
}
