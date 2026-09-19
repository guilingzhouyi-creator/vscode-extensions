/**
 * Module: Core Engine — Rule Registry (governance entries)
 * File Path: src/core/rules/entries/governance.ts
 * Architecture Role: Declarative rule metadata for one domain; the index in ./registry.ts
 *   concatenates every domain into the single RULE_REGISTRY source of truth.
 * Dependencies & Triggers: core rule types plus defineRule(); consumed by ./registry.ts
 * Responsibilities: List { id, family, analyzer, canonical flag, legacy reason, languages,
 *   default severity, summary, remediation, docs anchor } for each emitted rule id.
 * Exit Semantics & Design Rationale: Pure data, no behaviour. Entries are grouped by owning
 *   domain (governance rules vs built-in analyzer rules vs platform/legacy ids) so the registry
 *   stays readable and never becomes a monolith.
 */
import type { RuleDefinition } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    RULE_FAMILY_GOVERNANCE,
    RULE_FAMILY_CMP,
    SEVERITY_INFO,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    LANGUAGE_TYPESCRIPT,
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_PYTHON,
    LANGUAGE_RUST,
} from '../types';
import { ANALYZER_GOVERNANCE } from '../../scoring/dimensionLiterals';

/**
 * Languages the CMP-* family is declared for.
 *
 * Its detectors key on C-family syntax (`;` statements, `? :` ternaries, `=>` callbacks), so the
 * declaration stays equal to the set of languages a fixture actually proves rather than claiming
 * every language the engine can scan.
 */
const CMP_LANGUAGES: readonly string[] = [LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT];
const LANGUAGES_TS_JS: readonly string[] = [LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT];
const LANGUAGES_TS: readonly string[] = [LANGUAGE_TYPESCRIPT];
const LANGUAGES_EXC_001: readonly string[] = [
    LANGUAGE_TYPESCRIPT,
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_PYTHON,
];
const LANGUAGES_RUST: readonly string[] = [LANGUAGE_RUST];

/** governance rules. */
export const GOVERNANCE_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: 'GOV-AGN-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Concurrent modifications by multiple agents produce architectural boundary breaches, cross-module dependency cycles, or contract incompatibilities.',
        remediation:
            '协调并行 Agent 的架构边界与修改职责，消解跨模块并发循环依赖并维护单向分层契约。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-agn-001',
    }),
    defineRule({
        id: 'GOV-SLC-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'AST slice mutation introduces breaking signature drift or uncontained side-effects propagating across external call chains.',
        remediation: '确保切片改动向后兼容，或同步重构受影响调用链上的全部外部调用者。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-slc-001',
    }),
    defineRule({
        id: 'GOV-TRJ-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Historical trajectory exhibits cyclic regressions, flip-flop oscillations, or re-introduces previously eliminated architectural anti-patterns.',
        remediation:
            '确保演化轨迹保持单调质量提升，避免在后续修订中死灰复燃已被重构配方消除的架构反模式。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-trj-001',
    }),
    defineRule({
        id: 'GOV-DBG-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Debug and console print statements clutter standard outputs, leak diagnostics, and can degrade I/O throughput.',
        remediation: '删除调试输出，或改用结构化日志并按级别输出。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-dbg-001',
    }),
    defineRule({
        id: 'GOV-EXC-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: LANGUAGES_EXC_001,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Empty catch blocks silently swallow exceptions, causing silent data corruption or masking critical failures. A catch whose body carries an explicit rationale marker (best-effort / ignore / intentional / expected) is treated as a documented decision instead of a silent swallow.',
        remediation: '处理/记录/显式重抛；确属 best-effort 时在 catch 内写明理由标记。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-exc-001',
    }),
    defineRule({
        id: 'GOV-EXC-002',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: LANGUAGES_RUST,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Naked `.unwrap()` causes unrecoverable process panics in production upon Err or None.',
        remediation: '避免裸 unwrap/expect，改为显式错误分支或 Result/Option 传播。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-exc-002',
    }),
    defineRule({
        id: 'GOV-EXC-003',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: LANGUAGES_EXC_001,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Pseudo-catch blocks containing only dummy non-handling statements (void 0, dead assignment) silently swallow exceptions without logging or documented rationale.',
        remediation:
            '在 catch/except 块中补充结构化日志、错误重抛或在注释中显式标注 rationale 标记（如 best-effort, expected）。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-exc-003',
    }),
    defineRule({
        id: 'GOV-FIL-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Inconsistent file naming causes cross-platform casing issues and impairs modular discovery.',
        remediation: '按语言命名契约重命名文件（kebab-case 或 snake_case）。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-fil-001',
    }),
    defineRule({
        id: 'GOV-FIL-002',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Substantial production modules must declare their architectural role and responsibility boundary.',
        remediation: '修正文件头声明路径，或补齐缺失的头部字段。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-fil-002',
    }),
    defineRule({
        id: 'GOV-LOG-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Deeply nested control flows (> 5 levels) create high cognitive load and increase defect risk.',
        remediation: '降低嵌套：卫语句早返回、抽取子步骤或扁平化分支。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-log-001',
    }),
    defineRule({
        id: 'GOV-LOG-002',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Vacuous wrapper methods that purely forward calls without validation or translation add unnecessary indirection.',
        remediation: '去掉直通式包装，让调用方直达目标或合并职责。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-log-002',
    }),
    defineRule({
        id: 'GOV-GAM-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Anti-gaming violation: artificial function splitting, tautological test padding, or empty boilerplate gaming quality metrics.',
        remediation: '保持业务内聚并编写有实质断言的真实测试用例，杜绝空样板与假测试。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-gam-001',
    }),
    defineRule({
        id: 'GOV-MNT-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Deep class inheritance hierarchies (> 2 levels) introduce fragile base class problems; composition is preferred.',
        remediation: '收敛继承层级：组合优先，或抽公共能力为独立模块。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-mnt-001',
    }),
    defineRule({
        id: 'GOV-MNT-002',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Domain layer must remain clean and portable; importing UI or CLI presentation frameworks introduces severe coupling.',
        remediation: '反转依赖：内层定义端口/接口，由外层实现。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-mnt-002',
    }),
    defineRule({
        id: 'GOV-PRF-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Performing invariant I/O, regex construction, or repetitive configuration lookups in loops incurs severe CPU/throughput penalties.',
        remediation: '循环不变量外提，把不变计算移出循环体。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-001',
    }),
    defineRule({
        id: 'GOV-PRF-002',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Calling linear search (.find / .indexOf / .includes) inside a loop scales at O(N*M); pre-indexing in Map/Set optimizes to O(N).',
        remediation: '用 Set/Map 承载查找，消除循环内线性扫描。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-002',
    }),
    defineRule({
        id: 'GOV-PRF-003',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: LANGUAGES_TS_JS,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Numeric timer delays bypass centralized clamping; a literal of <=0 triggers a ~1ms busy loop (CPU/IO hotspot).',
        remediation: '定时器延时常量具名或走集中配置，避免绕过统一钳制。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-003',
    }),
    defineRule({
        id: 'GOV-PRF-004',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: LANGUAGES_TS_JS,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Sync fs calls block the host event loop (UI jank in IDE extensions, request stalls on servers).',
        remediation: '改用异步 IO；进程式 CLI 路径可用 blockingIoAllowPatterns 声明豁免。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-004',
    }),
    defineRule({
        id: 'GOV-SAN-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Transient task tags and batch jargon (pXX/phaseXX/stXX/wip) compromise architectural longevity and create documentation drift.',
        remediation: '移除临时工单/批次黑话，改用长效领域术语。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-san-001',
    }),
    defineRule({
        id: 'GOV-STD-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Redundant if-then-else returning boolean literals increases cyclomatic complexity and mental overhead.',
        remediation: '直接 return 布尔表达式，去掉 if/else 包装。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-std-001',
    }),
    defineRule({
        id: 'GOV-STD-002',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Legacy constructs (e.g. `var` in modern TS/JS, dead `pass` in GDScript) violate language idiomatic standards.',
        remediation: '替换废弃构造（var、legacy 键名等）为现代等价写法。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-std-002',
    }),
    defineRule({
        id: 'GOV-TYP-001',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Implicit loose typing hides type errors at runtime and weakens static safety guarantees.',
        remediation: '为变量/参数补齐类型注解。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-001',
    }),
    defineRule({
        id: 'GOV-TYP-002',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Unannotated function signatures compromise API boundaries and allow unintended type drift.',
        remediation: '为函数补齐返回类型注解。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-002',
    }),
    defineRule({
        id: 'GOV-TYP-003',
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: LANGUAGES_TS,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Naked `any` bypasses the entire compiler type checker, leaking type instability.',
        remediation: '裸 any 换成 unknown 或具体联合；动态边界用受控断言并注释理由。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-003',
    }),
    defineRule({
        id: 'CMP-EXP-001',
        family: RULE_FAMILY_CMP,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: CMP_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Giant expressions with deeply nested ternaries or unbounded logical chains create cognitive overload and obscure branching logic.',
        remediation: '将巨型嵌套三元或长逻辑链拆分为具名中间变量或 if-else 分支。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-exp-001',
    }),
    defineRule({
        id: 'CMP-LIN-001',
        family: RULE_FAMILY_CMP,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: CMP_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Cramming multiple distinct statements or side-effects onto a single line impairs stack traces, debug stepping, and code readability.',
        remediation: '将单行内的多个语句或副作用拆分为独立代码行，遵循单行单一语义原则。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-lin-001',
    }),
    defineRule({
        id: 'CMP-CAL-001',
        family: RULE_FAMILY_CMP,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: CMP_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Deeply nested inline callback chains create callback hell, complicate exception propagation, and mask race conditions.',
        remediation: '降低回调嵌套深度：改用 async/await、Promise 链扁平化或抽取具名顶层函数。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-cal-001',
    }),
    defineRule({
        id: 'CMP-DEN-001',
        family: RULE_FAMILY_CMP,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: CMP_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Dense syntactic packing of bitwise, arithmetic and conditional operators without naming or spacing exceeds human cognitive chunking capacity.',
        remediation: '降低认知密度：添加适当空白与具名中间常量，拆分高密度算式或位运算组合。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-den-001',
    }),
];
