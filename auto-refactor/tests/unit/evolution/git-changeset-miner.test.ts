/**
 * Module: Unit Tests — Git ChangeSet & Entropy Miner
 * File Path: tests/unit/evolution/git-changeset-miner.test.ts
 * Architecture Role: Verifies Hassan (ICSE 2009) Change Shannon Entropy H(C) and Kamei JIT
 *   diffusion vector calculations, numstat parsing, and architectural subsystem resolution.
 * Dependencies & Triggers: Imports git-changeset-miner; executed under vitest (`npm test`).
 * Responsibilities:
 *   1. Assert robust parsing of raw numstat lines, skipping binary markers and empty lines;
 *   2. Assert correct architectural subsystem routing across monorepo boundaries;
 *   3. Assert Shannon entropy properties: H(C)=0 on single file, H_hat(C) in [0, 1];
 *   4. Assert Kamei diffusion detection triggering on dispersed cross-subsystem commits;
 *   5. Assert deterministic behavior with zero exceptions.
 * Exit Semantics & Design Rationale: In-memory deterministic unit tests verifying empirical math.
 */

import { describe, it, expect } from 'vitest';
import {
    parseNumstatLine,
    parseNumstatOutput,
    resolveSubsystem,
    computeChangeEntropy,
    evaluateChangeEntropy,
    DEFAULT_KNOWN_SUBSYSTEMS,
    type FileChangeRecord,
} from '../../../src/core/evolution/git-changeset-miner';

describe('git-changeset-miner', () => {
    describe('parseNumstatLine', () => {
        it('returns null on empty, blank or malformed lines', () => {
            expect(parseNumstatLine('')).toBeNull();
            expect(parseNumstatLine('   \t  ')).toBeNull();
            expect(parseNumstatLine('10\t20')).toBeNull(); // Missing path
        });

        it('returns null on binary files with hyphen markers', () => {
            expect(parseNumstatLine('-\t-\timages/logo.png')).toBeNull();
            expect(parseNumstatLine('10\t-\tbin/target.wasm')).toBeNull();
        });

        it('parses valid numstat lines accurately', () => {
            const record = parseNumstatLine('15\t5\tauto-refactor/src/api.ts');
            expect(record).toEqual({
                filePath: 'auto-refactor/src/api.ts',
                added: 15,
                deleted: 5,
                total: 20,
            });
        });

        it('handles file paths with spaces or special characters', () => {
            const record = parseNumstatLine('100\t0\tdocs/architecture notes/design blueprint.md');
            expect(record).toEqual({
                filePath: 'docs/architecture notes/design blueprint.md',
                added: 100,
                deleted: 0,
                total: 100,
            });
        });
    });

    describe('resolveSubsystem', () => {
        it('resolves known monorepo subsystems accurately', () => {
            expect(resolveSubsystem('auto-refactor/src/index.ts')).toBe('auto-refactor');
            expect(resolveSubsystem('workspace-timing/package.json')).toBe('workspace-timing');
            expect(resolveSubsystem('WebGames/scenes/main.tscn')).toBe('WebGames');
            expect(resolveSubsystem('scripts/common/commit-msg-gate.ps1')).toBe('scripts');
            expect(resolveSubsystem('docs/README.md')).toBe('docs');
            expect(resolveSubsystem('.agents/skills/batch-commit/SKILL.md')).toBe('.agents');
        });

        it('resolves root level files to root identifier', () => {
            expect(resolveSubsystem('package.json')).toBe('root');
            expect(resolveSubsystem('AGENTS.md')).toBe('root');
            expect(resolveSubsystem('')).toBe('root');
        });

        it('resolves unknown nested paths to top directory or root', () => {
            expect(resolveSubsystem('other-tool/main.py', DEFAULT_KNOWN_SUBSYSTEMS)).toBe('other-tool');
        });
    });

    describe('computeChangeEntropy', () => {
        it('handles empty change records safely', () => {
            const result = computeChangeEntropy([]);
            expect(result.fileCount).toBe(0);
            expect(result.totalChangedLoc).toBe(0);
            expect(result.entropy).toBe(0.0);
            expect(result.normalizedEntropy).toBe(0.0);
            expect(result.subsystemsCount).toBe(0);
            expect(result.isDiffused).toBe(false);
            expect(result.recommendation).toBeUndefined();
        });

        it('yields zero entropy on single file modifications', () => {
            const records: FileChangeRecord[] = [
                { filePath: 'auto-refactor/src/api.ts', added: 40, deleted: 10, total: 50 },
            ];
            const result = computeChangeEntropy(records);
            expect(result.fileCount).toBe(1);
            expect(result.totalChangedLoc).toBe(50);
            expect(result.entropy).toBe(0.0);
            expect(result.normalizedEntropy).toBe(0.0);
            expect(result.subsystems).toEqual(['auto-refactor']);
            expect(result.isDiffused).toBe(false);
        });

        it('handles records with zero total changed lines without dividing by zero', () => {
            const records: FileChangeRecord[] = [
                { filePath: 'auto-refactor/src/a.ts', added: 0, deleted: 0, total: 0 },
                { filePath: 'auto-refactor/src/b.ts', added: 0, deleted: 0, total: 0 },
            ];
            const result = computeChangeEntropy(records);
            expect(result.totalChangedLoc).toBe(0);
            expect(result.entropy).toBe(0.0);
            expect(result.normalizedEntropy).toBe(0.0);
            expect(result.isDiffused).toBe(false);
        });

        it('computes low entropy when changes are concentrated in one file', () => {
            const records: FileChangeRecord[] = [
                { filePath: 'auto-refactor/src/main.ts', added: 1000, deleted: 0, total: 1000 },
                { filePath: 'auto-refactor/src/aux1.ts', added: 1, deleted: 0, total: 1 },
                { filePath: 'auto-refactor/src/aux2.ts', added: 1, deleted: 0, total: 1 },
            ];
            const result = computeChangeEntropy(records);
            expect(result.totalChangedLoc).toBe(1002);
            expect(result.normalizedEntropy).toBeLessThan(0.1);
            expect(result.isDiffused).toBe(false);
        });

        it('detects high diffusion when changes are uniformly spread across multiple subsystems', () => {
            // 10 files across 3 subsystems, each modified by exactly 10 lines
            const records: FileChangeRecord[] = [
                { filePath: 'auto-refactor/src/a.ts', added: 5, deleted: 5, total: 10 },
                { filePath: 'auto-refactor/src/b.ts', added: 5, deleted: 5, total: 10 },
                { filePath: 'auto-refactor/src/c.ts', added: 5, deleted: 5, total: 10 },
                { filePath: 'workspace-timing/src/d.ts', added: 5, deleted: 5, total: 10 },
                { filePath: 'workspace-timing/src/e.ts', added: 5, deleted: 5, total: 10 },
                { filePath: 'workspace-timing/src/f.ts', added: 5, deleted: 5, total: 10 },
                { filePath: 'WebGames/scripts/g.gd', added: 5, deleted: 5, total: 10 },
                { filePath: 'WebGames/scripts/h.gd', added: 5, deleted: 5, total: 10 },
                { filePath: 'WebGames/scripts/i.gd', added: 5, deleted: 5, total: 10 },
                { filePath: 'WebGames/scripts/j.gd', added: 5, deleted: 5, total: 10 },
            ];

            const result = computeChangeEntropy(records);
            expect(result.fileCount).toBe(10);
            expect(result.subsystemsCount).toBe(3);
            // Uniform distribution -> H(C) = log2(10) -> normalizedEntropy = 1.0
            expect(result.normalizedEntropy).toBeCloseTo(1.0, 2);
            expect(result.isDiffused).toBe(true);
            expect(result.recommendation).toBeDefined();
            expect(result.recommendation).toContain('High Change Shannon Entropy');
        });
    });

    describe('evaluateChangeEntropy', () => {
        it('evaluates end-to-end raw numstat text output', () => {
            const raw = [
                '10\t2\tauto-refactor/src/core/types.ts',
                '20\t5\tauto-refactor/src/api.ts',
                '-\t-\tassets/icon.png',
                '',
            ].join('\n');

            const result = evaluateChangeEntropy(raw);
            expect(result.fileCount).toBe(2);
            expect(result.totalChangedLoc).toBe(37);
            expect(result.subsystems).toEqual(['auto-refactor']);
            expect(result.isDiffused).toBe(false);
        });
    });
});
