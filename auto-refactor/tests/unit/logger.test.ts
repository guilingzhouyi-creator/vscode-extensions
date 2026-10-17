/**
 * Module: Unit Test Suite — Logger & Diagnostic Primitives
 * File Path: tests/unit/logger.test.ts
 * Architecture Role: Full regression suite verifying Logger, LogRingBuffer, LogIoBarrier,
 *                    file rotation, level filtering, lazy evaluation, and Error stack extraction.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    Logger,
    LogRingBuffer,
    LogIoBarrier,
    AutoRefactorError,
    LOG_LEVELS,
    type LogLevel,
} from '../../src/core/logger';

describe('Logger & Diagnostic Primitives', () => {
    let tmpDir: string;
    let stderrSpy: ReturnType<typeof vi.spyOn>;
    let writtenStderr: string[] = [];

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-logger-test-'));
        writtenStderr = [];
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
            writtenStderr.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
            return true;
        });
    });

    afterEach(() => {
        stderrSpy.mockRestore();
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            /* ignore cleanup */
        }
    });

    describe('1. LOG_LEVELS & Probing API', () => {
        it('orders verbosity ranks strictly from silent (0) to debug (4)', () => {
            expect(LOG_LEVELS.silent).toBe(0);
            expect(LOG_LEVELS.error).toBe(1);
            expect(LOG_LEVELS.warn).toBe(2);
            expect(LOG_LEVELS.info).toBe(3);
            expect(LOG_LEVELS.debug).toBe(4);
        });

        it('reports level enablement correctly via probe methods', () => {
            const logger = new Logger('warn');
            expect(logger.isLevelEnabled('error')).toBe(true);
            expect(logger.isLevelEnabled('warn')).toBe(true);
            expect(logger.isLevelEnabled('info')).toBe(false);
            expect(logger.isLevelEnabled('debug')).toBe(false);

            expect(logger.isErrorEnabled()).toBe(true);
            expect(logger.isWarnEnabled()).toBe(true);
            expect(logger.isInfoEnabled()).toBe(false);
            expect(logger.isDebugEnabled()).toBe(false);

            logger.setLevel('debug');
            expect(logger.isDebugEnabled()).toBe(true);
            expect(logger.isInfoEnabled()).toBe(true);

            logger.setLevel('silent');
            expect(logger.isErrorEnabled()).toBe(false);
        });
    });

    describe('2. Level Filtering & Stderr Isolation', () => {
        it('drops messages ranked above configured threshold', () => {
            const logger = new Logger('warn');
            logger.debug('debug msg');
            logger.info('info msg');
            logger.warn('warn msg');
            logger.error('error msg');

            const output = writtenStderr.join('');
            expect(output).not.toContain('debug msg');
            expect(output).not.toContain('info msg');
            expect(output).toContain('WARN  warn msg');
            expect(output).toContain('ERROR error msg');
        });

        it('suppresses all messages when set to silent', () => {
            const logger = new Logger('silent');
            logger.error('error msg');
            logger.warn('warn msg');
            logger.info('info msg');
            logger.debug('debug msg');

            expect(writtenStderr.length).toBe(0);
        });
    });

    describe('3. Lazy Supplier Evaluation', () => {
        it('does not evaluate supplier function when level is disabled', () => {
            const logger = new Logger('info');
            const spy = vi.fn(() => 'expensive evaluation');

            logger.debug(spy);
            expect(spy).not.toHaveBeenCalled();
            expect(writtenStderr.length).toBe(0);
        });

        it('evaluates supplier function when level is enabled', () => {
            const logger = new Logger('debug');
            const spy = vi.fn(() => 'expensive evaluation');

            logger.debug(spy);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(writtenStderr.join('')).toContain('DEBUG expensive evaluation');
        });
    });

    describe('4. Error & Stack Trace Formatting', () => {
        it('extracts error message and stack trace on error level', () => {
            const logger = new Logger('error');
            const err = new Error('database connection timeout');

            logger.error('Operation failed', err);
            const output = writtenStderr.join('');

            expect(output).toContain('ERROR Operation failed [Error: database connection timeout]');
            expect(output).toContain('Error: database connection timeout');
            expect(output).toContain('database connection timeout');
        });

        it('extracts nested error cause recursively', () => {
            const logger = new Logger('error');
            const rootCause = new Error('socket ECONNREFUSED');
            const err = new Error('service unavailable', { cause: rootCause });

            logger.error('Gateway error', err);
            const output = writtenStderr.join('');

            expect(output).toContain('[Caused by]:');
            expect(output).toContain('socket ECONNREFUSED');
        });
    });

    describe('5. Structured Context Serialization', () => {
        it('appends structured context in text format', () => {
            const logger = new Logger('info');
            logger.info('Scanned file batch', { total: 42, cached: 30 });

            const output = writtenStderr.join('');
            expect(output).toContain('INFO  Scanned file batch [context: {"total":42,"cached":30}]');
        });

        it('handles circular references in context safely', () => {
            const logger = new Logger('info');
            const circular: Record<string, unknown> = { name: 'cycle' };
            circular.self = circular;

            logger.info('Circular state', circular);
            const output = writtenStderr.join('');
            expect(output).toContain('[context: [Circular]]');
        });
    });

    describe('6. Structured JSON-Lines Output', () => {
        it('emits single-line JSON records when format is json', () => {
            const logger = new Logger('info', undefined, { format: 'json' });
            logger.info('Pipeline finished', { durationMs: 125 });

            expect(writtenStderr.length).toBe(1);
            const parsed = JSON.parse(writtenStderr[0].trim());
            expect(parsed.level).toBe('info');
            expect(parsed.message).toBe('Pipeline finished');
            expect(parsed.context).toEqual({ durationMs: 125 });
            expect(parsed.timestamp).toBeDefined();
        });

        it('includes structured error payload in JSON output', () => {
            const logger = new Logger('error', undefined, { format: 'json' });
            const testErr = new TypeError('invalid type argument');

            logger.error('Type mismatch', testErr);
            const parsed = JSON.parse(writtenStderr[0].trim());
            expect(parsed.level).toBe('error');
            expect(parsed.message).toBe('Type mismatch');
            expect(parsed.error.name).toBe('TypeError');
            expect(parsed.error.message).toBe('invalid type argument');
            expect(parsed.error.stack).toBeDefined();
        });
    });

    describe('7. File Logging & ANSI Stripping', () => {
        it('strips ANSI terminal color codes before writing to disk', () => {
            const logPath = path.join(tmpDir, 'ansi-test.log');
            const logger = new Logger('info', logPath);

            logger.info('\u001b[32mSUCCESS\u001b[0m \u001b[31mFAILURE\u001b[0m plain text');
            logger.close();

            const fileContent = fs.readFileSync(logPath, 'utf8');
            expect(fileContent).toContain('SUCCESS FAILURE plain text');
            expect(fileContent).not.toContain('\u001b[');
        });
    });

    describe('8. LogRingBuffer Batching & Lifecycle', () => {
        it('flushes synchronously on close()', () => {
            const logPath = path.join(tmpDir, 'close-sync.log');
            const logger = new Logger('info', logPath);

            logger.info('Line 1');
            logger.info('Line 2');
            logger.close();

            const fileContent = fs.readFileSync(logPath, 'utf8');
            expect(fileContent).toContain('Line 1');
            expect(fileContent).toContain('Line 2');
        });

        it('automatically flushes when batch threshold of 128 is reached', async () => {
            const logPath = path.join(tmpDir, 'batch-128.log');
            const ring = new LogRingBuffer(logPath);

            for (let i = 0; i < 128; i++) {
                ring.push(`Batch line ${i}`);
            }

            // Yield event loop for async flush
            await new Promise((r) => setTimeout(r, 20));

            expect(fs.existsSync(logPath)).toBe(true);
            const content = fs.readFileSync(logPath, 'utf8');
            expect(content).toContain('Batch line 0');
            expect(content).toContain('Batch line 127');
        });

        it('flushes automatically via debounce timer after 50ms', async () => {
            const logPath = path.join(tmpDir, 'timer-debounce.log');
            const ring = new LogRingBuffer(logPath);

            ring.push('Timer line 1');
            expect(fs.existsSync(logPath)).toBe(false);

            await new Promise((r) => setTimeout(r, 80));

            expect(fs.existsSync(logPath)).toBe(true);
            const content = fs.readFileSync(logPath, 'utf8');
            expect(content).toContain('Timer line 1');
        });

        it('handles circular buffer wraparound past capacity safely', () => {
            const logPath = path.join(tmpDir, 'wraparound.log');
            const capacity = 10;
            const ring = new LogRingBuffer(logPath, { capacity });

            // Push 25 lines (exceeds capacity of 10)
            for (let i = 0; i < 25; i++) {
                ring.push(`Over capacity ${i}`);
            }

            ring.flushSync();
            const content = fs.readFileSync(logPath, 'utf8');
            // The ring buffer should have retained the latest 10 lines (15 to 24)
            expect(content).toContain('Over capacity 24');
            expect(content).toContain('Over capacity 15');
        });
    });

    describe('9. File Size Rotation & Archive Retention', () => {
        it('rotates log files when size exceeds maxBytesPerFile', () => {
            const logPath = path.join(tmpDir, 'rotation.log');
            // Small limit: 100 bytes
            const ring = new LogRingBuffer(logPath, {
                maxBytesPerFile: 100,
                maxRotatedFiles: 3,
            });

            // Write chunk 1 (~70 bytes)
            ring.push('First batch of log lines that occupies some bytes in the file.');
            ring.flushSync();
            expect(fs.existsSync(logPath)).toBe(true);
            expect(fs.existsSync(`${logPath}.1`)).toBe(false);

            // Write chunk 2 (~70 bytes -> exceeds 100 bytes)
            ring.push('Second batch of log lines that will trigger log file rotation.');
            ring.flushSync();

            // After rotation, rotation.log.1 must exist
            expect(fs.existsSync(`${logPath}.1`)).toBe(true);
            const rotatedContent = fs.readFileSync(`${logPath}.1`, 'utf8');
            expect(rotatedContent).toContain('First batch of log lines');

            const currentContent = fs.readFileSync(logPath, 'utf8');
            expect(currentContent).toContain('Second batch of log lines');
        });

        it('maintains maximum rotated file count by pruning older archives', () => {
            const logPath = path.join(tmpDir, 'prune-rotation.log');
            const ring = new LogRingBuffer(logPath, {
                maxBytesPerFile: 50,
                maxRotatedFiles: 2, // Only keep .log and .log.1
            });

            ring.push('Line 1 which fills the limit.');
            ring.flushSync();

            ring.push('Line 2 which causes rotation to .1.');
            ring.flushSync();

            ring.push('Line 3 which causes rotation to delete oldest.');
            ring.flushSync();

            expect(fs.existsSync(logPath)).toBe(true);
            expect(fs.existsSync(`${logPath}.1`)).toBe(true);
            expect(fs.existsSync(`${logPath}.2`)).toBe(false);
        });
    });

    describe('10. Fail-Soft Degradation & Error Resilience', () => {
        it('degrades to stderr warning when log directory cannot be created or written', () => {
            const invalidPath = path.join(tmpDir, 'unwritable-file.txt', 'sub', 'test.log');
            // Create a regular file where a directory is expected to cause ENOTDIR
            fs.writeFileSync(path.join(tmpDir, 'unwritable-file.txt'), 'blocking-file');

            const logger = new Logger('info', invalidPath);
            logger.info('Will fail to write to disk');
            logger.close();

            const output = writtenStderr.join('');
            expect(output).toContain('Will fail to write to disk');
        });

        it('LogIoBarrier isolates synchronous writes', () => {
            const barrierPath = path.join(tmpDir, 'barrier.log');
            LogIoBarrier.appendSync(barrierPath, 'Barrier direct line\n');

            const content = fs.readFileSync(barrierPath, 'utf8');
            expect(content).toBe('Barrier direct line\n');
        });
    });

    describe('11. AutoRefactorError Contract', () => {
        it('retains stable code and cause chaining', () => {
            const cause = new Error('underlying cause');
            const err = new AutoRefactorError('Config missing', 'CONFIG_INVALID', cause);

            expect(err).toBeInstanceOf(Error);
            expect(err).toBeInstanceOf(AutoRefactorError);
            expect(err.name).toBe('AutoRefactorError');
            expect(err.code).toBe('CONFIG_INVALID');
            expect(err.cause).toBe(cause);
            expect(err.message).toBe('Config missing');
        });

        it('defaults code to AUTO_REFACTOR_ERROR when omitted', () => {
            const err = new AutoRefactorError('generic error');
            expect(err.code).toBe('AUTO_REFACTOR_ERROR');
        });
    });
});

