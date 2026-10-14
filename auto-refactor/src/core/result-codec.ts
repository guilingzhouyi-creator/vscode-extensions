/**
 * Module: Core Engine — Binary Result Transport Codec
 * File Path: src/core/result-codec.ts
 * Architecture Role: Opt-in serializer between worker.ts (encode) and analyzer.ts (decode)
 *     for the RESULT direction only; task dispatch keeps its zero-copy Buffer transfer.
 * Dependencies & Triggers: ./types (Issue, FileMetric); armed by AR_BINARY_RESULT=1 through
 *     BINARY_RESULT_ENABLED, so worker postMessage and parent result handling switch codec.
 * Responsibilities: Provide Writer/Reader primitives (u8/u32/f64/varint/UTF-8 string/tagged
 *     value); encodeResults emits the 0x50523530 ("PR50") magic plus per-file metrics, issue
 *     records, positions, detail and suggestions; decodeResults rebuilds that exact graph.
 * Exit Semantics & Design Rationale: encodeResults is total for JSON-representable results;
 *     decodeResults throws Error on bad magic, unknown type tag or varint overflow, which is
 *     the intended hard gate — insertion-order-preserving tagged values make the binary shape
 *     match structured clone, and the default-off flag keeps the proven path untouched.
 *
 * Compact binary worker-to-main result transport codec.
 *
 * Gated by AR_BINARY_RESULT=1 (default off). Only the RESULT direction is encoded
 * (worker → main postMessage); the task-dispatch direction keeps its zero-copy Buffer
 * transfer. Byte-equivalence is the hard gate: decode must reproduce the exact object
 * graph that structured clone would have delivered (verified by test suite
 * validation and round-trip checks).
 *
 * Format (little-endian):
 *   Header : u32 magic(0x50523530 "PR50")  u32 fileCount
 *   Per file:
 *     varint fileLen, file(UTF-8)
 *     u8 hasMetric; if 1: varint lines, nonBlankLines, functions, maxNestingDepth,
 *                    topLevelDeclarations, exportedSymbols
 *     varint issueCount
 *     Per issue:
 *       varint idLen, id · analyzer · rule (UTF-8)
 *       u8 severity (0=info 1=warning 2=error)
 *       varint messageLen, message
 *       varint locFileLen, locFile
 *       varint startLine, startCol, endLine, endCol
 *       <detail value>   (tagged JSON value, insertion-order-preserving)
 *       u8 hasSuggestion; if 1: varint suggLen, sugg
 *       u8 hasActionable; if 1: <actionable value>
 *     u8 hasSymbols; if 1: <symbols value>
 */
import type { Issue, FileMetric, Severity } from './types';
import { SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR } from './types';

/**
 * Whether binary result transport is armed for the current process.
 *
 * Read once from `AR_BINARY_RESULT` at module load: the literal `'1'` enables the Writer/Reader
 * codec for worker-to-main result messages, while any other value keeps the structured-clone
 * path. The flag stays constant for the lifetime of the process.
 */
export const BINARY_RESULT_ENABLED = process.env.AR_BINARY_RESULT === '1';

const MAGIC = 0x50523530; // "PR50"
const T_NULL = 0x00;
const T_TRUE = 0x01;
const T_FALSE = 0x02;
const T_INT = 0x03;
const T_FLOAT = 0x04;
const T_STRING = 0x05;
const T_ARRAY = 0x06;
const T_OBJECT = 0x07;

type FileResult = {
    file: string;
    issues: Issue[];
    metric: FileMetric | null;
    symbols?: unknown;
};

// ── Binary protocol constants (little-endian PR50 transport) ──
/** Growable chunk size: 2^16 bytes = 64 KiB. */
const CHUNK_SHIFT = 16;
const CHUNK_BYTES = 1 << CHUNK_SHIFT;
/** Fixed-width field sizes. */
const U32_BYTES = 4;
const F64_BYTES = 8;
/** Unsigned varint codec: 7 payload bits per byte, 0x80 marks "more bytes follow". */
const VARINT_PAYLOAD_MASK = 0x7f;
const VARINT_CONTINUATION_BIT = 0x80;
const VARINT_RADIX = 128;
const VARINT_SHIFT_STEP = 7;
/** JS bitwise ops only cover 28 bits; beyond that the decoder multiplies. */
const VARINT_FAST_PATH_SHIFT = 28;
const VARINT_MAX_SHIFT = 60;
/** Integers below 2^53 are exactly representable and take the zigzag fast path. */
const VARINT_SAFE_LIMIT = 0x20000000000000;
/** One unsigned octet mask. */
const U8_MASK = 0xff;
/** Radix used when rendering a hex type tag in diagnostics. */
const HEX_RADIX = 16;

/**
 * Growable little-endian binary writer backing the PR50 result transport.
 *
 * Scalars, unsigned varints, UTF-8 strings, and tagged JSON values are appended into 64 KiB
 * chunks; `buildResultBuffer()` flushes the tail and concatenates the chunks into one Buffer.
 * The writer is single-use and not thread-safe: one instance belongs to one encodeResults call.
 */
class Writer {
    private chunks: Buffer[] = [];
    private currentChunk = Buffer.allocUnsafe(CHUNK_BYTES);
    private position = 0;

    private flushCurrentChunk(): void {
        this.chunks.push(this.currentChunk.subarray(0, this.position));
        this.currentChunk = Buffer.allocUnsafe(CHUNK_BYTES);
        this.position = 0;
    }

    writeU8(byteValue: number): void {
        if (this.position + 1 > this.currentChunk.length) this.flushCurrentChunk();
        this.currentChunk[this.position++] = byteValue & U8_MASK;
    }

    writeU32(uint32Value: number): void {
        if (this.position + U32_BYTES > this.currentChunk.length) this.flushCurrentChunk();
        this.currentChunk.writeUInt32LE(uint32Value >>> 0, this.position);
        this.position += U32_BYTES;
    }

    writeFloat64(floatValue: number): void {
        if (this.position + F64_BYTES > this.currentChunk.length) this.flushCurrentChunk();
        this.currentChunk.writeDoubleLE(floatValue, this.position);
        this.position += F64_BYTES;
    }

    /** unsigned varint (up to 2^53-1 → ≤ 8 bytes). */
    writeVarint(numericValue: number): void {
        let numericPayload = Math.floor(numericValue);
        if (numericPayload < 0) numericPayload = 0;
        while (numericPayload >= VARINT_CONTINUATION_BIT) {
            this.writeU8((numericPayload & VARINT_PAYLOAD_MASK) | VARINT_CONTINUATION_BIT);
            numericPayload = Math.floor(numericPayload / VARINT_RADIX);
        }
        this.writeU8(numericPayload);
    }

    writeString(strValue: string): void {
        const byteLen = Buffer.byteLength(strValue, 'utf8');
        this.writeVarint(byteLen);
        if (byteLen === 0) return;

        if (this.position + byteLen <= this.currentChunk.length) {
            // Fast path: direct write into chunk with 0 intermediate Buffer allocation
            this.currentChunk.write(strValue, this.position, byteLen, 'utf8');
            this.position += byteLen;
        } else {
            // Chunk boundary overflow fallback
            const overflowBuffer = Buffer.from(strValue, 'utf8');
            let offset = 0;
            while (offset < overflowBuffer.length) {
                const chunkSliceLen = Math.min(
                    overflowBuffer.length - offset,
                    this.currentChunk.length - this.position,
                );
                if (chunkSliceLen === 0) {
                    this.flushCurrentChunk();
                    continue;
                }
                overflowBuffer.copy(
                    this.currentChunk,
                    this.position,
                    offset,
                    offset + chunkSliceLen,
                );
                this.position += chunkSliceLen;
                offset += chunkSliceLen;
            }
        }
    }

    writeNumber(numericTarget: number): void {
        if (Number.isInteger(numericTarget) && Math.abs(numericTarget) < VARINT_SAFE_LIMIT) {
            this.writeU8(T_INT);
            // zigzag
            this.writeVarint(numericTarget >= 0 ? numericTarget * 2 : -numericTarget * 2 - 1);
            return;
        }
        this.writeU8(T_FLOAT);
        this.writeFloat64(numericTarget);
    }

    writeArray(arrayValue: unknown[]): void {
        this.writeU8(T_ARRAY);
        this.writeVarint(arrayValue.length);
        for (const item of arrayValue) this.writeValue(item);
    }

    writeObject(objectValue: Record<string, unknown>): void {
        this.writeU8(T_OBJECT);
        const keys = Object.keys(objectValue);
        this.writeVarint(keys.length);
        for (const key of keys) {
            this.writeString(key);
            this.writeValue(objectValue[key]);
        }
    }

    /** tagged JSON value — preserves key insertion order, arrays, ints/floats, non-ASCII. */
    writeValue(payloadItem: unknown): void {
        if (payloadItem === null || payloadItem === undefined) {
            this.writeU8(T_NULL);
            return;
        }
        if (payloadItem === true) {
            this.writeU8(T_TRUE);
            return;
        }
        if (payloadItem === false) {
            this.writeU8(T_FALSE);
            return;
        }
        if (typeof payloadItem === 'number') {
            this.writeNumber(payloadItem);
            return;
        }
        if (typeof payloadItem === 'string') {
            this.writeU8(T_STRING);
            this.writeString(payloadItem);
            return;
        }
        if (Array.isArray(payloadItem)) {
            this.writeArray(payloadItem);
            return;
        }
        if (typeof payloadItem === 'object') {
            this.writeObject(payloadItem as Record<string, unknown>);
            return;
        }
        // function / symbol / bigint — never produced by built-in analyzers; safest fallback.
        this.writeU8(T_STRING);
        this.writeString(String(payloadItem));
    }

    buildResultBuffer(): Buffer {
        this.flushCurrentChunk();
        return Buffer.concat(this.chunks);
    }
}

/**
 * Sequential decoder for buffers emitted by {@link Writer}.
 *
 * Rebuilds the per-file result graph positionally, preserving tagged-value insertion order;
 * decoding never copies or mutates the input buffer, so callers must pass an untouched buffer
 * produced by encodeResults. Error semantics: an Error is thrown on bad magic, an unknown type
 * tag, or an over-long varint.
 */
class Reader {
    private position = 0;
    constructor(private readonly buffer: Buffer) {}

    readU8(): number {
        return this.buffer[this.position++];
    }
    readU32(): number {
        const uint32Result = this.buffer.readUInt32LE(this.position);
        this.position += U32_BYTES;
        return uint32Result;
    }
    readFloat64(): number {
        const floatResult = this.buffer.readDoubleLE(this.position);
        this.position += F64_BYTES;
        return floatResult;
    }
    readVarint(): number {
        let accumulatedValue = 0;
        let shift = 0;
        for (;;) {
            const byteValue = this.buffer[this.position++];
            if (shift < VARINT_FAST_PATH_SHIFT) {
                accumulatedValue += (byteValue & VARINT_PAYLOAD_MASK) << shift;
            } else {
                accumulatedValue += (byteValue & VARINT_PAYLOAD_MASK) * Math.pow(2, shift);
            }
            if ((byteValue & VARINT_CONTINUATION_BIT) === 0) break;
            shift += VARINT_SHIFT_STEP;
            if (shift > VARINT_MAX_SHIFT) throw new Error('resultCodec: varint overflow');
        }
        return accumulatedValue;
    }
    readString(): string {
        const len = this.readVarint();
        const stringValue = this.buffer.toString('utf8', this.position, this.position + len);
        this.position += len;
        return stringValue;
    }
    private readInt(): number {
        const encodedInt = this.readVarint();
        return encodedInt % 2 === 0 ? encodedInt / 2 : -(encodedInt + 1) / 2;
    }

    private readArray(): unknown[] {
        const itemCount = this.readVarint();
        const arr: unknown[] = [];
        for (let index = 0; index < itemCount; index++) {
            arr.push(this.readValue());
        }
        return arr;
    }

    private readObject(): Record<string, unknown> {
        const entryCount = this.readVarint();
        const resultObject: Record<string, unknown> = {};
        for (let index = 0; index < entryCount; index++) {
            const key = this.readString();
            resultObject[key] = this.readValue();
        }
        return resultObject;
    }

    readValue(): unknown {
        const typeTag = this.readU8();
        if (typeTag === T_NULL) return null;
        if (typeTag === T_TRUE) return true;
        if (typeTag === T_FALSE) return false;
        if (typeTag === T_INT) return this.readInt();
        if (typeTag === T_FLOAT) return this.readFloat64();
        if (typeTag === T_STRING) return this.readString();
        if (typeTag === T_ARRAY) return this.readArray();
        if (typeTag === T_OBJECT) return this.readObject();
        throw new Error(`resultCodec: bad type tag 0x${typeTag.toString(HEX_RADIX)}`);
    }
}

/**
 * Encode a batch of per-file results into the PR50 binary transport buffer.
 *
 * Writes the magic header and file count, then per file its path, optional metric, and every
 * issue field in order; detail values are emitted as tagged JSON so key insertion order survives
 * the round trip. The encoding is total for JSON-representable results and preserves the input
 * order, which keeps the binary shape equivalent to structured clone.
 *
 * @param results - Per-file results to encode; order is preserved in the emitted buffer.
 * @returns One Buffer containing the magic header followed by every file entry.
 */
export function encodeResults(results: FileResult[]): Buffer {
    const writer = new Writer();
    writer.writeU32(MAGIC);
    writer.writeU32(results.length);
    for (const fileResult of results) {
        writer.writeString(fileResult.file);
        const metric = fileResult.metric;
        if (metric) {
            writer.writeU8(1);
            writer.writeVarint(metric.lines);
            writer.writeVarint(metric.nonBlankLines);
            writer.writeVarint(metric.functions);
            writer.writeVarint(metric.maxNestingDepth);
            writer.writeVarint(metric.topLevelDeclarations);
            writer.writeVarint(metric.exportedSymbols);
        } else {
            writer.writeU8(0);
        }
        writer.writeVarint(fileResult.issues.length);
        for (const issue of fileResult.issues) {
            writer.writeString(issue.id);
            writer.writeString(issue.analyzer);
            writer.writeString(issue.rule);
            const severityCode =
                issue.severity === SEVERITY_INFO ? 0 : issue.severity === SEVERITY_WARNING ? 1 : 2;
            writer.writeU8(severityCode);
            writer.writeString(issue.message);
            writer.writeString(issue.location.file);
            writer.writeVarint(issue.location.start.line);
            writer.writeVarint(issue.location.start.column);
            writer.writeVarint(issue.location.end.line);
            writer.writeVarint(issue.location.end.column);
            writer.writeValue(issue.detail);
            if (issue.suggestion !== undefined) {
                writer.writeU8(1);
                writer.writeString(issue.suggestion);
            } else {
                writer.writeU8(0);
            }
            if (issue.actionable !== undefined) {
                writer.writeU8(1);
                writer.writeValue(issue.actionable);
            } else {
                writer.writeU8(0);
            }
        }
        if (fileResult.symbols) {
            writer.writeU8(1);
            writer.writeValue(fileResult.symbols);
        } else {
            writer.writeU8(0);
        }
    }
    return writer.buildResultBuffer();
}

function decodeMetric(reader: Reader, file: string): FileMetric | null {
    const hasMetric = reader.readU8();
    if (!hasMetric) return null;
    return {
        file,
        lines: reader.readVarint(),
        nonBlankLines: reader.readVarint(),
        functions: reader.readVarint(),
        maxNestingDepth: reader.readVarint(),
        topLevelDeclarations: reader.readVarint(),
        exportedSymbols: reader.readVarint(),
    };
}

const SEVERITY_BY_CODE = [SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR] as const;

function decodeSeverity(severityCode: number): Severity {
    return SEVERITY_BY_CODE[severityCode] ?? SEVERITY_ERROR;
}

function decodeSingleIssue(reader: Reader): Issue {
    const id = reader.readString();
    const analyzer = reader.readString();
    const rule = reader.readString();
    const severityCode = reader.readU8();
    const message = reader.readString();
    const locFile = reader.readString();
    const startLine = reader.readVarint();
    const startCol = reader.readVarint();
    const endLine = reader.readVarint();
    const endCol = reader.readVarint();
    const detail = reader.readValue() as Record<string, unknown>;
    const hasSuggestion = reader.readU8();
    const suggestion = hasSuggestion ? reader.readString() : undefined;
    const hasActionable = reader.readU8();
    const actionable = hasActionable ? (reader.readValue() as Issue['actionable']) : undefined;
    return {
        id,
        analyzer,
        rule,
        severity: decodeSeverity(severityCode),
        message,
        location: {
            file: locFile,
            start: { line: startLine, column: startCol },
            end: { line: endLine, column: endCol },
        },
        detail,
        ...(suggestion !== undefined ? { suggestion } : {}),
        ...(actionable !== undefined ? { actionable } : {}),
    };
}

function decodeFileIssues(reader: Reader): Issue[] {
    const issueCount = reader.readVarint();
    const issues: Issue[] = [];
    for (let index = 0; index < issueCount; index++) {
        issues.push(decodeSingleIssue(reader));
    }
    return issues;
}

function decodeSingleFileResult(reader: Reader): FileResult {
    const file = reader.readString();
    const metric = decodeMetric(reader, file);
    const issues = decodeFileIssues(reader);
    const hasSymbols = reader.readU8();
    const symbols = hasSymbols ? reader.readValue() : undefined;
    return {
        file,
        issues,
        metric,
        ...(symbols !== undefined ? { symbols } : {}),
    };
}

/**
 * Decode a PR50 buffer back into the exact per-file result shape.
 *
 * The inverse of encodeResults: it rebuilds metrics, issue locations, severities, and tagged
 * detail values in insertion order without mutating the input. The reader walks the buffer
 * positionally, so a truncated or foreign payload fails fast instead of yielding partial data.
 *
 * @param buf - Buffer or Uint8Array produced by encodeResults; consumed positionally, not copied.
 * @returns The decoded per-file results in the same order they were encoded.
 * @throws Error when the magic header is wrong, a type tag is unknown, or a varint overflows.
 */
export function decodeResults(buf: Buffer | Uint8Array): FileResult[] {
    const sourceBuffer = Buffer.isBuffer(buf)
        ? buf
        : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    const reader = new Reader(sourceBuffer);
    const magic = reader.readU32();
    if (magic !== MAGIC) throw new Error('resultCodec: bad magic');
    const fileCount = reader.readU32();
    const out: FileResult[] = [];
    for (let index = 0; index < fileCount; index++) {
        out.push(decodeSingleFileResult(reader));
    }
    return out;
}
