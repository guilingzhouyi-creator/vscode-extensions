/**
 * Module: Verification Harness — Five Core Architectural Governance Capabilities
 * File Path: scripts/validate-five-core-capabilities.js
 * Architecture Role: End-to-end integration test validating the five core static analysis
 *     capabilities: Spatiotemporal Complexity, Data Architecture, Test Modernity, Dependency
 *     Layout, and Generalized Headless Architecture Governance.
 * Dependencies & Triggers: Invoked during quality verification; imports dist/api and drives
 *     multi-domain static analysis scans against synthesized multi-pattern project fixtures.
 * Responsibilities: Build fixture sources triggering CPX-*, DAT-*, TST-*, DEP-*, ARCH-*,
 *     and nested-constant rules; execute engine scan; assert diagnostic presence and precision.
 * Exit Semantics & Design Rationale: Exits 0 on all rules correctly triggered and asserted;
 *     exits with non-zero code on any missing detection or unexpected regression.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../dist/api');

// Shield keyword to prevent comment analyzer from misinterpreting fixture code as public API
const EXP = 'export';

async function runHarness() {
  console.log('=== Verifying Five Core Capabilities ===\n');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-five-caps-'));

  try {
    // Write auto-refactor.config.json for thresholds & options
    fs.writeFileSync(
      path.join(tmpDir, 'auto-refactor.config.json'),
      JSON.stringify(
        {
          analyzers: {
            constants: { enabled: true },
            complexity: { enabled: true },
            'data-architecture': { enabled: true },
            'test-modernity': { enabled: true },
            'dependency-layout': { enabled: true },
            architecture: {
              enabled: true,
              options: {
                enforceHeadless: true,
                flagMutableGlobalCoupling: true,
                flagConfigLeakage: true,
              },
            },
          },
        },
        null,
        2,
      ),
    );

    // 1. Setup fixture files
    // 1.1 Complexity Fixtures
    fs.writeFileSync(
      path.join(tmpDir, 'complexity_hot.ts'),
      `
${EXP} function processHotItems(items: string[]) {
    for (const item of items) {
        // Transient allocation in unbounded loop (CPX-SPACE-001)
        const copy = new Array(100);
        // Blocking I/O in unbounded loop (CPX-AMP-001)
        require('fs').readFileSync('data.txt');
    }
}
`,
    );

    // 1.2 Data Architecture Fixtures
    fs.writeFileSync(
      path.join(tmpDir, 'order_controller.ts'),
      `
${EXP} class OrderController {
    async handleOrders(orders: any[]) {
        for (const order of orders) {
            // N+1 query in loop (DAT-NPL-001)
            await db.query('SELECT * FROM items WHERE order_id = ' + order.id);
        }
        // Unbounded SELECT * (DAT-QUR-001)
        const all = await db.query('SELECT * FROM audit_logs');
    }
}
`,
    );

    // 1.3 Test Modernity Fixtures
    fs.writeFileSync(
      path.join(tmpDir, 'user_service.test.ts'),
      `
describe('UserService', () => {
    it.skip('orphaned test', () => {}); // TST-SKP-001
    it('tautological test', () => {
        expect(true).toBe(true); // TST-TAU-001
    });
    it('mock only test', () => {
        const mockFn = jest.fn();
        mockFn();
        expect(mockFn).toHaveBeenCalled(); // TST-ILS-001
    });
});
`,
    );

    // 1.4 Dependency Layout & Constants Fixtures
    fs.writeFileSync(
      path.join(tmpDir, 'service_layout.ts'),
      `
import * as utils from './utils'; // DEP-WLD-001
const DEFAULT_TIMEOUT = 5000;
${EXP} const TIMEOUT_MS = DEFAULT_TIMEOUT; // nested-constant (redundant constant alias)

${EXP} function runService() {
    // Unjustified in-function import without @lazy/@optional (DEP-LAZ-001)
    const heavy = require('heavy-lib');
    const endpoint = 'https://api.external-unmanaged.io/v1/pay'; // DEP-RES-001
    return { heavy, endpoint };
}
`,
    );

    // 1.5 Architecture Boundaries (Domain importing UI / env)
    const domainDir = path.join(tmpDir, 'domain');
    fs.mkdirSync(domainDir, { recursive: true });
    fs.writeFileSync(
      path.join(domainDir, 'order_entity.ts'),
      `
import * as vscode from 'vscode'; // ARCH-HDL-001 (headless violation)
${EXP} class OrderEntity {
    constructor() {
        const host = process.env.API_HOST; // ARCH-CFG-001 (config leakage)
    }
}
${EXP} let mutableGlobalOrders: any[] = []; // ARCH-GLB-001 (mutable global state)
`,
    );

    // 2. Execute full scan with array of analyzer names
    const report = await scan({
      root: tmpDir,
      cache: false,
      analyzers: [
        'constants',
        'complexity',
        'data-architecture',
        'test-modernity',
        'dependency-layout',
        'architecture',
      ],
    });

    console.log(`Scan completed: ${report.issues.length} issue(s) identified.`);
    const ruleCounts = new Map();
    for (const issue of report.issues) {
      ruleCounts.set(issue.rule, (ruleCounts.get(issue.rule) || 0) + 1);
    }
    console.log('Identified rules:', Array.from(ruleCounts.entries()));

    // 3. Assertions for Capability 1: Complexity
    console.log('1. Checking Spatiotemporal Complexity (CPX-*)...');
    assert(
      ruleCounts.has('CPX-SPACE-001'),
      'Expected CPX-SPACE-001 (transient allocation in loop)',
    );
    assert(
      ruleCounts.has('CPX-AMP-001'),
      'Expected CPX-AMP-001 (blocking I/O amplification in loop)',
    );
    console.log('  [PASS] CPX-SPACE-001 and CPX-AMP-001 detected successfully.');

    // 4. Assertions for Capability 2: Data Architecture
    console.log('2. Checking Data Architecture Modernization (DAT-*)...');
    assert(ruleCounts.has('DAT-NPL-001'), 'Expected DAT-NPL-001 (N+1 query in loop)');
    assert(ruleCounts.has('DAT-QRY-001'), 'Expected DAT-QRY-001 (Unbounded query)');
    console.log('  [PASS] DAT-NPL-001 and DAT-QRY-001 detected successfully.');

    // 5. Assertions for Capability 3: Test Modernity
    console.log('3. Checking Test Modernity & Business Contract (TST-*)...');
    assert(ruleCounts.has('TST-SKP-001'), 'Expected TST-SKP-001 (orphaned skipped test)');
    assert(ruleCounts.has('TST-TAU-001'), 'Expected TST-TAU-001 (tautological assertion)');
    assert(ruleCounts.has('TST-ILS-001'), 'Expected TST-ILS-001 (mock-only assertion)');
    console.log('  [PASS] TST-SKP-001, TST-TAU-001, and TST-ILS-001 detected successfully.');

    // 6. Assertions for Capability 4: Dependency Layout
    console.log('4. Checking Dependency Layout & Managed Resources (DEP-*)...');
    assert(ruleCounts.has('DEP-WLD-001'), 'Expected DEP-WLD-001 (wildcard import)');
    assert(ruleCounts.has('DEP-LAZ-001'), 'Expected DEP-LAZ-001 (unjustified in-function import)');
    assert(ruleCounts.has('DEP-RES-001'), 'Expected DEP-RES-001 (unmanaged external URL)');
    console.log('  [PASS] DEP-WLD-001, DEP-LAZ-001, and DEP-RES-001 detected successfully.');

    // 7. Assertions for Capability 5: Architecture & Headless Governance
    console.log('5. Checking Semantic Architecture & Headless Decoupling (ARCH-*)...');
    assert(
      ruleCounts.has('ARCH-HDL-001'),
      'Expected ARCH-HDL-001 (domain importing presentation/vscode)',
    );
    assert(ruleCounts.has('ARCH-CFG-001'), 'Expected ARCH-CFG-001 (domain reading process.env)');
    assert(ruleCounts.has('ARCH-GLB-001'), 'Expected ARCH-GLB-001 (exported mutable global state)');
    console.log('  [PASS] ARCH-HDL-001, ARCH-CFG-001, and ARCH-GLB-001 detected successfully.');

    // 8. Assertions for Constant Governance & Nested Constant Prevention
    console.log('6. Checking Constant Cleanliness & Anti-Nesting Rule (nested-constant)...');
    assert(
      ruleCounts.has('nested-constant'),
      'Expected nested-constant (redundant constant alias)',
    );
    console.log('  [PASS] nested-constant detected successfully.');

    console.log('\n======================================================');
    console.log(' ALL CORE CAPABILITIES & CONSTANT GOVERNANCE VERIFIED!');
    console.log('======================================================\n');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_cleanupErr) {
      // best-effort cleanup of test fixture directory
    }
  }
}

runHarness().catch((err) => {
  console.error('Validation harness failed:', err);
  process.exit(1);
});
