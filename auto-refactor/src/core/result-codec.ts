/**
 * Module: Core Engine — Binary Result Transport Codec
 * File Path: src/core/result-codec.ts
 * Architecture Role: Opt-in serializer between worker.ts (encode) and analyzer.ts (decode)
 *     for the RESULT direction only; task dispatch keeps its zero-copy Buffer transfer.
 * Dependencies & Triggers: ./types (Issue, FileMetric); armed by AR_BINARY_RESULT=1 through
 *     BINARY_RESULT_ENABLED, so worker postMessage and parent result handling switch codec.
 * Responsibilities: Provide Writer/Reader primitives (u8/u32/f64/varint/UTF-8 string/tagged
 *     value); encodeResults emits the 0x50523530 ("P250") magic plus per-file metrics, issue
 *     records, positions, detail and suggestions; decodeResults rebuilds that exact graph.
 * Exit Semantics & Design Rationale: encodeResults is total for JSON-representable results;
 *     decodeResults throws Error on bad magic, unknown type tag or varint overflow, which is
 *     the intended hard gate — insertion-order-preserving tagged values make the binary shape
 *     match structured clone, and the default-off flag keeps the proven path untouched.
 *
 * P2-5 result codec — compact binary worker→main result transport.
 *
 * Gated by AR_BINARY_RESULT=1 (default off). Only the RESULT direction is encoded
 * (worker → main postMessage); the task-dispatch direction keeps its zero-copy Buffer
 * transfer. Byte-equivalence is the hard gate: decode must reproduce the exact object
 * graph that structured clone would have delivered (validate 9/9 + W1-W9 + round-trip).
 *
 * Format (little-endian):
 *   Header : u32 magic(0x50523530 "P250")  u32 fileCount
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
 */
import type { Issue, FileMetric } from './types';

/**
 * Whether binary result transport is armed for the current process.
 *
 * Read once from `AR_BINARY_RESULT` at module load: the literal `'1'` enables the Writer/Reader
 * codec for worker-to-main result messages, while any other value keeps the structured-clone
 * path. The flag stays constant for the lifetime of the process.
 */
export const BINARY_RESULT_ENABLED = process.env.AR_BINARY_RESULT === '1';

const MAGIC = 0x50523530; // "P250"
const T_NULL = 0x00;
const T_TRUE = 0x01;
const T_FALSE = 0x02;
const T_INT = 0x03;
const T_FLOAT = 0x04;
const T_STRING = 0x05;
const T_ARRAY = 0x06;
const T_OBJECT = 0x07;

type FileResult = { file: string; issues: Issue[]; metric: FileMetric | null };

// ── Binary protocol constants (little-endian P250 transport) ──
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
 * Growable little-endian binary writer backing the P250 result transport.
 *
 * Scalars, unsigned varints, UTF-8 strings, and tagged JSON values are appended into 64 KiB
 * chunks; `result()` flushes the tail and concatenates the chunks into one Buffer. The writer is
 * single-use and not thread-safe: one instance belongs to exactly one encodeResults call.
 */
class Writer {
    private chunks: Buffer[] = [];
    private cur = Buffer.allocUnsafe(CHUNK_BYTES);
    private pos = 0;

    private flush(): void {
        this.chunks.push(this.cur.subarray(0, this.pos));
        this.cur = Buffer.allocUnsafe(CHUNK_BYTES);
        this.pos = 0;
    }

    u8(v: number): void {
        if (this.pos + 1 > this.cur.length) this.flush();
        this.cur[this.pos++] = v & U8_MASK;
    }

    u32(v: number): void {
        if (this.pos + U32_BYTES > this.cur.length) this.flush();
        this.cur.writeUInt32LE(v >>> 0, this.pos);
        this.pos += U32_BYTES;
    }

    f64(v: number): void {
        if (this.pos + F64_BYTES > this.cur.length) this.flush();
        this.cur.writeDoubleLE(v, this.pos);
        this.pos += F64_BYTES;
    }

    /** unsigned varint (up to 2^53-1 → ≤ 8 bytes). */
    varint(n: number): void {
        let v = Math.floor(n);
        if (v < 0) v = 0;
        while (v >= VARINT_CONTINUATION_BIT) {
            this.u8((v & VARINT_PAYLOAD_MASK) | VARINT_CONTINUATION_BIT);
            v = Math.floor(v / VARINT_RADIX);
        }
        this.u8(v);
    }

    str(s: string): void {
        const byteLen = Buffer.byteLength(s, 'utf8');
        this.varint(byteLen);
        if (byteLen === 0) return;

        if (this.pos + byteLen <= this.cur.length) {
            // Fast path: direct write into chunk with 0 intermediate Buffer allocation
            this.cur.write(s, this.pos, byteLen, 'utf8');
            this.pos += byteLen;
        } else {
            // Chunk boundary overflow fallback
            const b = Buffer.from(s, 'utf8');
            let off = 0;
            while (off < b.length) {
                const n = Math.min(b.length - off, this.cur.length - this.pos);
                if (n === 0) {
                    this.flush();
                    continue;
                }
                b.copy(this.cur, this.pos, off, off + n);
                this.pos += n;
                off += n;
            }
        }
    }

    /** tagged JSON value — preserves key insertion order, arrays, ints/floats, non-ASCII. */
    value(v: unknown): void {
        if (v === null || v === undefined) {
            this.u8(T_NULL);
        } else if (v === true) {
            this.u8(T_TRUE);
        } else if (v === false) {
            this.u8(T_FALSE);
        } else if (typeof v === 'number') {
            if (Number.isInteger(v) && Math.abs(v) < VARINT_SAFE_LIMIT) {
                this.u8(T_INT);
                // zigzag
                this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
            } else {
                this.u8(T_FLOAT);
                this.f64(v);
            }
        } else if (typeof v === 'string') {
            this.u8(T_STRING);
            this.str(v);
        } else if (Array.isArray(v)) {
            this.u8(T_ARRAY);
            this.varint(v.length);
            for (const item of v) this.value(item);
        } else if (typeof v === 'object') {
            this.u8(T_OBJECT);
            const keys = Object.keys(v as Record<string, unknown>);
            this.varint(keys.length);
            for (const k of keys) {
                this.str(k);
                this.value((v as Record<string, unknown>)[k]);
            }
        } else {
            // function / symbol / bigint — never produced by built-in analyzers; safest fallback.
            this.u8(T_STRING);
            this.str(String(v));
        }
    }

    result(): Buffer {
        this.flush();
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
    private pos = 0;
    constructor(private buf: Buffer) {}

    u8(): number {
        return this.buf[this.pos++];
    }
    u32(): number {
        const v = this.buf.readUInt32LE(this.pos);
        this.pos += U32_BYTES;
        return v;
    }
    f64(): number {
        const v = this.buf.readDoubleLE(this.pos);
        this.pos += F64_BYTES;
        return v;
    }
    varint(): number {
        let v = 0;
        let shift = 0;
        for (;;) {
            const b = this.buf[this.pos++];
            if (shift < VARINT_FAST_PATH_SHIFT) {
                v += (b & VARINT_PAYLOAD_MASK) << shift;
            } else {
                v += (b & VARINT_PAYLOAD_MASK) * Math.pow(2, shift);
            }
            if ((b & VARINT_CONTINUATION_BIT) === 0) break;
            shift += VARINT_SHIFT_STEP;
            if (shift > VARINT_MAX_SHIFT) throw new Error('resultCodec: varint overflow');
        }
        return v;
    }
    str(): string {
        const len = this.varint();
        const s = this.buf.toString('utf8', this.pos, this.pos + len);
        this.pos += len;
        return s;
    }
    value(): unknown {
        const t = this.u8();
        switch (t) {
            case T_NULL:
                return null;
            case T_TRUE:
                return true;
            case T_FALSE:
                return false;
            case T_INT: {
                const z = this.varint();
                return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
            }
            case T_FLOAT:
                return this.f64();
            case T_STRING:
                return this.str();
            case T_ARRAY: {
                const n = this.varint();
                const arr: unknown[] = new Array(n);
                for (let i = 0; i < n; i++) arr[i] = this.value();
                return arr;
            }
            case T_OBJECT: {
                const n = this.varint();
                const o: Record<string, unknown> = {};
                for (let i = 0; i < n; i++) {
                    const k = this.str();
                    o[k] = this.value();
                }
                return o;
            }
            default:
                throw new Error(`resultCodec: bad type tag 0x${t.toString(HEX_RADIX)}`);
        }
    }
}

/**
 * Encode a batch of per-file results into the P250 binary transport buffer.
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
    const w = new Writer();
    w.u32(MAGIC);
    w.u32(results.length);
    for (const r of results) {
        w.str(r.file);
        const m = r.metric;
        if (m) {
            w.u8(1);
            w.varint(m.lines);
            w.varint(m.nonBlankLines);
            w.varint(m.functions);
            w.varint(m.maxNestingDepth);
            w.varint(m.topLevelDeclarations);
            w.varint(m.exportedSymbols);
        } else {
            w.u8(0);
        }
        w.varint(r.issues.length);
        for (const i of r.issues) {
            w.str(i.id);
            w.str(i.analyzer);
            w.str(i.rule);
            w.u8(i.severity === 'info' ? 0 : i.severity === 'warning' ? 1 : 2);
            w.str(i.message);
            w.str(i.location.file);
            w.varint(i.location.start.line);
            w.varint(i.location.start.column);
            w.varint(i.location.end.line);
            w.varint(i.location.end.column);
            w.value(i.detail);
            if (i.suggestion !== undefined) {
                w.u8(1);
                w.str(i.suggestion);
            } else {
                w.u8(0);
            }
            if (i.actionable !== undefined) {
                w.u8(1);
                w.value(i.actionable);
            } else {
                w.u8(0);
            }
        }
    }
    return w.result();
}

/**
 * Decode a P250 buffer back into the exact per-file result shape.
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
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    const r = new Reader(b);
    const magic = r.u32();
    if (magic !== MAGIC) throw new Error('resultCodec: bad magic');
    const n = r.u32();
    const out: FileResult[] = new Array(n);
    for (let f = 0; f < n; f++) {
        const file = r.str();
        const hasMetric = r.u8();
        let metric: FileMetric | null = null;
        if (hasMetric) {
            metric = {
                file,
                lines: r.varint(),
                nonBlankLines: r.varint(),
                functions: r.varint(),
                maxNestingDepth: r.varint(),
                topLevelDeclarations: r.varint(),
                exportedSymbols: r.varint(),
            };
        }
        const issueCount = r.varint();
        const issues: Issue[] = new Array(issueCount);
        for (let k = 0; k < issueCount; k++) {
            const id = r.str();
            const analyzer = r.str();
            const rule = r.str();
            const sev = r.u8();
            const message = r.str();
            const locFile = r.str();
            const startLine = r.varint();
            const startCol = r.varint();
            const endLine = r.varint();
            const endCol = r.varint();
            const detail = r.value() as Record<string, unknown>;
            const hasSug = r.u8();
            const suggestion = hasSug ? r.str() : undefined;
            const hasAct = r.u8();
            const actionable = hasAct ? (r.value() as any) : undefined;
            issues[k] = {
                id,
                analyzer,
                rule,
                severity: sev === 0 ? 'info' : sev === 1 ? 'warning' : 'error',
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
        out[f] = { file, issues, metric };
    }
    return out;
}
