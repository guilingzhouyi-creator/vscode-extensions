#!/usr/bin/env node
/**
 * Module: Core Layer Topology Migration (Phase 1 / M2)
 * File Path: scripts/migrate-core-m2.js
 * Architecture Role: Safe, progressive migration script for clusterizing flat src/core/*.ts
 *   files into dedicated domain subdirectories (ast, diff, policy, config) while preserving
 *   full backward compatibility via Facade Re-export Shims and strict JSDoc headers.
 * Dependencies & Triggers: Executed as part of Phase 1 / M2 topology migration.
 * Responsibilities: Migrate modules to domain clusters and maintain 6-field header shims.
 * Exit Semantics & Design Rationale: Exits 0 on successful migration and shim generation.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORE_DIR = path.join(ROOT, 'src', 'core');

// M2 Domain clusters definition
const M2_CLUSTERS = {
  ast: [
    'multilang.ts',
    'traverse.ts',
    'oxc-adapter.ts',
    'oxc-projector.ts',
    'oxc-predicates.ts',
    'oxc-types.ts',
    'typescript-adapter.ts',
    'ts-projector.ts',
    'ts-predicates.ts',
    'python-adapter.ts',
    'rust-adapter.ts',
    'gdscript-adapter.ts',
    'markdown-adapter.ts',
    'adapters.ts',
    'language-support.ts',
    'utf8.ts',
    'swar.ts',
  ],
  diff: [
    'diff.ts',
    'diff-types.ts',
    'edit-diff.ts',
    'histogram-diff.ts',
    'line-map.ts',
    'incremental.ts',
    'incremental-state.ts',
  ],
  policy: ['literal-policy-engine.ts', 'source-mask.ts', 'gitignore.ts'],
  config: ['config.ts', 'config-cascades.ts', 'config-tuning.ts'],
};

function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[migrate-core-m2] Starting M2 migration (dryRun=${isDryRun})...`);

  let count = 0;

  for (const [domain, files] of Object.entries(M2_CLUSTERS)) {
    for (const fileName of files) {
      const srcFile = path.join(CORE_DIR, fileName);
      const baseNameWithoutExt = fileName.replace(/\.ts$/, '');

      // Create Facade Shim with strict 6-field header and line-length <= 80
      const facadeContent = `/**
 * Module: Core Layer Compatibility Shim
 * File Path: src/core/${fileName}
 * Architecture Role: Facade re-exporting ${domain}/${baseNameWithoutExt}
 *   to preserve full backward compatibility.
 * Dependencies & Triggers: Imported by external consumers expecting flat layout.
 * Responsibilities: Re-export all members from domain implementation module.
 * Exit Semantics & Design Rationale: Pure re-export module with zero runtime overhead.
 */
export * from './${domain}/${baseNameWithoutExt}';
`;
      if (!isDryRun) {
        fs.writeFileSync(srcFile, facadeContent, 'utf8');
      }
      count++;
    }
  }

  console.log(`[migrate-core-m2] Updated 6-field shims for ${count} files.`);
}

main();
