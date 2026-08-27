#!/usr/bin/env node
/**
 * Validation Suite for Praxis Foundation & High-Performance Diff System.
 *
 * Tests:
 * 1. Hash-accelerated Myers diff line hashing and operation correctness
 * 2. Detailed ReviewDiffHunk computation with line-level context
 * 3. Praxis SPI hooks injection & threshold escalation
 * 4. Human-facing CircularDiffBuffer capacity, snapshot, and R4 binary eviction
 * 5. scanDiffStream async event streaming pipeline
 * 6. Atomic Hunk reversal and multi-file TaskCard rollback engine
 */

const assert = require('node:assert');
const path = require('node:path');

const {
  myersDiff,
  fnv1a32,
  hashLines,
  computeDetailedHunks,
  scanDiffStream,
  CircularDiffBuffer,
  revertDiffHunk,
  revertTaskCard,
  PraxisRollbackEngine,
  createDefaultPraxisHooks,
} = require('../dist/api');

async function main() {
  console.log('🧪 Starting Praxis Foundation & High-Performance Diff Validation...\n');

  // ---- TEST 1: Hash-Based Myers & FNV-1a ----
  {
    const lineA = 'function calculateTotal(items) {';
    const lineB = 'function calculateTotal(items) {';
    const lineC = 'function calculateTotal(records) {';

    assert.strictEqual(fnv1a32(lineA), fnv1a32(lineB), 'Identical strings must have identical FNV-1a hash');
    assert.notStrictEqual(fnv1a32(lineA), fnv1a32(lineC), 'Different strings must produce different hashes');

    const linesA = ['const a = 1;', 'const b = 2;', 'const c = 3;'];
    const linesB = ['const a = 1;', 'const b = 20;', 'const c = 3;', 'const d = 4;'];
    const hashesA = hashLines(linesA);
    const hashesB = hashLines(linesB);
    assert.strictEqual(hashesA.length, 3);
    assert.strictEqual(hashesB.length, 4);

    const ops = myersDiff(linesA, linesB);
    assert.ok(ops.length > 0, 'Myers diff must produce operations');
    const delOps = ops.filter((o) => o.type === 'delete');
    const insOps = ops.filter((o) => o.type === 'insert');
    assert.strictEqual(delOps.length, 1, 'Should have 1 deletion');
    assert.strictEqual(insOps.length, 2, 'Should have 2 insertions');
    console.log('PASS 1: Hash-accelerated Myers & FNV-1a hashing');
  }

  // ---- TEST 2: Detailed ReviewDiffHunk Generation ----
  {
    const oldText = 'line1\nline2\nline3\nline4\nline5';
    const newText = 'line1\nline2_mod\nline3\nline4\nline5_mod';
    const hunks = computeDetailedHunks(oldText, newText, 1);

    assert.ok(hunks.length >= 1, 'Should compute detailed hunks');
    const firstHunk = hunks[0];
    assert.ok(firstHunk.header.startsWith('@@'), 'Hunk header must start with @@');
    assert.ok(firstHunk.lines.length > 0, 'Hunk must contain attributed lines');
    console.log('PASS 2: Detailed ReviewDiffHunk generation with headers and line numbers');
  }

  // ---- TEST 3: Human-Facing CircularDiffBuffer & R4 Binary Eviction ----
  {
    let r4EvictedPayload = null;
    let r4ArchiveId = null;

    const ring = new CircularDiffBuffer({
      capacity: 3,
      flushIntervalMs: 0,
      storageAdapter: {
        appendDiffChunk: () => {},
        flushPeriodicSnapshot: () => {},
        evictToR4Archive: (payload) => {
          r4EvictedPayload = payload;
          return { archiveId: 'r4-test-archive-001' };
        },
      },
      onEvictToR4: (_payload, id) => {
        r4ArchiveId = id;
      },
    });

    const makeDummyHunk = (id) => ({
      hunkId: `hunk-${id}`,
      header: `@@ -${id},1 +${id},1 @@`,
      oldSpan: { startLine: id, lineCount: 1 },
      newSpan: { startLine: id, lineCount: 1 },
      lines: [{ type: 'insert', lineNoNew: id, content: `new content ${id}` }],
    });

    ring.push(makeDummyHunk(1));
    ring.push(makeDummyHunk(2));
    ring.push(makeDummyHunk(3));
    assert.strictEqual(ring.size(), 3);

    // Push 4th element -> triggers eviction of hunk-1
    ring.push(makeDummyHunk(4));
    assert.strictEqual(ring.size(), 3);
    assert.ok(r4EvictedPayload instanceof Uint8Array, 'Evicted item must be serialized to Uint8Array for R4');
    assert.strictEqual(r4ArchiveId, 'r4-test-archive-001');

    const activeHunks = ring.toArray();
    assert.strictEqual(activeHunks[0].hunkId, 'hunk-2');
    assert.strictEqual(activeHunks[2].hunkId, 'hunk-4');

    ring.dispose();
    console.log('PASS 3: CircularDiffBuffer capacity control & R4 binary eviction');
  }

  // ---- TEST 4: Praxis SPI Hooks & Threshold Policy ----
  {
    const hooks = createDefaultPraxisHooks();
    const hunk = {
      hunkId: 'hunk-threshold-test',
      header: '@@ -1,5 +1,150 @@',
      oldSpan: { startLine: 1, lineCount: 5 },
      newSpan: { startLine: 1, lineCount: 150 },
      lines: Array.from({ length: 120 }, (_, i) => ({
        type: 'insert',
        lineNoNew: i + 1,
        content: `inserted line ${i + 1}`,
      })),
    };

    const enriched = hooks.contextEnricher.enrichHunk('test.ts', hunk);
    const verdict = hooks.thresholdPolicy.evaluateChange('test.ts', hunk, enriched);

    assert.strictEqual(verdict.isMajorChange, true, 'Large change must be flagged as major');
    assert.strictEqual(verdict.shouldEscalateToL3A, true, 'Major change must trigger L3A escalation');
    console.log('PASS 4: Praxis SPI hooks & bypass threshold escalation');
  }

  // ---- TEST 5: scanDiffStream Reactive Async Event Pipeline ----
  {
    const diffInputs = [
      {
        kind: 'full',
        filePath: 'src/sample.ts',
        oldContent: 'const a = 1;\nconst b = 2;\n',
        newContent: 'const a = 100;\nconst b = 2;\n',
        oldContentHash: 'hash-old',
        newContentHash: 'hash-new',
      },
    ];

    const events = [];
    for await (const ev of scanDiffStream(diffInputs, { praxisHooks: createDefaultPraxisHooks() })) {
      events.push(ev);
    }

    const types = events.map((e) => e.type);
    assert.ok(types.includes('file_start'), 'Must emit file_start');
    assert.ok(types.includes('hunk_ready'), 'Must emit hunk_ready');
    assert.ok(types.includes('file_done'), 'Must emit file_done');
    assert.ok(types.includes('stream_end'), 'Must emit stream_end');
    console.log('PASS 5: scanDiffStream reactive asynchronous event stream');
  }

  // ---- TEST 6: Atomic Hunk Inversion & TaskCard Cascading Rollback ----
  {
    const originalContent = 'header\nline_old\nfooter';
    const modifiedContent = 'header\nline_new_inserted\nfooter';
    const hunk = computeDetailedHunks(originalContent, modifiedContent)[0];

    const revertRes = revertDiffHunk(modifiedContent, hunk);
    assert.strictEqual(revertRes.success, true);
    assert.strictEqual(revertRes.updatedContent, originalContent, 'Reverting hunk must restore exact original content');

    // Test Multi-File TaskCard Rollback
    const cardId = 'card-task-42';
    hunk.lines.forEach((l) => {
      l.attribution = {
        cardId,
        cellId: 'cell-alpha',
        agentUid: 'agent-build-1',
        checkpointId: 'chk-99',
      };
    });

    const fileMap = new Map([['src/file1.ts', modifiedContent]]);
    const hunksMap = new Map([['src/file1.ts', [hunk]]]);

    const cardRollbackRes = revertTaskCard(fileMap, cardId, hunksMap);
    assert.strictEqual(cardRollbackRes.success, true);
    assert.deepStrictEqual(cardRollbackRes.affectedFiles, ['src/file1.ts']);
    assert.deepStrictEqual(cardRollbackRes.rolledBackCheckpoints, ['chk-99']);
    assert.strictEqual(cardRollbackRes.updatedFiles.get('src/file1.ts'), originalContent);

    // Test PraxisRollbackEngine wrapper
    const engine = new PraxisRollbackEngine();
    engine.registerFileHunks('src/file1.ts', modifiedContent, [hunk]);
    const gateVerdict = engine.checkMergeGate('feat-branch', 'main', [hunk]);
    assert.strictEqual(gateVerdict.approved, true);

    console.log('PASS 6: Atomic hunk reversal & TaskCard multi-file rollback engine');
  }

  console.log('\n🎉 ALL PRAXIS FOUNDATION & HIGH-PERFORMANCE DIFF TESTS PASSED!\n');
}

main().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
