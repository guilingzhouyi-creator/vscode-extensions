/**
 * Module: Core Rules — Shared Entry Constants & Modernization Rule Entries
 * File Path: src/core/rules/entries/analyzersModern.ts
 * Architecture Role: Owns the shared rule-entry constants plus the second half of the analyzer
 *   rule table (modernization and architecture/dependency families), so both registry files
 *   stay inside the size budget without a value-level import cycle.
 * Dependencies & Triggers: ../types (RuleDefinition, defineRule, ALL_LANGUAGES); the constants
 *   and ANALYZER_MODERN_RULES are imported by entries/analyzers.ts, which spreads the batch
 *   after its own entries.
 * Responsibilities: Declare each shared family/analyzer/severity/language constant and each
 *   modernization/architecture rule id, matcher, severity, and remediation text.
 * Exit Semantics & Design Rationale: Pure data module — no runtime logic; keeping the
 *   constants here makes the dependency direction one-way (analyzers -> analyzersModern).
 */
import { ALL_LANGUAGES, defineRule } from '../types';
import type { RuleDefinition } from '../types';

/** Rule-id family prefix for comment rules; every id starts with `CMT-`. */
export const RULE_FAMILY_COMMENTS = 'CMT';
/** Analyzer id owning every comment rule in this registry domain. */
export const ANALYZER_COMMENTS = 'comments';
/** Rule-id family prefix for hygiene rules; every id starts with `HYG-`. */
export const RULE_FAMILY_HYGIENE = 'HYG';
/** Rule-id family prefix for error propagation rules; every id starts with `ERR-`. */
export const RULE_FAMILY_ERROR = 'ERR';
/** Analyzer id owning the hygiene batch, including its Python subset. */
export const ANALYZER_HYGIENE = 'hygiene';
/** Rule-id family prefix for security rules; every id starts with `SEC-`. */
export const RULE_FAMILY_SECURITY = 'SEC';
/** Analyzer id owning every security rule in this registry domain. */
export const ANALYZER_SECURITY = 'security';
/** Rule-id family prefix for simplification rules; every id starts with `SIM-`. */
export const RULE_FAMILY_SIMPLIFY = 'SIM';
/** Analyzer id owning every simplification rule in this registry domain. */
export const ANALYZER_SIMPLIFY = 'simplify';
/** Rule-id family prefix for Python-modernization rules; ids start with `PYM-`. */
export const RULE_FAMILY_PYTHON_MODERN = 'PYM';
/** Analyzer id owning the Python-modernization rule batch. */
export const ANALYZER_PYTHON_MODERN = 'python-modern';
/** Default severity for advisory rules: reported, but not gate-blocking. */
export const SEVERITY_WARNING = 'warning';
/** Default severity for rules whose violations block the quality gate. */
export const SEVERITY_ERROR = 'error';
/** Language tag restricting a rule's applicability to Python sources. */
export const LANGUAGE_PYTHON = 'python';
/** Remediation note: the rule activates at the `standard` preset and above. */
export const REMEDIATION_STANDARD_AND_ABOVE = '`standard` 及以上';

/** Rule-id family prefix for TypeScript/JavaScript modernization rules; ids start with `TSM-`. */
export const RULE_FAMILY_TYPESCRIPT_MODERN = 'TSM';
/** Analyzer id owning the TypeScript/JavaScript modernization rule batch. */
export const ANALYZER_TYPESCRIPT_MODERN = 'ts-modern';
/** Rule-id family prefix for Rust modernization rules; every id starts with `RSM-`. */
export const RULE_FAMILY_RUST_MODERN = 'RSM';
/** Analyzer id owning the Rust modernization rule batch. */
export const ANALYZER_RUST_MODERN = 'rust-modern';
/** Rule-id family prefix for GDScript migration rules; every id starts with `GDM-`. */
export const RULE_FAMILY_GDSCRIPT_MODERN = 'GDM';
/** Analyzer id owning the GDScript (Godot 3 -> 4) migration rule batch. */
export const ANALYZER_GDSCRIPT_MODERN = 'gdscript-modern';
/** Language tag restricting a rule's applicability to TypeScript sources. */
export const LANGUAGE_TYPESCRIPT = 'typescript';
/** Language tag restricting a rule's applicability to JavaScript sources. */
export const LANGUAGE_JAVASCRIPT = 'javascript';
/** Both tags of the TS/JS family; the pack parses either dialect with the same adapter. */
const LANGUAGES_TS_FAMILY: readonly string[] = [LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT];
/** Language tag restricting a rule's applicability to Rust sources. */
export const LANGUAGE_RUST = 'rust';
/** Language tag restricting a rule's applicability to GDScript sources. */
export const LANGUAGE_GDSCRIPT = 'gdscript';

/** Rule-id family prefix for complexity semantic rules; ids start with `CPX-`. */
export const RULE_FAMILY_COMPLEXITY = 'CPX';
/** Analyzer id owning complexity rules. */
export const ANALYZER_COMPLEXITY = 'complexity';
/** Rule-id family prefix for data architecture rules; ids start with `DAT-`. */
export const RULE_FAMILY_DATA_ARCH = 'DAT';
/** Analyzer id owning data architecture rules. */
export const ANALYZER_DATA_ARCH = 'data-architecture';
/** Rule-id family prefix for test modernity rules; ids start with `TST-`. */
export const RULE_FAMILY_TEST_MODERNITY = 'TST';
/** Analyzer id owning test modernity rules. */
export const ANALYZER_TEST_MODERNITY = 'test-modernity';
/** Rule-id family prefix for dependency layout rules; ids start with `DEP-`. */
export const RULE_FAMILY_DEP_LAYOUT = 'DEP';
/** Analyzer id owning dependency layout rules. */
export const ANALYZER_DEP_LAYOUT = 'dependency-layout';

/** analyzer rules. */

/**
 * Modernization and architecture/dependency rule entries, spread into ANALYZER_RULES after
 * the core packs so the emitted rule order matches the pre-split registry exactly.
 */
export const ANALYZER_MODERN_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: 'TSM-VAR-001',
        family: RULE_FAMILY_TYPESCRIPT_MODERN,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        canonical: true,
        languages: LANGUAGES_TS_FAMILY,
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 var 声明（函数作用域、存在变量提升）。',
        remediation: '改用 const；需要重新赋值时用 let。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tsm-var-001',
    }),
    defineRule({
        id: 'TSM-REQUIRE-001',
        family: RULE_FAMILY_TYPESCRIPT_MODERN,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        canonical: true,
        languages: LANGUAGES_TS_FAMILY,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'ESM 模块内混用 CommonJS require() 调用。',
        remediation: '改为 import 绑定，保持单一模块体系。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tsm-require-001',
    }),
    defineRule({
        id: 'TSM-CTOR-001',
        family: RULE_FAMILY_TYPESCRIPT_MODERN,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        canonical: true,
        languages: LANGUAGES_TS_FAMILY,
        defaultSeverity: SEVERITY_WARNING,
        summary: '用 new 调用 Array/Object/String/Number/Boolean 包装构造器。',
        remediation: '改用字面量或 String()/Number()/Boolean() 原始转换。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tsm-ctor-001',
    }),
    defineRule({
        id: 'TSM-ARGS-001',
        family: RULE_FAMILY_TYPESCRIPT_MODERN,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        canonical: true,
        languages: LANGUAGES_TS_FAMILY,
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 arguments 对象。',
        remediation: '改用剩余参数（...args），可被类型系统检查。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tsm-args-001',
    }),
    defineRule({
        id: 'TSM-SPREAD-001',
        family: RULE_FAMILY_TYPESCRIPT_MODERN,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        canonical: true,
        languages: LANGUAGES_TS_FAMILY,
        defaultSeverity: SEVERITY_WARNING,
        summary: '用 Object.assign({}, …) 做浅合并。',
        remediation: '改用对象展开 { ...source }。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tsm-spread-001',
    }),
    defineRule({
        id: 'TSM-INCLUDES-001',
        family: RULE_FAMILY_TYPESCRIPT_MODERN,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        canonical: true,
        languages: LANGUAGES_TS_FAMILY,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'indexOf 与 -1/0 比较来判断成员存在。',
        remediation: '改用 includes(value)。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tsm-includes-001',
    }),
    defineRule({
        id: 'TSM-SUBSTR-001',
        family: RULE_FAMILY_TYPESCRIPT_MODERN,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        canonical: true,
        languages: LANGUAGES_TS_FAMILY,
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用已弃用的 String.prototype.substr。',
        remediation: '改用 slice(start, start + length)。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tsm-substr-001',
    }),
    defineRule({
        id: 'TSM-REPLACE-001',
        family: RULE_FAMILY_TYPESCRIPT_MODERN,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        canonical: true,
        languages: LANGUAGES_TS_FAMILY,
        defaultSeverity: SEVERITY_WARNING,
        summary: '字符串模式 replace 只替换首个匹配。',
        remediation: '需要全量替换时改用 replaceAll。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tsm-replace-001',
    }),
    defineRule({
        id: 'TSM-ANY-001',
        family: RULE_FAMILY_TYPESCRIPT_MODERN,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        canonical: true,
        languages: LANGUAGES_TS_FAMILY,
        defaultSeverity: SEVERITY_WARNING,
        summary: '显式 any 关闭了该值的类型检查。',
        remediation: '改用 unknown 加收窄，或精确的泛型/联合类型。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tsm-any-001',
    }),
    defineRule({
        id: 'TSM-TYPE-001',
        family: RULE_FAMILY_TYPESCRIPT_MODERN,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        canonical: true,
        languages: LANGUAGES_TS_FAMILY,
        defaultSeverity: SEVERITY_WARNING,
        summary: '具名导入仅用于类型位置。',
        remediation: '改为 import type { … }，让绑定在编译期被擦除。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tsm-type-001',
    }),
    defineRule({
        id: 'RSM-TRY-001',
        family: RULE_FAMILY_RUST_MODERN,
        analyzer: ANALYZER_RUST_MODERN,
        canonical: true,
        languages: [LANGUAGE_RUST],
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 try! 宏。',
        remediation: '改用 ? 运算符，可嵌入更大的表达式。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#rsm-try-001',
    }),
    defineRule({
        id: 'RSM-EXTERN-001',
        family: RULE_FAMILY_RUST_MODERN,
        analyzer: ANALYZER_RUST_MODERN,
        canonical: true,
        languages: [LANGUAGE_RUST],
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 extern crate 声明。',
        remediation: '2018 edition 起删除，直接按路径 use 依赖。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#rsm-extern-001',
    }),
    defineRule({
        id: 'RSM-MACRO-001',
        family: RULE_FAMILY_RUST_MODERN,
        analyzer: ANALYZER_RUST_MODERN,
        canonical: true,
        languages: [LANGUAGE_RUST],
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 #[macro_use] 文本导入宏。',
        remediation: '显式 use 目标宏，保留可追溯来源。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#rsm-macro-001',
    }),
    defineRule({
        id: 'RSM-STR-001',
        family: RULE_FAMILY_RUST_MODERN,
        analyzer: ANALYZER_RUST_MODERN,
        canonical: true,
        languages: [LANGUAGE_RUST],
        defaultSeverity: SEVERITY_WARNING,
        summary: '签名使用 &String 参数。',
        remediation: '改用 &str（或 impl AsRef<str>）。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#rsm-str-001',
    }),
    defineRule({
        id: 'RSM-CLONE-001',
        family: RULE_FAMILY_RUST_MODERN,
        analyzer: ANALYZER_RUST_MODERN,
        canonical: true,
        languages: [LANGUAGE_RUST],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'clone() 结果只用于比较或取长度。',
        remediation: '改为借用比较，避免不可见复制。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#rsm-clone-001',
    }),
    defineRule({
        id: 'RSM-UNWRAP-001',
        family: RULE_FAMILY_RUST_MODERN,
        analyzer: ANALYZER_RUST_MODERN,
        canonical: true,
        languages: [LANGUAGE_RUST],
        defaultSeverity: SEVERITY_WARNING,
        summary: '对可失败结果调用 unwrap()。',
        remediation: '改用 ? 传播，或用 expect 说明不变式。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#rsm-unwrap-001',
    }),
    defineRule({
        id: 'RSM-FORMAT-001',
        family: RULE_FAMILY_RUST_MODERN,
        analyzer: ANALYZER_RUST_MODERN,
        canonical: true,
        languages: [LANGUAGE_RUST],
        defaultSeverity: SEVERITY_WARNING,
        summary: '格式化宏使用位置参数 {}。',
        remediation: '改用内联捕获 "{value}"，由编译器校验名称。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#rsm-format-001',
    }),
    defineRule({
        id: 'GDM-YIELD-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 Godot 3 的 yield 协程写法。',
        remediation: '改用 await 表达式。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-yield-001',
    }),
    defineRule({
        id: 'GDM-EXPORT-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 Godot 3 的 export 语句。',
        remediation: '改用 @export 注解并保留类型声明。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-export-001',
    }),
    defineRule({
        id: 'GDM-ONREADY-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 onready 关键字。',
        remediation: '改用 @onready 注解。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-onready-001',
    }),
    defineRule({
        id: 'GDM-TOOL-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用裸 tool 关键字。',
        remediation: '改用首行 @tool 注解。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-tool-001',
    }),
    defineRule({
        id: 'GDM-POOL-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 Pool*Array 类型。',
        remediation: '改用 Packed*Array 系列类型。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-pool-001',
    }),
    defineRule({
        id: 'GDM-CONNECT-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 Godot 3 connect 签名（方法名以字符串传入）。',
        remediation: '改用信号 connect(Callable) 形式。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-connect-001',
    }),
    defineRule({
        id: 'GDM-RPC-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用 remote/master/puppet/slave 函数修饰符。',
        remediation: '改用 @rpc 注解。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-rpc-001',
    }),

    // ── Complexity Semantic Rules ──
    defineRule({
        id: 'CPX-TIME-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '跨函数/跨文件无界多项式时间复杂度：嵌套迭代调用链引发高开销。',
        remediation: '将内层数据预先构建为 Map/Set 索引，降低复合复杂度至 O(N)。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-time-001',
    }),
    defineRule({
        id: 'CPX-SPACE-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '热点循环内无界瞬态内存分配与重复全量物化。',
        remediation: '将对象/缓冲区分配提升到循环外，循环内执行就地重置与复用。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-space-001',
    }),
    defineRule({
        id: 'CPX-REC-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: '跨函数/跨文件无终止保障的递归或互递归调用链。',
        remediation: '引入显式深度累加参数与终止保护，或改写为迭代工作列表。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-rec-001',
    }),
    defineRule({
        id: 'CPX-AMP-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '复杂度放大陷阱：在迭代或热点调用链中隐式嵌套阻塞 I/O 或序列化。',
        remediation: '将 I/O 与序列化批量汇聚在循环外部执行。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-amp-001',
    }),

    // ── Data Architecture Rules ──
    defineRule({
        id: 'DAT-QRY-001',
        family: RULE_FAMILY_DATA_ARCH,
        analyzer: ANALYZER_DATA_ARCH,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '在线请求链路中的无界数据读取或全表内存过滤。',
        remediation: '增加游标分页或 Limit/Offset 条件，强制限制单次读取上限。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-qry-001',
    }),
    defineRule({
        id: 'DAT-NPL-001',
        family: RULE_FAMILY_DATA_ARCH,
        analyzer: ANALYZER_DATA_ARCH,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: '迭代与映射上下文中的 N+1 查询与重复存储调用。',
        remediation: '将循环内查询提升至外层使用批量 IN 查询或 DataLoader 批量加载。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-npl-001',
    }),
    defineRule({
        id: 'DAT-SER-001',
        family: RULE_FAMILY_DATA_ARCH,
        analyzer: ANALYZER_DATA_ARCH,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: 'info',
        summary: '跨层调用链中的重复序列化与反序列化转换。',
        remediation: '在内部调用链路传递强类型原生对象，仅在网络边界执行序列化。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-ser-001',
    }),
    defineRule({
        id: 'DAT-DEF-001',
        family: RULE_FAMILY_DATA_ARCH,
        analyzer: ANALYZER_DATA_ARCH,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: 'info',
        summary: '受信内部领域边界内的冗余重复防御性校验。',
        remediation: '在信任边界执行一次性完整校验，内部领域对象依托不可变类型保证。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-def-001',
    }),
    defineRule({
        id: 'DAT-LAY-001',
        family: RULE_FAMILY_DATA_ARCH,
        analyzer: ANALYZER_DATA_ARCH,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '数据访问抽象泄漏：业务核心直接操纵持久化驱动或底层存储细节。',
        remediation: '将存储驱动调用封装在仓储接口实现内，领域层仅依赖仓储契约。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-lay-001',
    }),

    // ── Test Modernity Rules ──
    defineRule({
        id: 'TST-ILS-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '测试完整性幻觉：测试仅校验 Mock 配置或绑定已废弃业务契约。',
        remediation: '将测试迁移至验证活跃业务契约与实际领域状态变化。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-ils-001',
    }),
    defineRule({
        id: 'TST-SKP-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '核心业务域中长期滞留的跳过、隔离或未执行测试用例。',
        remediation: '修复并恢复测试用例，或正式登记入测试债务清单并设定收敛里程碑。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-skp-001',
    }),
    defineRule({
        id: 'TST-TAU-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '缺乏真实业务断言或包含恒真断言的无效测试。',
        remediation: '替换恒真断言为针对业务实体输出和错误边界的有效验证。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-tau-001',
    }),
    defineRule({
        id: 'TST-DEN-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: 'info',
        summary: '关键业务模块的有效现代化测试密度 (EMTD) 或当前业务承接率 (CBCR) 低于阈值。',
        remediation: '补齐高风险语义单元的契约测试与边界测试，提高实际故障感知能力。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-den-001',
    }),
    defineRule({
        id: 'TST-DBT-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: 'info',
        summary: '未登记里程碑收敛计划或责任人的滞后测试技术债务。',
        remediation: '在测试债务登记表中补全责任 Agent 及目标收敛里程碑。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-dbt-001',
    }),

    // ── Dependency Layout Rules ──
    defineRule({
        id: 'DEP-ORD-001',
        family: RULE_FAMILY_DEP_LAYOUT,
        analyzer: ANALYZER_DEP_LAYOUT,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: 'info',
        summary: '文件布局与导入分组不符合当前语言现代化工程规范。',
        remediation: '调整导入顺序为 Stdlib -> ThirdParty -> InternalShared -> Local。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dep-ord-001',
    }),
    defineRule({
        id: 'DEP-LAZ-001',
        family: RULE_FAMILY_DEP_LAYOUT,
        analyzer: ANALYZER_DEP_LAYOUT,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '未提供审计声明或合规理由的函数内部临时导入。',
        remediation: '将导入提升至文件顶部，或添加 @lazy/@optional 注释标注意图。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dep-laz-001',
    }),
    defineRule({
        id: 'DEP-RES-001',
        family: RULE_FAMILY_DEP_LAYOUT,
        analyzer: ANALYZER_DEP_LAYOUT,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '业务逻辑中散落硬编码的未纳管外部 URL、文件路径或连接串。',
        remediation: '将外部资源地址统一抽取至配置文件或服务资源注册中心。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dep-res-001',
    }),
    defineRule({
        id: 'DEP-WLD-001',
        family: RULE_FAMILY_DEP_LAYOUT,
        analyzer: ANALYZER_DEP_LAYOUT,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '使用通配符导入破坏显式依赖跟踪与树摇优化。',
        remediation: '改用显式具名导入 (Named Imports)，明确模块依赖面。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dep-wld-001',
    }),
    defineRule({
        id: 'DEP-INV-001',
        family: RULE_FAMILY_DEP_LAYOUT,
        analyzer: ANALYZER_DEP_LAYOUT,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: '依赖倒置违规：底层基础设施或公共模块反向依赖高层业务模块。',
        remediation: '解除反向依赖，通过控制反转或事件总线进行解耦。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dep-inv-001',
    }),
];
