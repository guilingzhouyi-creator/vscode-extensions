/**
 * Module: Daemon shutdown persistence acceptance
 * File Path: tests/unit/daemon/shutdown-drain.test.ts
 * Architecture Role: Exercise compiled daemon resource ownership in a child process.
 * Dependencies & Triggers: Vitest, IPC, DaemonServer, and persistent cache reload.
 * Responsibilities: Delay exit until owned cache draining finishes and expose drain failures.
 * Exit Semantics & Design Rationale: A zero exit status must not hide a failed final flush.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { on, once } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CacheStore as CacheStoreType } from '../../../src/core/cache';

const require = createRequire(import.meta.url);
const serverModule = require.resolve('../../../dist/daemon/server.js');
const {
    CacheStore,
}: { CacheStore: typeof CacheStoreType } = require('../../../dist/core/cache.js');
const childSource = String.raw`
const { DaemonServer } = require(process.argv[1]);
const daemon = new DaemonServer(process.argv[2], { stdio: true });
const cache = daemon.ctx.getCache(process.argv[2]);
cache.writeL1('shutdown.ts', { mtimeMs: 7, size: 9 });
const settle = cache.settleAsync.bind(cache);
cache.settleAsync = async () => {
    process.send('drain-entered');
    await new Promise((resolve) => process.once('message', resolve));
    if (process.argv[3] === 'failure') throw new Error('injected final flush failure');
    await settle();
};
daemon.shutdown('test');
`;

const inflightSource = String.raw`
const path = require('node:path');
const handlers = require(path.join(path.dirname(process.argv[1]), 'scanHandler.js'));
let scanFinished = false;
handlers.handleScan = async (_context, _config, options) => {
    process.send(options.signal ? 'scan-entered' : 'missing-signal');
    options.signal?.addEventListener('abort', () => process.send('scan-aborted'), { once: true });
    await new Promise((resolve) => process.once('message', resolve));
    scanFinished = true;
    throw new Error('scan cancelled');
};
const { DaemonServer } = require(process.argv[1]);
const daemon = new DaemonServer(process.argv[2], { stdio: true });
const cache = daemon.ctx.getCache(process.argv[2]);
const settle = cache.settleAsync.bind(cache);
cache.settleAsync = async () => {
    if (!scanFinished) throw new Error('cache drain began before the active scan completed');
    process.send('drain-entered');
    await new Promise((resolve) => process.once('message', resolve));
    await settle();
};
daemon.startListening().then(() => process.send('ready'));
`;

let directory: string;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-daemon-drain-'));
});
afterEach(() => {
    const relative = path.relative(os.tmpdir(), directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid owned daemon test directory');
    }
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('daemon shutdown drain', () => {
    it('cancels and waits for the active scan before draining caches', async () => {
        const child = spawn(process.execPath, ['-e', inflightSource, serverModule, directory], {
            stdio: ['pipe', 'ignore', 'pipe', 'ipc'],
        });
        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr = (stderr + chunk.toString()).slice(-4096);
        });
        const exited = once(child, 'exit');
        const messages = on(child, 'message', { signal: AbortSignal.timeout(15_000) });
        const nextMessage = async (): Promise<unknown> => {
            const result = await Promise.race([
                messages.next(),
                exited.then(() => {
                    throw new Error(`Daemon exited during scan drain: ${stderr}`);
                }),
            ]);
            return result.value?.[0];
        };
        try {
            expect(await nextMessage()).toBe('ready');
            child.stdin?.write(
                JSON.stringify({
                    v: 1,
                    id: 1,
                    type: 'scan',
                    params: {
                        requestId: 'active',
                        config: { root: directory },
                        options: { cache: true },
                    },
                }) + '\n',
            );
            expect(await nextMessage()).toBe('scan-entered');
            child.stdin?.write(
                JSON.stringify({ v: 1, id: 2, type: 'shutdown', reason: 'test' }) + '\n',
            );
            expect(await nextMessage()).toBe('scan-aborted');
            child.send('release-scan');
            expect(await nextMessage()).toBe('drain-entered');
            child.send('resume-drain');
            expect((await exited)[0]).toBe(0);
        } finally {
            await messages.return?.();
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            await exited;
        }
    }, 20_000);

    it.each(['success', 'failure'])(
        'waits for the final cache flush: %s',
        async (outcome) => {
            const child = spawn(
                process.execPath,
                ['-e', childSource, serverModule, directory, outcome],
                {
                    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
                },
            );
            let stderr = '';
            child.stderr?.on('data', (chunk: Buffer) => {
                stderr = (stderr + chunk.toString()).slice(-4096);
            });
            const exited = once(child, 'exit');
            try {
                const message = await Promise.race([
                    once(child, 'message', { signal: AbortSignal.timeout(15_000) }),
                    exited.then(() => {
                        throw new Error(`Daemon exited before final flush: ${stderr}`);
                    }),
                ]);
                expect(message[0]).toBe('drain-entered');
                expect(child.exitCode).toBeNull();
                child.send('resume-drain');
                const [code] = await exited;
                expect(code).toBe(outcome === 'success' ? 0 : 1);
                if (outcome === 'success') {
                    expect(
                        new CacheStore(undefined, directory).lookupL1('shutdown.ts'),
                    ).toMatchObject({ mtimeMs: 7, size: 9 });
                } else {
                    expect(stderr).toContain('injected final flush failure');
                }
            } finally {
                if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                await exited;
            }
        },
        20_000,
    );
});
