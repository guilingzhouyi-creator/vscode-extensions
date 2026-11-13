/**
 * Module: Unit Test — Daemon Keep-Alive Capabilities & Stdio EOF Lifecycle
 * File Path: tests/unit/daemon/snapshot-and-slice.test.ts
 * Architecture Role: Verify daemon `slice_audit`, `scan_asymmetric`, `scan_snapshot` frame
 *   dispatch over `--keep-alive` and clean stdin-EOF shutdown for embedded Taxis transport.
 * Dependencies & Triggers: Vitest, DaemonServer, and built CLI server bundle.
 * Responsibilities: Confirm advertised capabilities, keep-alive idle timer suspension, and clean
 *   exit code on stdio pipe EOF without orphan background child processes.
 * Exit Semantics & Design Rationale: Deterministic unit & stdio child checks with bounded timers.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter, once } from 'node:events';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DaemonIndexModule from '../../../src/daemon/index';

const FRAME_POLL_INTERVAL_MS = 25;
const STDIO_EOF_TIMEOUT_MS = 15_000;
const REQUIRE_DAEMON = createRequire(import.meta.url);
const { DaemonServer } = REQUIRE_DAEMON('../../../dist/daemon/index.js') as typeof DaemonIndexModule;

/** Minimal in-memory socket double capturing NDJSON daemon frames. */
class MockIpcSocket extends EventEmitter {
    public destroyed = false;
    public writable = true;
    public chunks: string[] = [];

    setEncoding(_enc: string): this {
        void _enc;
        return this;
    }

    pause(): this {
        return this;
    }

    resume(): this {
        return this;
    }

    write(chunk: string): boolean {
        this.chunks.push(chunk);
        return true;
    }

    destroy(): this {
        this.destroyed = true;
        this.writable = false;
        this.emit('close');
        return this;
    }

    frames(): Array<Record<string, unknown>> {
        return this.chunks
            .join('')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>);
    }
}

async function flushAsyncFrames(
    socket: MockIpcSocket,
    expectedCount: number,
): Promise<Array<Record<string, unknown>>> {
    const deadline = Date.now() + STDIO_EOF_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const parsed = socket.frames();
        if (parsed.length >= expectedCount) return parsed;
        await new Promise((resolve) => setTimeout(resolve, FRAME_POLL_INTERVAL_MS));
    }
    throw new Error(`Timed out waiting for ${expectedCount} daemon frames`);
}

function buildKeepAliveFramesPayload(rootDir: string): string {
    const asymConfig = {
        root: rootDir,
        archetype: 'library',
        analyzers: {},
        include: ["**/*.ts"],
        exclude: [],
        severityThreshold: 'warning',
        effectiveLocThreshold: 800,
        logLevel: 'silent',
    };
    return [
        JSON.stringify({ v: 1, id: 1, type: 'hello', version: '0.1.0', protocol: 1 }),
        JSON.stringify({
            v: 1,
            id: 2,
            type: 'slice_audit',
            params: {
                requestId: 'slice-1',
                filePath: 'src/demo.ts',
                oldContent: 'export function compute(x: number): number { return x; }\n',
                newContent: 'export function compute(x: number): number { return x + 1; }\n',
                changedLines: [1],
            },
        }),
        JSON.stringify({
            v: 1,
            id: 3,
            type: 'scan_asymmetric',
            params: {
                requestId: 'asym-1',
                config: asymConfig,
                inputs: [{ filePath: 'src/demo.ts', oldContent: 'export const v = 1;\n', newContent: 'export const v = 2;\n' }],
            },
        }),
        JSON.stringify({
            v: 1,
            id: 4,
            type: 'scan_snapshot',
            params: {
                requestId: 'snap-1',
                config: { root: rootDir, archetype: 'library' },
                entries: [{ path: 'src/demo.ts', content: 'export const v = 2;\n' }],
            },
        }),
    ].join('\n');
}

async function runStdioEofChild(distServerPath: string, rootDir: string) {
    const script = [
        "const { runDaemonMain } = require(process.argv[1]);",
        'void runDaemonMain(process.argv.slice(2));',
    ].join(' ');
    const child = spawn(
        process.execPath,
        ['-e', script, distServerPath, '--root', rootDir, '--stdio', '--keep-alive'],
        { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const onStdout = (chunk: Buffer) => { stdout += chunk.toString('utf8'); };
    const onStderr = (chunk: Buffer) => { stderr += chunk.toString('utf8'); };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    const exitPromise = once(child, 'exit');
    const hello = JSON.stringify({ v: 1, id: 1, type: 'hello', version: '0.1.0', protocol: 1 });
    const ping = JSON.stringify({ v: 1, id: 2, type: 'ping' });
    child.stdin?.write(`${hello}\n${ping}\n`);
    child.stdin?.end();
    let timer: NodeJS.Timeout | null = null;
    try {
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error(`stdio EOF timed out; stdout=${stdout} stderr=${stderr}`));
            }, STDIO_EOF_TIMEOUT_MS);
        });
        const [exitCode] = (await Promise.race([exitPromise, timeoutPromise])) as [number | null];
        return { exitCode, stdout };
    } finally {
        if (timer) clearTimeout(timer);
        child.stdout?.off('data', onStdout);
        child.stderr?.off('data', onStderr);
    }
}

describe('Daemon keep-alive capabilities & stdio EOF lifecycle', () => {
    let scratchRoot: string;

    beforeEach(() => { scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-daemon-ka-')); });
    afterEach(() => { vi.restoreAllMocks(); fs.rmSync(scratchRoot, { recursive: true, force: true }); });

    it('wires hello_ack capabilities, slice, asymmetric, and snapshot with keepAlive', async () => {
        const server = new DaemonServer(scratchRoot, { stdio: true, keepAlive: true });
        const handleConn = (server as unknown as { handleConnection: (s: MockIpcSocket) => void }).handleConnection;
        const socket = new MockIpcSocket();
        handleConn.call(server, socket);

        expect((server as unknown as { idleTimer: unknown }).idleTimer).toBeNull();
        socket.emit('data', `${buildKeepAliveFramesPayload(scratchRoot)}\n`);

        const frames = await flushAsyncFrames(socket, 4);
        expect(frames.find((f) => f.type === 'hello_ack')?.caps).toMatchObject({ diff: true, snapshot: true, slice: true });
        expect(frames.find((f) => f.requestId === 'slice-1')?.type).toBe('scan_done');
        const asymDone = frames.find((f) => f.requestId === 'asym-1');
        expect(asymDone?.message ?? asymDone?.type).toBe('scan_done');
        const snapDone = frames.find((f) => f.requestId === 'snap-1');
        expect(snapDone?.type).toBe('scan_done');
        expect((snapDone?.stats as Record<string, unknown>)?.snapshotEntries).toBe(1);
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        await server.shutdown('unit-test');
        await new Promise((resolve) => setImmediate(resolve));
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('gracefully drains stdio daemon and exits cleanly on stdin EOF with --keep-alive', async () => {
        const distServerPath = path.resolve(__dirname, '../../../dist/daemon/server.js');
        if (!fs.existsSync(distServerPath)) throw new Error(`Missing daemon server at ${distServerPath}`);
        const { exitCode, stdout } = await runStdioEofChild(distServerPath, scratchRoot);
        expect(exitCode).toBe(0);
        const lines = stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(lines.some((msg) => msg.type === 'hello_ack')).toBe(true);
        expect(lines.some((msg) => msg.type === 'pong')).toBe(true);
    }, 20_000);
});
