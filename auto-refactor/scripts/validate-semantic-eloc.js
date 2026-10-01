/**
 * Module: Verification Harness — Semantic ELOC & Block Fingerprint De-duplication Tests
 * File Path: scripts/validate-semantic-eloc.js
 * Architecture Role: Verifies the four-tier orthogonal ELOC accounting space, AST block fingerprint
 *   de-duplication, and semantic delta classification (pure-semantic, pure-relocation, pure-cosmetic).
 * Dependencies & Triggers: Consumes dist/core trajectory and diff modules; executed in test-parallel.js.
 * Exit Semantics: Exits 0 on all assertions passed, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
    BlockFingerprintCache,
    computeNormalizedFingerprint,
    countBlockEloc,
    extractBlockFingerprints,
} = require('../dist/core/trajectory/block-fingerprint-cache');
const { classifySemanticDelta } = require('../dist/core/diff/semantic-delta-classifier');

function runTests() {
    console.log('🧪 Running Semantic ELOC & Block Fingerprint Validation Suite...');

    // --- Test 1: Fingerprint Normalization & Invariance ---
    console.log('  ▶ [Test 1] Testing AST block fingerprint comment and whitespace invariance...');
    const codeA = `
        function calculateTotal(items: number[]): number {
            // Compute the sum of items
            let sum = 0;
            for (const item of items) {
                sum += item;
            }
            return sum;
        }
    `;
    const codeB = `
        function calculateTotal(items: number[]): number {
            /* Block comment */
            let sum = 0;
            for (const item of items) {
                sum += item;
            }
            return sum;
        }
    `;
    const codeC = `
        function calculateTotal(items: number[]): number {
            let sum = 0;
            for (const item of items) {
                sum += item * 2; // altered logic
            }
            return sum;
        }
    `;

    const fpA = computeNormalizedFingerprint(codeA);
    const fpB = computeNormalizedFingerprint(codeB);
    const fpC = computeNormalizedFingerprint(codeC);

    assert.strictEqual(fpA, fpB, 'Fingerprint must be invariant to comments and formatting');
    assert.notStrictEqual(fpA, fpC, 'Fingerprint must change when semantic logic changes');
    console.log('    ✔ Fingerprint normalization verified');

    // --- Test 2: BlockFingerprintCache De-duplication ---
    console.log('  ▶ [Test 2] Testing unique ELOC de-duplication across multiple scans...');
    const cache = new BlockFingerprintCache();

    const blocks1 = extractBlockFingerprints('src/math.ts', codeA);
    const result1 = cache.recordAndDeduplicate(blocks1);

    assert.strictEqual(result1.newBlocksCount, 1, 'First scan should detect 1 new block');
    assert.strictEqual(result1.duplicateBlocksCount, 0, 'First scan should have 0 duplicates');
    assert.strictEqual(cache.getTotalUniqueEloc(), result1.uniqueElocIncrement);

    // Re-scan identical file (should NOT increment unique ELOC)
    const blocks2 = extractBlockFingerprints('src/math.ts', codeA);
    const result2 = cache.recordAndDeduplicate(blocks2);

    assert.strictEqual(result2.newBlocksCount, 0, 'Re-scan should detect 0 new blocks');
    assert.strictEqual(result2.duplicateBlocksCount, 1, 'Re-scan should detect 1 duplicate');
    assert.strictEqual(result2.uniqueElocIncrement, 0, 'Re-scan must have 0 unique ELOC increment');
    console.log('    ✔ Unique ELOC de-duplication verified');

    // --- Test 3: Pure Constant Relocation Classification ---
    console.log('  ▶ [Test 3] Testing pure constant relocation detection (semantic = 0, reloc > 0)...');
    const oldConstants = `
        export const MAX_RETRY = 5;
        export const TIMEOUT_MS = 3000;
        function helper() { return 42; }
    `;
    const newConstants = `
        function helper() { return 42; }
        export const MAX_RETRY = 5;
        export const TIMEOUT_MS = 3000;
    `;

    const deltaReloc = classifySemanticDelta('src/constants.ts', oldConstants, newConstants);
    assert.strictEqual(deltaReloc.category, 'pure-relocation', 'Moving constants must be classified as pure-relocation');
    assert.strictEqual(deltaReloc.counters.semantic, 0, 'Pure relocation must produce 0 semantic ELOC');
    assert.ok(deltaReloc.counters.relocated > 0, 'Relocated ELOC must be greater than 0');
    console.log('    ✔ Pure constant relocation verified');

    // --- Test 4: Pure Cosmetic / Comment / Formatting Changes ---
    console.log('  ▶ [Test 4] Testing pure cosmetic changes (formatting and comments)...');
    const oldFormatting = `
        function process(x: number): number {
            return x * 2;
        }
    `;
    const newFormatting = `
        // Helpful documentation comment
        // Another explanation line
        function process(x: number): number {
            return x * 2;
        }
    `;

    const deltaCosmetic = classifySemanticDelta('src/process.ts', oldFormatting, newFormatting);
    assert.strictEqual(deltaCosmetic.category, 'pure-cosmetic', 'Adding comments must be classified as pure-cosmetic');
    assert.strictEqual(deltaCosmetic.counters.semantic, 0, 'Pure cosmetic changes must produce 0 semantic ELOC');
    assert.ok(deltaCosmetic.counters.cosmetic > 0, 'Cosmetic ELOC must be greater than 0');
    console.log('    ✔ Pure cosmetic change classification verified');

    // --- Test 5: Pure Semantic Logic Refactoring ---
    console.log('  ▶ [Test 5] Testing genuine semantic logic modifications...');
    const oldLogic = `
        function validate(num: number): boolean {
            if (num < 0) return false;
            return true;
        }
    `;
    const newLogic = `
        function validate(num: number): boolean {
            if (num < 0 || num > 100 || !Number.isFinite(num)) {
                return false;
            }
            return true;
        }
    `;

    const deltaSemantic = classifySemanticDelta('src/validate.ts', oldLogic, newLogic);
    assert.strictEqual(deltaSemantic.category, 'pure-semantic', 'Logic modification must be classified as pure-semantic');
    assert.ok(deltaSemantic.counters.semantic > 0, 'Semantic ELOC must be > 0');
    assert.strictEqual(deltaSemantic.counters.relocated, 0, 'Pure semantic should have 0 relocated');
    console.log('    ✔ Genuine semantic modification verified');

    // --- Test 6: Mixed Refactoring Changes ---
    console.log('  ▶ [Test 6] Testing mixed change decomposition (semantic + comments + move)...');
    const oldMixed = `
        const LIMIT = 10;
        function compute(val: number): number {
            return val + LIMIT;
        }
    `;
    const newMixed = `
        // Updated formula for optimization
        function compute(val: number): number {
            return val * 2 + LIMIT;
        }
        const LIMIT = 10;
    `;

    const deltaMixed = classifySemanticDelta('src/mixed.ts', oldMixed, newMixed);
    assert.strictEqual(deltaMixed.category, 'mixed', 'Combined modifications must be classified as mixed');
    assert.ok(deltaMixed.counters.semantic > 0, 'Must identify semantic changes');
    assert.ok(deltaMixed.counters.cosmetic > 0 || deltaMixed.counters.relocated > 0, 'Must identify cosmetic or relocated lines');
    console.log('    ✔ Mixed change decomposition verified');

    console.log('\n🎉 ALL Phase 1 Semantic ELOC & Block Fingerprint Tests PASSED!\n');
}

runTests();
