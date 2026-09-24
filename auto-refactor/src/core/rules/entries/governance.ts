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
import type { RuleDefinition, RuleSeverity } from '../types';
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

/** Languages the CMP-* family is declared for. */
const CMP_LANGUAGES: readonly string[] = [LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT];
const LANGUAGES_TS_JS: readonly string[] = [LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT];
const LANGUAGES_TS: readonly string[] = [LANGUAGE_TYPESCRIPT];
const LANGUAGES_EXC_001: readonly string[] = [
    LANGUAGE_TYPESCRIPT,
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_PYTHON,
];
const LANGUAGES_RUST: readonly string[] = [LANGUAGE_RUST];

function defineGov(
    id: string,
    languages: readonly string[],
    defaultSeverity: RuleSeverity,
    summary: string,
    remediation: string,
    docsAnchor: string,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages,
        defaultSeverity,
        summary,
        remediation,
        docsAnchor,
    });
}

function defineCmp(
    id: string,
    defaultSeverity: RuleSeverity,
    summary: string,
    remediation: string,
    docsAnchor: string,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_CMP,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: CMP_LANGUAGES,
        defaultSeverity,
        summary,
        remediation,
        docsAnchor,
    });
}

/** governance rules. */
export const GOVERNANCE_RULES: readonly RuleDefinition[] = [
    defineGov(
        'GOV-AGN-001',
        ALL_LANGUAGES,
        SEVERITY_ERROR,
        'Concurrent modifications by multiple agents produce architectural boundary breaches, cross-module dependency cycles, or contract incompatibilities.',
        '协调并行 Agent 的架构边界与修改职责，消解跨模块并发循环依赖并维护单向分层契约。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-agn-001',
    ),
    defineGov(
        'GOV-SLC-001',
        ALL_LANGUAGES,
        SEVERITY_ERROR,
        'AST slice mutation introduces breaking signature drift or uncontained side-effects propagating across external call chains.',
        '确保切片改动向后兼容，或同步重构受影响调用链上的全部外部调用者。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-slc-001',
    ),
    defineGov(
        'GOV-TRJ-001',
        ALL_LANGUAGES,
        SEVERITY_ERROR,
        'Historical trajectory exhibits cyclic regressions, flip-flop oscillations, or re-introduces previously eliminated architectural anti-patterns.',
        '确保演化轨迹保持单调质量提升，避免在后续修订中死灰复燃已被重构配方消除的架构反模式。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-trj-001',
    ),
    defineGov(
        'GOV-DBG-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Debug and console print statements clutter standard outputs, leak diagnostics, and can degrade I/O throughput.',
        '删除调试输出，或改用结构化日志并按级别输出。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-dbg-001',
    ),
    defineGov(
        'GOV-MSG-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        '底层诊断消息与修复建议必须统一采用标准英文并由常量字典集中管控，严禁在分析器发射点硬编码内联或非 ASCII 文本。',
        '将内联错误提示提取至 `src/core/messages/` 集中常量池，并确保文案符合英语工业技术标准。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-msg-001',
    ),
    defineGov(
        'GOV-RTC-002',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Baseline debt entries must track physical file rename operations without artificial inflation or false positive churn. Monotonic downward ratchets must remap prior baselines to new paths upon refactoring.',
        '在基线更新与门禁收敛中应用重命名路径规范化映射 (pathRemap)，确保文件重构后既有基线连续继承，严禁因重命名引发基线虚增或债务逃逸。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-rtc-002',
    ),
    defineGov(
        'GOV-EXC-001',
        LANGUAGES_EXC_001,
        SEVERITY_ERROR,
        'Empty catch blocks silently swallow exceptions, causing silent data corruption or masking critical failures. A catch whose body carries an explicit rationale marker (best-effort / ignore / intentional / expected) is treated as a documented decision instead of a silent swallow.',
        '处理/记录/显式重抛；确属 best-effort 时在 catch 内写明理由标记。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-exc-001',
    ),
    defineGov(
        'GOV-EXC-002',
        LANGUAGES_RUST,
        SEVERITY_WARNING,
        'Naked `.unwrap()` causes unrecoverable process panics in production upon Err or None.',
        '避免裸 unwrap/expect，改为显式错误分支或 Result/Option 传播。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-exc-002',
    ),
    defineGov(
        'GOV-EXC-003',
        LANGUAGES_EXC_001,
        SEVERITY_ERROR,
        'Pseudo-catch blocks containing only dummy non-handling statements (void 0, dead assignment) silently swallow exceptions without logging or documented rationale.',
        '在 catch/except 块中补充结构化日志、错误重抛或在注释中显式标注 rationale 标记（如 best-effort, expected）。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-exc-003',
    ),
    defineGov(
        'GOV-FIL-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Inconsistent file naming causes cross-platform casing issues and impairs modular discovery.',
        '按语言命名契约重命名文件（kebab-case 或 snake_case）。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-fil-001',
    ),
    defineGov(
        'GOV-FIL-002',
        ALL_LANGUAGES,
        SEVERITY_INFO,
        'Substantial production modules must declare their architectural role and responsibility boundary.',
        '修正文件头声明路径，或补齐缺失的头部字段。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-fil-002',
    ),
    defineGov(
        'GOV-LOG-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Deeply nested control flows (> 5 levels) create high cognitive load and increase defect risk.',
        '降低嵌套：卫语句早返回、抽取子步骤或扁平化分支。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-log-001',
    ),
    defineGov(
        'GOV-LOG-002',
        ALL_LANGUAGES,
        SEVERITY_INFO,
        'Vacuous wrapper methods that purely forward calls without validation or translation add unnecessary indirection.',
        '去掉直通式包装，让调用方直达目标或合并职责。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-log-002',
    ),
    defineGov(
        'GOV-GAM-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Anti-gaming violation: artificial function splitting, tautological test padding, or empty boilerplate gaming quality metrics.',
        '保持业务内聚并编写有实质断言的真实测试用例，杜绝空样板与假测试。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-gam-001',
    ),
    defineGov(
        'GOV-MNT-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Deep class inheritance hierarchies (> 2 levels) introduce fragile base class problems; composition is preferred.',
        '收敛继承层级：组合优先，或抽公共能力为独立模块。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-mnt-001',
    ),
    defineGov(
        'GOV-MNT-002',
        ALL_LANGUAGES,
        SEVERITY_ERROR,
        'Domain layer must remain clean and portable; importing UI or CLI presentation frameworks introduces severe coupling.',
        '反转依赖：内层定义端口/接口，由外层实现。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-mnt-002',
    ),
    defineGov(
        'GOV-PRF-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Performing invariant I/O, regex construction, or repetitive configuration lookups in loops incurs severe CPU/throughput penalties.',
        '循环不变量外提，把不变计算移出循环体。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-001',
    ),
    defineGov(
        'GOV-PRF-002',
        ALL_LANGUAGES,
        SEVERITY_INFO,
        'Calling linear search (.find / .indexOf / .includes) inside a loop scales at O(N*M); pre-indexing in Map/Set optimizes to O(N).',
        '用 Set/Map 承载查找，消除循环内线性扫描。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-002',
    ),
    defineGov(
        'GOV-PRF-003',
        LANGUAGES_TS_JS,
        SEVERITY_ERROR,
        'Numeric timer delays bypass centralized clamping; a literal of <=0 triggers a ~1ms busy loop (CPU/IO hotspot).',
        '定时器延时常量具名或走集中配置，避免绕过统一钳制。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-003',
    ),
    defineGov(
        'GOV-PRF-004',
        LANGUAGES_TS_JS,
        SEVERITY_WARNING,
        'Sync fs calls block the host event loop (UI jank in IDE extensions, request stalls on servers).',
        '改用异步 IO；进程式 CLI 路径可用 blockingIoAllowPatterns 声明豁免。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-004',
    ),
    defineGov(
        'GOV-PRF-005',
        ALL_LANGUAGES,
        SEVERITY_INFO,
        'Calling array linear lookups (.includes / .indexOf) inside loops creates quadratic O(N*M) overhead; pre-indexing into a Set hoisted outside the loop optimizes membership tests to O(1).',
        '在循环前将只读数组提升为 Set 预建索引（const set = new Set(arr)），循环内改用 set.has() 进行 O(1) 检索。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-005',
    ),
    defineGov(
        'GOV-DAT-001',
        ALL_LANGUAGES,
        SEVERITY_INFO,
        'Functions declaring excessive discrete scalar parameters (>= 5) exhibit Data Clumps smell; parameters should be aggregated into a named Context or Options interface.',
        '将离散参数群聚合为强类型的结构化上下文模型（如 Context 或 Options 接口对象），提高契约内聚性。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-dat-001',
    ),
    defineGov(
        'GOV-SAN-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Transient task tags and batch jargon (pXX/phaseXX/stXX/wip) compromise architectural longevity and create documentation drift.',
        '移除临时工单/批次黑话，改用长效领域术语。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-san-001',
    ),
    defineGov(
        'GOV-STD-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Redundant if-then-else returning boolean literals increases cyclomatic complexity and mental overhead.',
        '直接 return 布尔表达式，去掉 if/else 包装。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-std-001',
    ),
    defineGov(
        'GOV-STD-002',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Legacy constructs (e.g. `var` in modern TS/JS, dead `pass` in GDScript) violate language idiomatic standards.',
        '替换废弃构造（var、legacy 键名等）为现代等价写法。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-std-002',
    ),
    defineGov(
        'GOV-TYP-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Implicit loose typing hides type errors at runtime and weakens static safety guarantees.',
        '为变量/参数补齐类型注解。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-001',
    ),
    defineGov(
        'GOV-TYP-002',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Unannotated function signatures compromise API boundaries and allow unintended type drift.',
        '为函数补齐返回类型注解。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-002',
    ),
    defineGov(
        'GOV-TYP-003',
        LANGUAGES_TS,
        SEVERITY_WARNING,
        'Naked `any` bypasses the entire compiler type checker, leaking type instability.',
        '裸 any 换成 unknown 或具体联合；动态边界用受控断言并注释理由。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-003',
    ),
    defineGov(
        'GOV-TYP-004',
        LANGUAGES_TS,
        SEVERITY_WARNING,
        'Passing or assigning `undefined as any` or `null as any` indicates an Interface Segregation Principle (ISP) violation.',
        '将目标参数声明为可选联合类型或拆分专有接口，消除强制类型断言。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-004',
    ),
    defineGov(
        'GOV-TYP-005',
        LANGUAGES_TS,
        SEVERITY_WARNING,
        'Accessing properties via `(expr as any).prop` bypasses compiler type safety and indicates missing type narrowing guards.',
        '使用标准类型收窄谓词（如 ts.canHaveModifiers 或 isXxx）保护属性访问。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-005',
    ),
    defineCmp(
        'CMP-EXP-001',
        SEVERITY_WARNING,
        'Giant expressions with deeply nested ternaries or unbounded logical chains create cognitive overload and obscure branching logic.',
        '将巨型嵌套三元或长逻辑链拆分为具名中间变量或 if-else 分支。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-exp-001',
    ),
    defineCmp(
        'CMP-LIN-001',
        SEVERITY_WARNING,
        'Cramming multiple distinct statements or side-effects onto a single line impairs stack traces, debug stepping, and code readability.',
        '将单行内的多个语句或副作用拆分为独立代码行，遵循单行单一语义原则。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-lin-001',
    ),
    defineCmp(
        'CMP-CAL-001',
        SEVERITY_WARNING,
        'Deeply nested inline callback chains create callback hell, complicate exception propagation, and mask race conditions.',
        '降低回调嵌套深度：改用 async/await、Promise 链扁平化或抽取具名顶层函数。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-cal-001',
    ),
    defineCmp(
        'CMP-DEN-001',
        SEVERITY_WARNING,
        'Dense syntactic packing of bitwise, arithmetic and conditional operators without naming or spacing exceeds human cognitive chunking capacity.',
        '降低认知密度：添加适当空白与具名中间常量，拆分高密度算式或位运算组合。',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-den-001',
    ),
];
