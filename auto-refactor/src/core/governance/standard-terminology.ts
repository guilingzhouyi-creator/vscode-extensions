/**
 * Module: Core Governance — Single Source of Truth Positive Standard Terminology Catalog
 * File Path: src/core/governance/standard-terminology.ts
 * Architecture Role: Central taxonomy, standardized remediation action verbs, and diagnostic
 *   verdict specifications for the dual-faced review architecture (Agent-Facing & Human-Facing).
 * Dependencies & Triggers: Consumed by types.ts, terminology-engine.ts, reporters, and analyzers.
 * Responsibilities:
 *   1. Declare the canonical 6-domain defect taxonomies (Taxonomy).
 *   2. Declare the 16+ machine-actionable remediation verbs (Remediation Actions).
 *   3. Declare standardized diagnostic verdicts (BLOCK, WARN, INFO, PASS).
 *   4. Provide deterministic catalog lookups and format helpers for dual-faced presentation.
 * Exit Semantics & Design Rationale: Fully immutable, frozen catalogs; zero side-effects.
 */

/** Six canonical defect taxonomies governing workspace quality dimensions */
export type DefectTaxonomyCategory =
    'ARCH_LAYER' | 'CTRL_FLOW' | 'NUM_PREC' | 'TEST_MODERN' | 'GOV_NORM' | 'SEC_GUARD';

/** Metadata describing a defect taxonomy domain */
export interface DefectTaxonomySpec {
    readonly code: DefectTaxonomyCategory;
    readonly title: string;
    readonly description: string;
    readonly zhTitle: string;
    readonly zhDescription: string;
}

/** Single source of truth specifications for defect taxonomies */
export const DEFECT_TAXONOMY_SPECS: Readonly<Record<DefectTaxonomyCategory, DefectTaxonomySpec>> =
    Object.freeze({
        ARCH_LAYER: Object.freeze({
            code: 'ARCH_LAYER',
            title: 'Architectural Layer Boundary',
            description:
                'Boundary compliance, clean separation of concerns, and dependency graph integrity.',
            zhTitle: '架构分层与依赖边界',
            zhDescription: '分层拓扑隔离、领域依赖纯净度与循环依赖防护。',
        }),
        CTRL_FLOW: Object.freeze({
            code: 'CTRL_FLOW',
            title: 'Control Flow & Complexity',
            description:
                'Cyclomatic complexity, nesting depth limits, and guard-clause flattening.',
            zhTitle: '控制流与复杂度预算',
            zhDescription: '单函数圈复杂度、控制流嵌套深度与卫语句平铺控制流。',
        }),
        NUM_PREC: Object.freeze({
            code: 'NUM_PREC',
            title: 'Numerical & Floating-Point Precision',
            description:
                'Precision rounding standards (0.01), IEEE 754 negative zero prevention, and compact ledger boundaries.',
            zhTitle: '数值精度与截断安全',
            zhDescription: '浮点数两位小数精度对齐、IEEE 754 负零消除与紧凑账本单行物理预算。',
        }),
        TEST_MODERN: Object.freeze({
            code: 'TEST_MODERN',
            title: 'Test Modernity & Invariant Verification',
            description:
                'Elimination of tautological assertions, fragile floating-point equality, and mock-only integrity illusions.',
            zhTitle: '测试现代性与断言真伪',
            zhDescription: '杜绝同义反复虚假断言、浮点裸字面量脆弱等值与仅验证桩对象的假象测试。',
        }),
        GOV_NORM: Object.freeze({
            code: 'GOV_NORM',
            title: 'Engineering Norms & Terminology Sanitization',
            description:
                'Physical naming conventions, zero empty files, and objective technical prose sanitization.',
            zhTitle: '工程规范与技术用语客观化',
            zhDescription: '物理命名对齐、全工作区零空文件守卫与去口号化求真务实技术用语。',
        }),
        SEC_GUARD: Object.freeze({
            code: 'SEC_GUARD',
            title: 'Security & Secret Guard',
            description:
                'High-entropy secret detection, token leaks, and defensive security boundaries.',
            zhTitle: '安全防护与凭证防泄漏',
            zhDescription: '高熵敏感密钥防泄漏、协议路径防护与安全鉴权拦截。',
        }),
    });

/** Standardized remediation action verb enumeration */
export type StandardActionVerb =
    | 'extract_pure_predicate'
    | 'apply_guard_clause'
    | 'align_numeric_precision'
    | 'replace_with_tolerance_assertion'
    | 'sanitize_prose_terminology'
    | 'decouple_facade'
    | 'extract_constant'
    | 'hoist_declaration'
    | 'narrow_scope'
    | 'split_function'
    | 'simplify_control_flow'
    | 'replace_token'
    | 'insert_comment_contract'
    | 'guard_recursion'
    | 'use_constant_time_comparison'
    | 'scaffold_constant_library'
    | 'scaffold_gate_system';

/** Specification contract for a standardized remediation action verb */
export interface ActionVerbSpec {
    readonly verb: StandardActionVerb;
    readonly taxonomy: DefectTaxonomyCategory;
    readonly description: string;
    readonly zhDescription: string;
    readonly safeToAutomateDefault: boolean;
    readonly typicalFixTemplate: string;
}

/** Canonical register of 17 machine-actionable remediation verbs */
export const ACTION_VERB_SPECS: Readonly<Record<StandardActionVerb, ActionVerbSpec>> =
    Object.freeze({
        extract_pure_predicate: Object.freeze({
            verb: 'extract_pure_predicate',
            taxonomy: 'CTRL_FLOW',
            description:
                'Extract multi-branch or regex conditions into an independent, stateless pure function to reduce CC.',
            zhDescription: '将复合判定或正则提取为无状态纯函数以降低圈复杂度。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'function isPredicateName(arg: Type): boolean { return ...; }',
        }),
        apply_guard_clause: Object.freeze({
            verb: 'apply_guard_clause',
            taxonomy: 'CTRL_FLOW',
            description:
                'Invert branching condition to return early, flattening nested indentation.',
            zhDescription: '逆向断言提前返回以平铺深层控制流嵌套。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'if (!condition) return defaultValue;',
        }),
        align_numeric_precision: Object.freeze({
            verb: 'align_numeric_precision',
            taxonomy: 'NUM_PREC',
            description:
                'Normalize calculation rounding to 0.01 precision and normalize IEEE 754 negative zero.',
            zhDescription: '规范四舍五入缩放系数至两位小数 (0.01) 并消除 -0 符号差异。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'Math.round(val * 100) / 100 + 0',
        }),
        replace_with_tolerance_assertion: Object.freeze({
            verb: 'replace_with_tolerance_assertion',
            taxonomy: 'TEST_MODERN',
            description:
                'Replace brittle floating-point direct equality with tolerance matchers (e.g. toBeCloseTo or isScoreEqual).',
            zhDescription: '将脆弱的浮点绝对等值断言替换为容差比较函数或 toBeCloseTo。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'expect(actual).toBeCloseTo(expected, 2)',
        }),
        sanitize_prose_terminology: Object.freeze({
            verb: 'sanitize_prose_terminology',
            taxonomy: 'GOV_NORM',
            description:
                'Replace informal, hyperbolic, or speculative terminology with objective factual statements.',
            zhDescription: '将临时性、夸大性或主观评价词汇替换为客观中立的技术事实陈述。',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'State verifiable technical scope and bounds.',
        }),
        decouple_facade: Object.freeze({
            verb: 'decouple_facade',
            taxonomy: 'ARCH_LAYER',
            description:
                'Eliminate single-line vacuous trampoline files or satisfy facade ELOC/contract budget.',
            zhDescription: '消除单行空包转发跳板或为门面注入实质契约校验与不可变性冻结。',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'Inline export target and delete trampoline module.',
        }),
        extract_constant: Object.freeze({
            verb: 'extract_constant',
            taxonomy: 'GOV_NORM',
            description:
                'Extract naked literal number or string into a single-source-of-truth constant.',
            zhDescription: '将裸字面量提取为模块或领域级单一真源常量。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'const CONSTANT_NAME = value;',
        }),
        hoist_declaration: Object.freeze({
            verb: 'hoist_declaration',
            taxonomy: 'CTRL_FLOW',
            description:
                'Hoist invariants, regex compilations, or object allocations outside of hot loops.',
            zhDescription: '将循环内不变分配、正则构建或配置解析提升至循环外。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'const invariant = init(); while (...) { use(invariant); }',
        }),
        narrow_scope: Object.freeze({
            verb: 'narrow_scope',
            taxonomy: 'ARCH_LAYER',
            description:
                'Restrict excessive symbol or module visibility to private/internal boundaries.',
            zhDescription: '收敛过度导出的符号或模块至私有/局部作用域。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'Remove export modifier or relocate to internal file.',
        }),
        split_function: Object.freeze({
            verb: 'split_function',
            taxonomy: 'CTRL_FLOW',
            description:
                'Decompose a monolithic function into focused, single-responsibility sub-procedures.',
            zhDescription: '将超长函数拆解为职责单一的独立子过程。',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'Extract sub-steps into helper procedures.',
        }),
        simplify_control_flow: Object.freeze({
            verb: 'simplify_control_flow',
            taxonomy: 'CTRL_FLOW',
            description: 'Simplify convoluted boolean expressions or nested ternary operators.',
            zhDescription: '简化冗长布尔逻辑或多重嵌套三元表达式。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'Simplify boolean flags via lookup tables or early exits.',
        }),
        replace_token: Object.freeze({
            verb: 'replace_token',
            taxonomy: 'GOV_NORM',
            description: 'Replace obsolete or deprecated language keywords and syntax tokens.',
            zhDescription: '替换过时或废弃的语法关键字与绑定模式。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'Replace var with const/let.',
        }),
        insert_comment_contract: Object.freeze({
            verb: 'insert_comment_contract',
            taxonomy: 'GOV_NORM',
            description:
                'Provide structured JSDoc contract declarations (@param, @returns, @throws).',
            zhDescription: '补齐结构化 JSDoc 契约声明与参数文档。',
            safeToAutomateDefault: true,
            typicalFixTemplate: '/** @param x - Description\n * @returns Result */',
        }),
        guard_recursion: Object.freeze({
            verb: 'guard_recursion',
            taxonomy: 'CTRL_FLOW',
            description:
                'Add depth or visited-set guard to recursive traversals to prevent stack overflow.',
            zhDescription: '为递归遍历追加深度上限或已访问集合以杜绝调用栈溢出。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'if (depth > MAX_DEPTH || visited.has(node)) return;',
        }),
        use_constant_time_comparison: Object.freeze({
            verb: 'use_constant_time_comparison',
            taxonomy: 'SEC_GUARD',
            description:
                'Use timing-safe equality comparison for cryptographic tokens and signatures.',
            zhDescription: '使用恒定时间比对函数比对安全敏感口令或签名以防时序侧信道攻击。',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'crypto.timingSafeEqual(bufA, bufB)',
        }),
        scaffold_constant_library: Object.freeze({
            verb: 'scaffold_constant_library',
            taxonomy: 'GOV_NORM',
            description: 'Organize scattered domain literals into a cohesive constant registry.',
            zhDescription: '将离散常量归拢为结构化常量字典或拓扑库。',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'Export clustered constants under a domain namespace.',
        }),
        scaffold_gate_system: Object.freeze({
            verb: 'scaffold_gate_system',
            taxonomy: 'GOV_NORM',
            description: 'Establish standard pre-commit or pre-push verification gates.',
            zhDescription: '落地标准化提交前或推送前双层质量守卫流水线。',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'Wire script into hooks and manifest.',
        }),
    });

/** Canonical diagnostic verdict enumeration */
export type StandardDiagnosticVerdict = 'BLOCK' | 'WARN' | 'INFO' | 'PASS';

/**
 * Resolves the defect taxonomy category for a canonical rule ID.
 *
 * @param ruleId - Canonical rule ID (e.g. ADV-CMP-001, NUM-PREC-001)
 * @returns Categorized defect taxonomy
 */
export function resolveRuleTaxonomy(ruleId: string): DefectTaxonomyCategory {
    if (!ruleId) {
        return 'GOV_NORM';
    }
    const upper = ruleId.toUpperCase();
    if (upper.startsWith('ADV-CMP') || upper.startsWith('ADV-NST') || upper.startsWith('SIM-')) {
        return 'CTRL_FLOW';
    }
    if (upper.startsWith('NUM-') || upper.startsWith('PREC-')) {
        return 'NUM_PREC';
    }
    if (upper.startsWith('TST-') || upper.startsWith('TEST-')) {
        return 'TEST_MODERN';
    }
    if (upper.startsWith('SEC-') || upper.startsWith('SECRET-')) {
        return 'SEC_GUARD';
    }
    if (
        upper.startsWith('ARCH-') ||
        upper.startsWith('LAYER-') ||
        upper.startsWith('DEP-') ||
        upper.startsWith('FAC-')
    ) {
        return 'ARCH_LAYER';
    }
    return 'GOV_NORM';
}

/**
 * Validates whether an action verb is registered in the standard SSOT catalog.
 *
 * @param verb - Action verb candidate string
 * @returns True if registered
 */
export function isStandardActionVerb(verb: string): verb is StandardActionVerb {
    return Object.prototype.hasOwnProperty.call(ACTION_VERB_SPECS, verb);
}
