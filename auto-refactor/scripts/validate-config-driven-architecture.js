#!/usr/bin/env node
/**
 * Module: Verification Harness — Config-Driven Architecture Recognition
 * File Path: scripts/validate-config-driven-architecture.js
 * Architecture Role: Validates Config-Driven Architecture (CDA) recognition, 6 anti-pattern
 *   detectors (ARCH-CFG-002 through ARCH-CFG-007), and CDAMS maturity calculation.
 * Dependencies & Triggers: Consumes auditConfigDrivenArchitecture from ../dist/api or core;
 *   invoked by npm test and parallel test runner.
 * Responsibilities: Assert dead config, duplicate config, implicit env access, scattered access,
 *   direct disk I/O in domain, and over-abstraction detection; verify scale-calibrated CDAMS score.
 * Exit Semantics & Design Rationale: Process exits 0 on all assertions passing, 1 on failure.
 */

'use strict';

const {
  auditConfigDrivenArchitecture,
} = require('../dist/core/architecture/config-driven-architecture');

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

function runTests() {
  console.log('--- 1. Testing Clean Config-Driven Project (High Maturity L4) ---');
  {
    const files = [
      {
        filePath: 'config/game_rules.json',
        content: JSON.stringify({
          max_retries: 3,
          timeout_ms: 5000,
          feature_flag_pvp: true,
        }),
      },
      {
        filePath: 'src/domain/battle.ts',
        content: `
          export function executeBattle(config: { max_retries: number; feature_flag_pvp: boolean }) {
            if (config.feature_flag_pvp) {
              return config.max_retries > 0;
            }
            return false;
          }
        `,
        isDomainCore: true,
      },
      {
        filePath: 'src/infra/config_provider.ts',
        content: `
          export function loadConfig() {
            return { timeout_ms: 5000 };
          }
        `,
      },
    ];

    const result = auditConfigDrivenArchitecture(files, { fileCount: 3, domainCount: 1 });
    assert(result.maturityScore >= 80, `Clean project scores high CDAMS: ${result.maturityScore}`);
    assert(result.maturityLevel >= 3, `Clean project achieves L3 or L4: ${result.maturityGrade}`);
    assert(result.issues.length === 0, 'Clean project produces 0 ARCH-CFG violations');
  }

  console.log('--- 2. Testing Dead Configuration (ARCH-CFG-002) ---');
  {
    const files = [
      {
        filePath: 'config/app_settings.json',
        content: JSON.stringify({
          active_feature: true,
          obsolete_key_never_used: 'dead_value',
        }),
      },
      {
        filePath: 'src/domain/service.ts',
        content: `
          export function run(cfg: any) {
            return cfg.active_feature;
          }
        `,
      },
    ];

    const result = auditConfigDrivenArchitecture(files, { fileCount: 2, domainCount: 1 });
    const deadIssue = result.issues.find((i) => i.rule === 'ARCH-CFG-002');
    assert(deadIssue !== undefined, 'Detected dead config key (ARCH-CFG-002)');
    assert(
      deadIssue && deadIssue.message.includes('obsolete_key_never_used'),
      'Identifies the unreferenced config key in message',
    );
  }

  console.log('--- 3. Testing Duplicate Configuration (ARCH-CFG-003) ---');
  {
    const files = [
      {
        filePath: 'config/primary.json',
        content: JSON.stringify({ database_url: 'postgres://localhost:5432/main' }),
      },
      {
        filePath: 'config/secondary.json',
        content: JSON.stringify({ database_url: 'postgres://remote:5432/backup' }),
      },
      {
        filePath: 'src/index.ts',
        content: 'console.log(database_url);',
      },
    ];

    const result = auditConfigDrivenArchitecture(files, { fileCount: 3, domainCount: 1 });
    const dupIssue = result.issues.find((i) => i.rule === 'ARCH-CFG-003');
    assert(dupIssue !== undefined, 'Detected duplicate configuration (ARCH-CFG-003)');
    assert(
      dupIssue && dupIssue.detail.key === 'database_url',
      'Reports duplicate key database_url in detail',
    );
  }

  console.log('--- 4. Testing Implicit Env in Domain (ARCH-CFG-004) ---');
  {
    const files = [
      {
        filePath: 'src/domain/pricing.ts',
        content: `
          export function calculateDiscount(base: number): number {
            const secretRate = process.env.DISCOUNT_RATE;
            return base * Number(secretRate || 1);
          }
        `,
        isDomainCore: true,
      },
    ];

    const result = auditConfigDrivenArchitecture(files, { fileCount: 1, domainCount: 1 });
    const envIssue = result.issues.find((i) => i.rule === 'ARCH-CFG-004');
    assert(envIssue !== undefined, 'Detected implicit process.env in domain core (ARCH-CFG-004)');
    assert(
      envIssue && envIssue.location.file === 'src/domain/pricing.ts',
      'Pinpoints exact domain file accessing environment variables',
    );
  }

  console.log('--- 5. Testing Scattered Config Access (ARCH-CFG-005) ---');
  {
    const files = [
      {
        filePath: 'src/domain/module_a.ts',
        content: 'const raw = readFileSync("config/app.json");',
      },
      {
        filePath: 'src/domain/module_b.ts',
        content: 'const raw = readFileSync("config/app.json");',
      },
      {
        filePath: 'src/domain/module_c.ts',
        content: 'const raw = readFileSync("config/app.json");',
      },
    ];

    const result = auditConfigDrivenArchitecture(files, { fileCount: 3, domainCount: 1 });
    const scattered = result.issues.find((i) => i.rule === 'ARCH-CFG-005');
    assert(scattered !== undefined, 'Detected scattered raw config access (ARCH-CFG-005)');
  }

  console.log('--- 6. Testing Config-Business Coupling (ARCH-CFG-006) ---');
  {
    const files = [
      {
        filePath: 'src/domain/combat_engine.ts',
        content: `
          import * as fs from 'fs';
          export class CombatEngine {
            init() {
              const cfg = fs.readFileSync('config/combat.json');
            }
          }
        `,
        isDomainCore: true,
      },
    ];

    const result = auditConfigDrivenArchitecture(files, { fileCount: 1, domainCount: 1 });
    const coupling = result.issues.find((i) => i.rule === 'ARCH-CFG-006');
    assert(coupling !== undefined, 'Detected physical disk I/O in domain core (ARCH-CFG-006)');
  }

  console.log('--- 7. Testing Over-Abstracted Config in Small Project (ARCH-CFG-007) ---');
  {
    const files = [
      { filePath: 'config/a.json', content: '{"a":1}' },
      { filePath: 'config/b.json', content: '{"b":2}' },
      { filePath: 'config/c.json', content: '{"c":3}' },
      { filePath: 'config/d.json', content: '{"d":4}' },
      { filePath: 'config/e.json', content: '{"e":5}' },
      { filePath: 'config/f.json', content: '{"f":6}' },
      { filePath: 'src/main.ts', content: 'console.log(a, b, c, d, e, f);' },
    ];

    const result = auditConfigDrivenArchitecture(files, { fileCount: 7, domainCount: 1 });
    const overAbstract = result.issues.find((i) => i.rule === 'ARCH-CFG-007');
    assert(
      overAbstract !== undefined,
      'Detected over-abstracted config for small project (ARCH-CFG-007)',
    );
  }

  console.log('--- 8. Testing Scale Profile Elastic Calibration ---');
  {
    const smallFiles = [
      { filePath: 'config/simple.json', content: '{"rate": 1.5}' },
      { filePath: 'src/core/calc.ts', content: 'const r = rate;', isDomainCore: true },
    ];
    const smallResult = auditConfigDrivenArchitecture(smallFiles, { fileCount: 5, domainCount: 1 });
    const largeResult = auditConfigDrivenArchitecture(smallFiles, {
      fileCount: 300,
      domainCount: 15,
    });

    assert(
      smallResult.maturityScore >= largeResult.maturityScore,
      `Small project gets elastic tolerance bonus (${smallResult.maturityScore} >= ${largeResult.maturityScore})`,
    );
  }

  console.log('--- 9. Testing Substring Collision Resistance (Token Boundary Inverted Index) ---');
  {
    const files = [
      {
        filePath: 'config/network.json',
        content: JSON.stringify({
          port: 8080,
        }),
      },
      {
        filePath: 'src/domain/app.ts',
        content: `
          import { something } from 'somewhere';
          const localVal = 42;
          console.log(localVal);
        `,
        isDomainCore: true,
      },
    ];

    const result = auditConfigDrivenArchitecture(files, { fileCount: 2, domainCount: 1 });
    const deadIssue = result.issues.find((i) => i.rule === 'ARCH-CFG-002');
    assert(
      deadIssue !== undefined && deadIssue.message.includes('port'),
      'Token boundary matching correctly identifies "port" as dead despite "import"/"export"',
    );
  }

  console.log(`\nConfig-Driven Architecture Tests: ${passedCount}/${totalCount} passed.`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runTests();
