/**
 * Module: Core Profiler — Maturity Tier Classification
 * File Path: src/core/profiler/maturityClassifier.ts
 * Architecture Role: Evaluates project maturity tier based on paths, manifests, and test gates.
 * Dependencies & Triggers: Node fs and path, MaturityTier from ../types; called by profiler.
 * Responsibilities: Classify maturity as demo, prototype, industrial, or production based on
 *   path keywords, version strings, test/lint gate scripts, CI configs, and workspace manifests.
 * Exit Semantics & Design Rationale: Gracefully falls back to 'production' on unreadable files;
 *   never throws on missing manifests or syntax errors.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { MaturityTier } from '../types';

/**
 * Evaluate maturity tier from parsed package.json data and root directory.
 *
 * @param root - Project root directory path.
 * @param packageData - Parsed package.json object.
 * @returns Matching MaturityTier or undefined if not determinable from package.json.
 */
export function evaluatePackageMaturity(
    root: string,
    packageData: Record<string, any>,
): MaturityTier | undefined {
    const name = String(packageData.name || '');
    const version = String(packageData.version || '');
    if (/(?:demo|samples?|examples?|tutorial)/i.test(name) || version === '0.0.0') {
        return 'demo';
    }

    const scripts = packageData.scripts || {};
    const hasTests = !!(scripts.test || scripts['test:unit']);
    const hasLintOrAudit = !!(scripts.lint || scripts.audit || scripts.check);
    const hasCi =
        fs.existsSync(path.join(root, '.github', 'workflows')) ||
        fs.existsSync(path.join(root, '.gitlab-ci.yml'));

    // Industrial: version >= 1.0.0 or 0.x with comprehensive CI, audit, and strict test gates
    if (
        hasCi &&
        hasTests &&
        hasLintOrAudit &&
        (version.startsWith('1.') || version.startsWith('2.') || packageData.private === false)
    ) {
        return 'industrial';
    }

    // Prototype: 0.0.x or no tests
    if (version.startsWith('0.0.') || !hasTests) {
        return 'prototype';
    }

    return 'production';
}

/**
 * Evaluate maturity tier from Rust Cargo.toml if present.
 *
 * @param root - Project root directory path.
 * @returns Matching MaturityTier or undefined if Cargo.toml is absent or uninformative.
 */
export function evaluateCargoMaturity(root: string): MaturityTier | undefined {
    const cargoPath = path.join(root, 'Cargo.toml');
    if (!fs.existsSync(cargoPath)) return undefined;

    try {
        const content = fs.readFileSync(cargoPath, 'utf8');
        if (content.includes('version = "0.0.')) return 'prototype';
        if (content.includes('[workspace]')) return 'industrial';
    } catch {
        // ignore
    }
    return undefined;
}

/**
 * Classify the project maturity tier from its path, package manifest, and build files.
 *
 * Demo paths, demo-like package names, and version '0.0.0' map to 'demo'; missing tests or a
 * '0.0.x' version map to 'prototype'; CI plus tests plus lint/audit gates with a 1.x/2.x or
 * public version map to 'industrial'; every other manifest falls back to 'production'.
 *
 * @param root - Project root directory whose path and manifests are inspected.
 * @param pkg - Parsed package.json; when omitted it is read from `root` when present.
 * @returns The best matching MaturityTier; unreadable manifests leave the default 'production'.
 */
export function detectMaturityTier(root: string, pkg?: Record<string, any>): MaturityTier {
    const normRoot = root.replace(/\\/g, '/');
    if (/(?:demo|samples?|examples?|tutorial|starter|playground)/i.test(normRoot)) {
        return 'demo';
    }

    let packageData = pkg;
    if (!packageData) {
        const pkgPath = path.join(root, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                packageData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            } catch {
                // ignore
            }
        }
    }

    if (packageData) {
        const tier = evaluatePackageMaturity(root, packageData);
        if (tier) return tier;
    }

    const cargoTier = evaluateCargoMaturity(root);
    if (cargoTier) return cargoTier;

    return 'production';
}
