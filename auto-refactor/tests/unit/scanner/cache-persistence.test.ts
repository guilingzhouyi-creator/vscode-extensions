/**
 * Module: Scanner cache persistence integration regressions
 * File Path: tests/unit/scanner/cache-persistence.test.ts
 * Architecture Role: Verify that production scan APIs await their asynchronous cache writer.
 * Dependencies & Triggers: Vitest, Scanner, CacheStore, and an owned filesystem fixture.
 * Responsibilities: Check workspace and diff scan completion against real persisted fingerprints.
 * Exit Semantics & Design Rationale: A deferred writer makes premature completion deterministic.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { Scanner as ScannerType } from '../../../src/core/analyzer';
const { Scanner } = createRequire(import.meta.url)('../../../dist/core/analyzer.js') as {
    Scanner: typeof ScannerType;
};
import { CacheStore } from '../../../src/core/cache';
import { getDefaultConfig } from '../../../src/core/config/config';

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    return {
        promise: new Promise<void>((done) => {
            resolve = done;
        }),
        resolve: () => resolve(),
    };
}

afterEach(() => vi.restoreAllMocks());

describe('scanner persistence completion', () => {
    it.each(['workspace', 'diff'] as const)(
        'awaits async persistence for a %s scan',
        async (mode) => {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-scan-persistence-'));
            fs.mkdirSync(path.join(directory, 'src'));
            fs.writeFileSync(
                path.join(directory, 'src', 'example.ts'),
                'export const value = 1;\n',
            );
            const cache = new CacheStore(path.join(directory, 'cache'), directory);
            const config = getDefaultConfig(directory);
            config.workers = 1;
            config.logLevel = 'silent';
            const scanner = new Scanner(config);
            const entered = deferred();
            const resume = deferred();
            const realFlush = cache.flushAsync.bind(cache);
            vi.spyOn(cache, 'flushAsync').mockImplementation(async () => {
                entered.resolve();
                await resume.promise;
                await realFlush();
            });
            const scan =
                mode === 'workspace'
                    ? scanner.scanWithCache({ cache })
                    : scanner.scanWithDiff({
                          cache,
                          diffHints: new Map(),
                          verifyDiskContent: true,
                      });
            try {
                const outcome = await Promise.race([
                    entered.promise.then(() => 'entered'),
                    scan.then(() => 'completed'),
                ]);
                expect(outcome).toBe('entered');
                let completed = false;
                void scan.then(() => {
                    completed = true;
                });
                await Promise.resolve();
                expect(completed).toBe(false);
                resume.resolve();
                await scan;
                const reloaded = new CacheStore(path.join(directory, 'cache'), directory);
                expect(reloaded.lookupL1('src/example.ts')).not.toBeNull();
            } finally {
                resume.resolve();
                await scan;
                await cache.settleAsync();
                scanner.logger.close();
                const relative = path.relative(os.tmpdir(), directory);
                if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
                    throw new Error('Invalid owned scanner test directory');
                }
                fs.rmSync(directory, { recursive: true, force: true });
            }
        },
    );
});
