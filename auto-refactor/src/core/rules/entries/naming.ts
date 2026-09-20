/**
 * Module: Core Engine — Rule Registry (naming governance entries)
 * File Path: src/core/rules/entries/naming.ts
 * Architecture Role: Declarative rule metadata for the naming governance domain; index in
 *   ./registry.ts concatenates this list into the single RULE_REGISTRY source of truth.
 * Dependencies & Triggers: core rule types plus defineRule(); consumed by ./registry.ts
 * Responsibilities: Declare RuleDefinition entries for NAM-FIL-001, NAM-DIR-001, NAM-GLB-001,
 *   NAM-GLB-002, NAM-TYP-001, NAM-MBR-001, NAM-VAG-001, NAM-SGL-001, and NAM-COL-001.
 * Exit Semantics & Design Rationale: Pure data, no behaviour. Provides a unified identity and
 *   documentation anchor for all naming governance and hygiene rules across languages.
 */
import type { RuleDefinition } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    SEVERITY_WARNING,
    SEVERITY_INFO,
    RULE_FAMILY_NAMING,
} from '../types';
import { ANALYZER_NAMING } from '../../scoring/dimensionLiterals';

/**
 * Naming governance rule table: every rule whose owner is the naming analyzer.
 */
export const NAMING_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: 'NAM-FIL-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            '文件命名必须符合语言惯例（TS/JS 强制 kebab-case，Python/Rust/GDScript 强制 snake_case），严禁临时批次黑话。',
        remediation:
            '将文件名规范重命名为对应语言的标准格式（如 `foo-bar.ts` 或 `foo_bar.py`），且不可带有临时标记。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-fil-001',
    }),
    defineRule({
        id: 'NAM-DIR-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '源码目录名必须为全小写 kebab-case 或单名，严禁 CamelCase、空格及临时批次词。',
        remediation: '将目录重命名为全小写短横线风格（如 `ast-utils`、`pipeline`）。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-dir-001',
    }),
    defineRule({
        id: 'NAM-GLB-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '模块顶层不可变常量必须遵循 UPPER_SNAKE_CASE 命名规范。',
        remediation:
            '将模块级原始常量重命名为大写蛇形命名（如 `MAX_RETRIES`、`DEFAULT_TIMEOUT`）。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-glb-001',
    }),
    defineRule({
        id: 'NAM-GLB-002',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '严禁在模块顶层声明可变 `let` 或 `var` 变量（隐式全局共享状态）。',
        remediation: '重构顶层可变状态为函数作用域变量、类实例属性或显式单例状态持有者。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-glb-002',
    }),
    defineRule({
        id: 'NAM-TYP-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '类型定义与类声明必须遵循 PascalCase 大驼峰命名。',
        remediation:
            '将类、接口、类型别名或枚举重命名为大驼峰格式（如 `Scanner`、`RuleDefinition`）。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-typ-001',
    }),
    defineRule({
        id: 'NAM-MBR-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '类属性、对象字段与方法名必须遵循 camelCase 小驼峰命名规范。',
        remediation: '将属性和方法名调整为清晰有意义的小驼峰命名。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-mbr-001',
    }),
    defineRule({
        id: 'NAM-VAG-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '严禁使用无业务语义的模糊泛化变量名（如 data、res、ret、tmp、item 等裸词）。',
        remediation:
            '结合业务领域语义补齐前缀或后缀（如 `parseResult`、`tokenPayload`、`ruleEntry`）。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-vag-001',
    }),
    defineRule({
        id: 'NAM-SGL-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '严禁在业务逻辑中使用单字母变量名（仅循环头计数器与 discard 占位符豁免）。',
        remediation: '改用能表达具体意图的具名标识符；仅 `for (let i = ...)`、`_` 允许单字母。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-sgl-001',
    }),
    defineRule({
        id: 'NAM-COL-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary: '集合（Array/Set）建议使用复数或 List 后缀，映射（Map/Dict）建议表达对应关系。',
        remediation: '为数组集合增加复数形态，为字典映射添加 `*To*` 或 `*By*` 表达关联意图。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-col-001',
    }),
];
