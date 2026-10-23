/**
 * Module: Unit Tests — Autonomy Import Profile & Deprecated Dependencies
 * File Path: tests/unit/intelligence/autonomy-import-profile.test.ts
 * Architecture Role: Unit test suite validating multi-language import profile extraction,
 *   dependency provenance classification with path aliases, and deprecated package auditing.
 * Test Type: Unit test suite
 */

import { describe, it, expect } from 'vitest';
import {
    classifyImportProvenance,
    findNearestManifestInventory,
    isDevOnlyDependency,
    isUnpinnedVersion,
} from '../../../src/core/intelligence/dependency-provenance';
import * as path from 'path';
import { checkDeprecatedPackage } from '../../../src/core/intelligence/deprecated-dependencies';
import {
    evaluateProjectAutonomy,
} from '../../../src/core/scoring/autonomy-scorer';
import { extractFileImportProfile } from '../../../src/core/intelligence/import-profiler';
import { RustAdapter } from '../../../src/core/ast/rust-adapter';
import { GDScriptAdapter } from '../../../src/core/ast/gdscript-adapter';
import { collectSymbols } from '../../../src/core/intelligence/symbolIndex';
import type { FileMetric, Issue, ScanConfig } from '../../../src/core/types';

describe('Dependency Provenance & Path Aliases', () => {
    it('classifies path alias as internal instead of external_sdk', () => {
        const pathAliases = new Set<string>(['@core', '@utils']);

        const provCore = classifyImportProvenance('@core/services/auth', 'src/app.ts', undefined, pathAliases);
        expect(provCore).toBe('internal');

        const provUtils = classifyImportProvenance('@utils', 'src/app.ts', undefined, pathAliases);
        expect(provUtils).toBe('internal');

        const provExternal = classifyImportProvenance('lodash/map', 'src/app.ts', undefined, pathAliases);
        expect(provExternal).toBe('external_sdk');

        const provStd = classifyImportProvenance('path', 'src/app.ts', undefined, pathAliases);
        expect(provStd).toBe('stdlib');
    });

    it('identifies dev-only dependencies accurately in production code', () => {
        const inventory = {
            allDependencies: new Set(['mocha', 'express']),
            prodDependencies: new Set(['express']),
            devDependencies: new Set(['mocha']),
            peerDependencies: new Set<string>(),
            pathAliases: new Set<string>(),
        };

        expect(isDevOnlyDependency('mocha', inventory)).toBe(true);
        expect(isDevOnlyDependency('express', inventory)).toBe(false);
    });
});

describe('Deprecated Package Intelligence', () => {
    it('detects deprecated Node.js packages with modern replacements', () => {
        const reqCheck = checkDeprecatedPackage('request');
        expect(reqCheck).not.toBeNull();
        expect(reqCheck?.replacement).toContain('fetch');

        const momentCheck = checkDeprecatedPackage('moment');
        expect(momentCheck).not.toBeNull();
        expect(momentCheck?.replacement).toContain('dayjs');

        const qsCheck = checkDeprecatedPackage('querystring');
        expect(qsCheck).not.toBeNull();
        expect(qsCheck?.replacement).toContain('URLSearchParams');
    });

    it('detects deprecated Python libraries', () => {
        const distutilsCheck = checkDeprecatedPackage('distutils');
        expect(distutilsCheck).not.toBeNull();
        expect(distutilsCheck?.replacement).toContain('setuptools');

        const impCheck = checkDeprecatedPackage('imp');
        expect(impCheck).not.toBeNull();
        expect(impCheck?.replacement).toContain('importlib');
    });

    it('returns null for modern active packages', () => {
        expect(checkDeprecatedPackage('vitest')).toBeNull();
        expect(checkDeprecatedPackage('zod')).toBeNull();
        expect(checkDeprecatedPackage('requests')).toBeNull();
    });
});

describe('Autonomy Scorer — Mathematical Evaluation & Provenance', () => {
    const mockConfig: ScanConfig = {
        root: '/mock-root',
        analyzers: {},
        thresholds: {},
    };

    it('computes autonomy metrics cleanly for first-party modules', () => {
        const metrics: FileMetric[] = [
            { file: 'src/index.ts', totalLines: 20, effectiveLoc: 15, blankLines: 2, commentLines: 3 },
            { file: 'src/service.ts', totalLines: 30, effectiveLoc: 25, blankLines: 2, commentLines: 3 },
        ];
        const issues: Issue[] = [];
        const fileContents = new Map<string, string>([
            ['src/index.ts', 'import { helper } from "./service";\nexport function run() { return helper(); }'],
            ['src/service.ts', 'export function helper() { return 42; }'],
        ]);

        const evaluation = evaluateProjectAutonomy(metrics, issues, mockConfig, fileContents);
        expect(evaluation.compositeAutonomyIndex).toBeGreaterThan(90);
        expect(evaluation.grade).toBe('L5_INDEPENDENT');
        expect(evaluation.externalSdkInventory).toHaveLength(0);
        expect(evaluation.stats.proprietaryFiles).toBe(2);
    });

    it('accurately identifies external packages without first-package truncation bias', () => {
        const metrics: FileMetric[] = [
            { file: 'src/worker.ts', totalLines: 50, effectiveLoc: 40, blankLines: 5, commentLines: 5 },
        ];
        const issues: Issue[] = [];
        const code = `
import { get } from 'axios';
import { cloneDeep } from 'lodash';
import { z } from 'zod';

export async function processData(url: string) {
    const res = await get(url);
    const schema = z.object({ id: z.number() });
    return cloneDeep(res.data);
}
`;
        const fileContents = new Map<string, string>([['src/worker.ts', code]]);
        const evaluation = evaluateProjectAutonomy(metrics, issues, mockConfig, fileContents);

        const sdkNames = evaluation.externalSdkInventory.map((sdk) => sdk.name);
        expect(sdkNames).toContain('axios');
        expect(sdkNames).toContain('lodash');
        expect(sdkNames).toContain('zod');
        expect(evaluation.compositeAutonomyIndex).toBeLessThan(100);
    });

    it('objectively penalizes symbolCallAutonomy when external SDKs are imported but symbolIndex is absent', () => {
        const metrics: FileMetric[] = [
            { file: 'src/glue.ts', totalLines: 30, effectiveLoc: 20, blankLines: 5, commentLines: 5 },
        ];
        const issues: Issue[] = [];
        const code = `
import * as aws from 'aws-sdk';
import * as stripe from 'stripe';
import * as sentry from '@sentry/node';

export function setup() {
    return true;
}
`;
        const fileContents = new Map<string, string>([['src/glue.ts', code]]);
        // Without symbolIndex, previously rCall defaulted falsely to 100%
        const evaluation = evaluateProjectAutonomy(metrics, issues, mockConfig, fileContents);

        // When code solely imports external SDKs and has zero internal calls, autonomy is objectively 0%
        expect(evaluation.dimensions.symbolCallAutonomy).toBe(0);
    });
});

describe('Unpinned Dependency Version & Monorepo Manifest Intelligence', () => {
    it('detects unpinned and wildcard version specs reliably', () => {
        expect(isUnpinnedVersion('*')).toBe(true);
        expect(isUnpinnedVersion('latest')).toBe(true);
        expect(isUnpinnedVersion('x')).toBe(true);
        expect(isUnpinnedVersion('>=1.0.0')).toBe(true);
        expect(isUnpinnedVersion('>2.0.0')).toBe(true);

        expect(isUnpinnedVersion('^1.2.3')).toBe(false);
        expect(isUnpinnedVersion('~1.2.3')).toBe(false);
        expect(isUnpinnedVersion('1.2.3')).toBe(false);
        expect(isUnpinnedVersion('>=1.0.0 <2.0.0')).toBe(false);
    });

    it('findNearestManifestInventory merges subproject inventory with root inventory', () => {
        const repoRoot = path.resolve(__dirname, '../../../../');
        const subprojectFile = path.join(repoRoot, 'auto-refactor', 'src', 'index.ts');

        const inventory = findNearestManifestInventory(subprojectFile, repoRoot);
        expect(inventory.allDependencies.size).toBeGreaterThan(0);
        expect(inventory.versionSpecs.size).toBeGreaterThan(0);
    });

    it('extracts Rust import bindings and symbols correctly into symbolToPackageMap', () => {
        const rustCode = `
use sha1::Sha1;
use parking_lot::Mutex;
use serde::{Serialize, Deserialize as De};
use std::sync::Arc;

fn test() {
    let s = Sha1::new();
    let m = Mutex::new(42);
}
`;
        const profile = extractFileImportProfile(rustCode, 'src/storage.rs');
        expect(profile.specifiers).toContain('sha1');
        expect(profile.specifiers).toContain('parking_lot');
        expect(profile.specifiers).toContain('serde');
        expect(profile.specifiers).toContain('std');

        expect(profile.symbolToPackageMap.get('Sha1')).toBe('sha1');
        expect(profile.symbolToPackageMap.get('Mutex')).toBe('parking_lot');
        expect(profile.symbolToPackageMap.get('Serialize')).toBe('serde');
        expect(profile.symbolToPackageMap.get('De')).toBe('serde');
        expect(profile.symbolToPackageMap.get('Arc')).toBe('std');
    });

    it('extracts Rust AST call expressions with name and receiver via rust-adapter', () => {
        const rustCode = `
fn compute() {
    let s = Sha1::new();
    let val = calculate_hash();
    crate::util::log();
}
`;
        const adapter = new RustAdapter();
        const ast = adapter.parse(rustCode, 'src/crypto.rs');
        const symbols = collectSymbols(ast.root, 'src/crypto.rs');

        const callNames = symbols.references.map((r) => r.name);
        expect(callNames).toContain('new');
        expect(callNames).toContain('calculate_hash');
        expect(callNames).toContain('log');

        const newRef = symbols.references.find((r) => r.name === 'new');
        expect(newRef?.calleeReceiver).toBe('Sha1');

        const logRef = symbols.references.find((r) => r.name === 'log');
        expect(logRef?.calleeReceiver).toBe('crate::util');
    });

    it('extracts Go import bindings correctly into symbolToPackageMap', () => {
        const goCode = `
package main
import (
    "fmt"
    uuid "github.com/google/uuid"
    "strings"
)
`;
        const profile = extractFileImportProfile(goCode, 'main.go');
        expect(profile.specifiers).toContain('fmt');
        expect(profile.specifiers).toContain('github.com/google/uuid');
        expect(profile.symbolToPackageMap.get('fmt')).toBe('fmt');
        expect(profile.symbolToPackageMap.get('uuid')).toBe('github.com/google/uuid');
        expect(profile.symbolToPackageMap.get('strings')).toBe('strings');
    });

    it('extracts GDScript preload bindings and AST calls via gdscript-adapter', () => {
        const gdCode = `
extends Node
const Weapon = preload("res://weapon.gd")
var player = null

func _ready():
    player.attack()
    take_damage(10)
`;
        const profile = extractFileImportProfile(gdCode, 'scripts/main.gd');
        expect(profile.symbolToPackageMap.get('Weapon')).toBe('res://weapon.gd');

        const adapter = new GDScriptAdapter();
        const ast = adapter.parse(gdCode, 'scripts/main.gd');
        const symbols = collectSymbols(ast.root, 'scripts/main.gd');

        const callNames = symbols.references.map((r) => r.name);
        expect(callNames).toContain('attack');
        expect(callNames).toContain('take_damage');

        const attackRef = symbols.references.find((r) => r.name === 'attack');
        expect(attackRef?.calleeReceiver).toBe('player');
    });
});
