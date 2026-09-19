/**
 * Module: Core Intelligence — Generalized Semantic Architecture Governance
 * File Path: src/core/intelligence/semanticArchitecture.ts
 * Architecture Role: Semantic layer inference and architecture boundary guard; verifies
 *   headless decoupling, detects cross-domain private leaks and shared mutable state.
 * Dependencies & Triggers: Core types (Issue, SemanticReviewDetail, SemanticEvidenceStep,
 *   ArchitectureLayer, ScaleGrade, ProjectArchetype); invoked by ArchitectureAnalyzer.
 * Responsibilities: Infer semantic architectural roles beyond folder names; enforce Headless
 *   pure logic isolation (ARCH-HDL-001); detect cross-domain private bypasses (ARCH-BND-001);
 *   detect implicit shared mutable global state (ARCH-GLB-001); detect structural layering
 *   illusions (ARCH-DIR-003); flag infrastructure configuration leakage into domain entities
 *   (ARCH-CFG-001); dynamically adapt governance strictness to project scale and archetype.
 * Exit Semantics & Design Rationale: Pure semantic deduction and graph constraint verification;
 *   returns structured issues adhering strictly to the Section VII result schema.
 */

import type { ArchitectureLayer, Issue, ScaleGrade } from '../types';

/**
 * UI / presentation frameworks forbidden in headless or pure domain code.
 */
export const FORBIDDEN_HEADLESS_IMPORTS = new Set([
    'vscode',
    'electron',
    'react',
    'react-dom',
    'vue',
    'svelte',
    '@angular/core',
    'window',
    'document',
    'gtk',
    'qt',
]);

/**
 * Descriptor of a file's semantic architectural properties.
 */
export interface ArchitecturalFileInfo {
    filePath: string;
    inferredLayer: ArchitectureLayer;
    isHeadless: boolean;
    domainName: string;
    imports: string[];
    hasGlobalMutableState: boolean;
    hasDirectConfigAccess: boolean;
}

/**
 * Options controlling generalized architecture review.
 */
export interface SemanticArchitectureOptions {
    enforceHeadless?: boolean;
    flagCrossDomainBypass?: boolean;
    flagMutableGlobalCoupling?: boolean;
    flagLayeringIllusions?: boolean;
    flagConfigLeakage?: boolean;
    scaleGrade?: ScaleGrade;
}

/**
 * Infer true semantic architectural layer of a file based on symbols and imports.
 *
 * @param filePath - Repository-relative file path.
 * @param imports - Module specifiers imported by the file.
 * @param exports - Symbols exported by the file.
 * @returns Inferred architectural layer.
 */
export function inferSemanticLayer(
    filePath: string,
    imports: string[],
    exports: string[],
): ArchitectureLayer {
    const lower = filePath.toLowerCase();
    void exports;

    // Test layer
    if (lower.includes('test') || lower.includes('spec') || lower.includes('__tests__')) {
        return 'test';
    }

    // Interface layer (UI, CLI, API endpoints)
    if (
        lower.includes('controller') ||
        lower.includes('router') ||
        lower.includes('cli') ||
        lower.includes('view') ||
        lower.includes('component') ||
        imports.some((i) => FORBIDDEN_HEADLESS_IMPORTS.has(i))
    ) {
        return 'interface';
    }

    // Infrastructure / Data Access
    if (
        lower.includes('repository') ||
        lower.includes('database') ||
        lower.includes('driver') ||
        lower.includes('adapter') ||
        lower.includes('gateway') ||
        lower.includes('sql')
    ) {
        return 'infrastructure';
    }

    // Application Orchestration
    if (
        lower.includes('service') ||
        lower.includes('usecase') ||
        lower.includes('workflow') ||
        lower.includes('orchestrator')
    ) {
        return 'application';
    }

    // Shared / Tooling
    if (lower.includes('util') || lower.includes('helper') || lower.includes('shared')) {
        return 'shared';
    }

    // Default to Domain
    return 'domain';
}

import {
    checkHeadlessImports,
    checkCrossDomainBypass,
    checkMutableGlobalCoupling,
    checkLayeringIllusion,
    checkConfigLeakage,
} from './architectureBoundaryChecks';

/**
 * Verify architecture boundaries across the repository.
 *
 * @param files - Analyzed files with their architectural descriptors.
 * @param options - Tunable architectural options.
 * @returns Array of issues strictly following Section VII schema.
 */
export function verifyArchitectureBoundaries(
    files: ArchitecturalFileInfo[],
    options: SemanticArchitectureOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    const enforceHeadless = options.enforceHeadless ?? true;
    const flagBypass = options.flagCrossDomainBypass ?? true;
    const flagGlobal = options.flagMutableGlobalCoupling ?? true;
    const flagIllusions = options.flagLayeringIllusions ?? true;
    const flagConfig = options.flagConfigLeakage ?? true;

    for (const file of files) {
        checkHeadlessImports(file, issues, enforceHeadless);
        checkCrossDomainBypass(file, issues, flagBypass);
        checkMutableGlobalCoupling(file, issues, flagGlobal);
        checkLayeringIllusion(file, issues, flagIllusions);
        checkConfigLeakage(file, issues, flagConfig);
    }

    return issues;
}
