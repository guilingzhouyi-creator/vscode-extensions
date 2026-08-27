/**
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

class Writer {
  private chunks: Buffer[] = [];
  private cur = Buffer.allocUnsafe(1 << 16);
  private pos = 0;

  private flush(): void {
    this.chunks.push(this.cur.subarray(0, this.pos));
    this.cur = Buffer.allocUnsafe(1 << 16);
    this.pos = 0;
  }

  u8(v: number): void {
    if (this.pos + 1 > this.cur.length) this.flush();
    this.cur[this.pos++] = v & 0xff;
  }

  u32(v: number): void {
    if (this.pos + 4 > this.cur.length) this.flush();
    this.cur.writeUInt32LE(v >>> 0, this.pos);
    this.pos += 4;
  }

  f64(v: number): void {
    if (this.pos + 8 > this.cur.length) this.flush();
    this.cur.writeDoubleLE(v, this.pos);
    this.pos += 8;
  }

  /** unsigned varint (up to 2^53-1 → ≤ 8 bytes). */
  varint(n: number): void {
    let v = Math.floor(n);
    if (v < 0) v = 0;
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.u8(v);
  }

  str(s: string): void {
    const b = Buffer.from(s, 'utf8');
    this.varint(b.length);
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

  /** tagged JSON value — preserves key insertion order, arrays, ints/floats, non-ASCII. */
  value(v: unknown): void {
    if (v === null || v === undefined) {
      this.u8(T_NULL);
    } else if (v === true) {
      this.u8(T_TRUE);
    } else if (v === false) {
      this.u8(T_FALSE);
    } else if (typeof v === 'number') {
      if (Number.isInteger(v) && Math.abs(v) < 0x20000000000000) {
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

class Reader {
  private pos = 0;
  constructor(private buf: Buffer) {}

  u8(): number {
    return this.buf[this.pos++];
  }
  u32(): number {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  f64(): number {
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }
  varint(): number {
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = this.buf[this.pos++];
      v += (b & 0x7f) * Math.pow(2, shift);
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 60) throw new Error('resultCodec: varint overflow');
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
      case T_NULL: return null;
      case T_TRUE: return true;
      case T_FALSE: return false;
      case T_INT: {
        const z = this.varint();
        return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
      }
      case T_FLOAT: return this.f64();
      case T_STRING: return this.str();
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
      default: throw new Error(`resultCodec: bad type tag 0x${t.toString(16)}`);
    }
  }
}

/** Encode a batch of per-file results into one binary Buffer. */
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
    }
  }
  return w.result();
}

/** Decode a binary Buffer back into the exact result array shape. */
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
      };
    }
    out[f] = { file, issues, metric };
  }
  return out;
}
