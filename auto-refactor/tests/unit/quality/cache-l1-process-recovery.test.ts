/**
 * Module: Cache process interruption acceptance
 * File Path: tests/unit/quality/cache-l1-process-recovery.test.ts
 * Architecture Role: Exercise compiled persistence across abrupt process termination.
 * Dependencies & Triggers: Vitest, child processes, compiled CacheStore, and real files.
 * Responsibilities: Recover durable entries at checkpoint and WAL publication boundaries.
 * Exit Semantics & Design Rationale: A published checkpoint may coexist with an older WAL.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CacheStore as CacheStoreType } from '../../../src/core/cache';

const require = createRequire(import.meta.url);
const cacheModule = require.resolve('../../../dist/core/cache.js');
const { CacheStore }: { CacheStore: typeof CacheStoreType } = require(cacheModule);
const entryCount = 20_000;
const suffix = 'x'.repeat(80);
const childSource = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { CacheStore } = require(process.argv[1]);
(async () => {
    const cache = new CacheStore(process.argv[3], process.argv[2]);
    cache.writeL1('seed.ts', { mtimeMs: 1, size: 1 });
    await cache.flushAsync();
    if (cache.lastFlushError) throw cache.lastFlushError;
    const rename = fs.promises.rename.bind(fs.promises);
    fs.promises.rename = async (source, destination) => {
        if (path.basename(String(destination)) === process.argv[4]) {
            process.send('publication-paused');
            await new Promise(() => {});
        }
        await rename(source, destination);
    };
    for (let index = 0; index < 20000; index++) {
        cache.writeL1('src/' + index + '-' + 'x'.repeat(80) + '.ts', {
            mtimeMs: index + 2,
            size: index + 3,
        });
    }
    await cache.settleAsync();
    if (cache.lastFlushError) throw cache.lastFlushError;
    throw new Error('Checkpoint publication was not intercepted');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
    process.disconnect();
});
`;

let directory: string;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cache-process-'));
});
afterEach(() => {
    const relative = path.relative(os.tmpdir(), directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid owned cache process directory');
    }
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('L1 process interruption recovery', () => {
    it.each(['l1-checkpoint.arcp', 'fingerprints.jsonl', 'l1-delta.arwal'])(
        'recovers durable state when interrupted before publishing %s',
        async (publication) => {
            const cacheDirectory = path.join(directory, 'cache');
            const child = spawn(
                process.execPath,
                ['-e', childSource, cacheModule, directory, cacheDirectory, publication],
                { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
            );
            let stderr = '';
            child.stderr?.on('data', (data: Buffer) => {
                stderr = (stderr + data.toString()).slice(-4096);
            });
            const exited = once(child, 'exit');
            try {
                const message = await Promise.race([
                    once(child, 'message', { signal: AbortSignal.timeout(20_000) }),
                    exited.then(() => {
                        throw new Error(`Cache child exited before publication: ${stderr}`);
                    }),
                ]);
                expect(message[0]).toBe('publication-paused');
                expect(child.kill('SIGKILL')).toBe(true);
                await exited;
                const recovered = new CacheStore(cacheDirectory, directory);
                expect(recovered.lookupL1('seed.ts')).toMatchObject({ mtimeMs: 1, size: 1 });
                for (const index of [0, Math.floor(entryCount / 2), entryCount - 1]) {
                    expect(recovered.lookupL1(`src/${index}-${suffix}.ts`)).toMatchObject({
                        mtimeMs: index + 2,
                        size: index + 3,
                    });
                }
                recovered.writeL1('after-restart.ts', { mtimeMs: 99, size: 101 });
                await recovered.settleAsync();
                expect(recovered.lastFlushError).toBeUndefined();
                expect(
                    new CacheStore(cacheDirectory, directory).lookupL1('after-restart.ts'),
                ).toMatchObject({ mtimeMs: 99, size: 101 });
            } finally {
                if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                await exited;
            }
        },
        30_000,
    );
});
