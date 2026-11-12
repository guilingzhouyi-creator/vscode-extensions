/**
 * Module: Unit Test — Daemon Server Crash & Backpressure Safety
 * File Path: tests/unit/daemon/server-safety.test.ts
 * Architecture Role: Verifies incoming frame/buffer limits, socket drain backpressure queuing,
 *   WorkerPool rssGuard invocation, and lastFlushError visibility on DaemonServer.
 * Dependencies & Triggers: Consumes DaemonServer, handleScan/handleScanDiff, and Vitest mocks;
 *   runs in Vitest unit runs.
 * Responsibilities: Prove transport overflow closes before OOM, backpressured writes queue FIFO
 *   until drain, rssGuard executes on request completion/idle, and lastFlushError surfaces.
 * Exit Semantics & Design Rationale: Deterministic unit assertions without spawning real processes.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonServer } from '../../../src/daemon/server';
import * as scanHandlerModule from '../../../src/daemon/scanHandler';
import type { ScanReport, WarmStats } from '../../../src/core/types';

const TEST_FRAME_LIMIT = 256;
const TEST_BUFFER_LIMIT = 512;

class MockSocket extends EventEmitter {
    public destroyed = false;
    public writable = true;
    public pauseCount = 0;
    public resumeCount = 0;
    public returnFalseNextWrite = false;
    public writtenChunks: string[] = [];

    setEncoding(_enc: string): this {
        void _enc;
        return this;
    }

    pause(): this {
        this.pauseCount++;
        return this;
    }

    resume(): this {
        this.resumeCount++;
        return this;
    }

    write(chunk: string): boolean {
        this.writtenChunks.push(chunk);
        if (this.returnFalseNextWrite) {
            this.returnFalseNextWrite = false;
            return false;
        }
        return true;
    }

    destroy(): this {
        this.destroyed = true;
        this.writable = false;
        this.emit('close');
        return this;
    }
}

describe('DaemonServer crash-safety & backpressure guards', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-safety-test-'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('rejects oversized unframed buffers and oversized frames before unbounded allocation', () => {
        const server = new DaemonServer(tempDir, {
            stdio: true,
            maxFrameBytes: TEST_FRAME_LIMIT,
            maxBufferBytes: TEST_BUFFER_LIMIT,
        });
        const handleConn = (server as unknown as { handleConnection: (s: MockSocket) => void })
            .handleConnection;

        const frameSocket = new MockSocket();
        handleConn.call(server, frameSocket);
        frameSocket.emit(
            'data',
            JSON.stringify({ v: 1, id: 1, pad: 'x'.repeat(TEST_FRAME_LIMIT + 32) }) + '\n',
        );
        expect(frameSocket.destroyed).toBe(true);
        expect(frameSocket.writtenChunks.join('')).toContain('FRAME_TOO_LARGE');

        const bufSocket = new MockSocket();
        handleConn.call(server, bufSocket);
        bufSocket.emit('data', 'a'.repeat(TEST_FRAME_LIMIT));
        bufSocket.emit('data', 'b'.repeat(TEST_BUFFER_LIMIT));
        expect(bufSocket.destroyed).toBe(true);
        expect(bufSocket.writtenChunks.join('')).toContain('BUFFER_OVERFLOW');
    });

    it('queues outbound daemon frames FIFO on write backpressure until drain', () => {
        const server = new DaemonServer(tempDir, { stdio: true });
        const handleConn = (server as unknown as { handleConnection: (s: MockSocket) => void })
            .handleConnection;
        const socket = new MockSocket();
        handleConn.call(server, socket);

        socket.returnFalseNextWrite = true;
        socket.emit('data', JSON.stringify({ v: 1, id: 1, type: 'ping' }) + '\n');
        socket.emit('data', JSON.stringify({ v: 1, id: 2, type: 'ping' }) + '\n');
        socket.emit('data', JSON.stringify({ v: 1, id: 3, type: 'ping' }) + '\n');

        expect(socket.pauseCount).toBe(1);
        expect(socket.writtenChunks).toHaveLength(1);
        expect(JSON.parse(socket.writtenChunks[0]).id).toBe(1);

        socket.emit('drain');
        expect(socket.resumeCount).toBe(1);
        expect(socket.writtenChunks).toHaveLength(3);
        expect(socket.writtenChunks.map((chunk) => JSON.parse(chunk).id)).toEqual([1, 2, 3]);
    });

    it('calls WorkerPool.rssGuard() and surfaces lastFlushError in scan_done, pong, and getStatus()', async () => {
        const server = new DaemonServer(tempDir, { stdio: true });
        const rssGuardSpy = vi.spyOn(server.ctx.pools, 'rssGuard').mockImplementation(() => {});

        const fakeReport = {
            summary: { filesScanned: 1, issuesTotal: 0, bySeverity: {}, byAnalyzer: {} },
            issues: [],
            fileMetrics: [],
        } as unknown as ScanReport;
        const fakeStats = { cacheHits: 1 } as unknown as WarmStats;
        vi.spyOn(scanHandlerModule, 'handleScan').mockResolvedValue({
            report: fakeReport,
            stats: fakeStats,
        });

        const cache = server.ctx.getCache(tempDir);
        cache.lastFlushError = new Error('simulated wal failure');

        const handleConn = (server as unknown as { handleConnection: (s: MockSocket) => void })
            .handleConnection;
        const socket = new MockSocket();
        handleConn.call(server, socket);

        socket.emit(
            'data',
            JSON.stringify({
                v: 1,
                id: 10,
                type: 'scan',
                params: {
                    requestId: 'req-flush-err',
                    config: { root: tempDir },
                    options: { cache: true },
                },
            }) + '\n',
        );

        await vi.waitFor(() => {
            expect(socket.writtenChunks.some((chunk) => chunk.includes('scan_done'))).toBe(true);
        });

        const scanDoneMsg = JSON.parse(
            socket.writtenChunks.find((chunk) => chunk.includes('scan_done'))!,
        );
        expect(scanDoneMsg.stats.lastFlushError).toBe('simulated wal failure');
        expect(rssGuardSpy).toHaveBeenCalled();

        socket.emit('data', JSON.stringify({ v: 1, id: 11, type: 'ping' }) + '\n');
        const pongMsg = JSON.parse(
            socket.writtenChunks.find((chunk) => chunk.includes('"type":"pong"'))!,
        );
        expect(pongMsg.lastFlushError).toBe('simulated wal failure');
        expect(server.getStatus().lastFlushError).toBe('simulated wal failure');
    });
});
