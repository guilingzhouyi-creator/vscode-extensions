/**
 * Module: Core Engine — Rule Registry (platform entries)
 * File Path: src/core/rules/entries/platform.ts
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
import { ALL_LANGUAGES, defineRule } from '../types';

/** Rule-id family prefix for architecture rules; every id starts with `ARCH-`. */
const RULE_FAMILY_ARCHITECTURE = 'ARCH';
/** Analyzer id owning the layer and import architecture rules. */
const ANALYZER_ARCHITECTURE = 'architecture';
/** Rule-id family prefix for dependency-graph rules; ids start with `DEP-`. */
const RULE_FAMILY_DEPENDENCY = 'DEP';
/** Analyzer id owning the import-cycle and dependency-graph rule batch. */
const ANALYZER_DEPENDENCY_GRAPH = 'dependency-graph';
/** Default severity for advisory rules: reported, but not gate-blocking. */
const SEVERITY_WARNING = 'warning';
/** Default severity for rules whose violations block the quality gate. */
const SEVERITY_ERROR = 'error';
/** Legacy reason for ids kept only for backward compatibility. */
const LEGACY_REASON_ID_NOT_CANONICAL = 'id-not-canonical';

/** platform rules. */
export const PLATFORM_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: 'analyzer-error',
        family: 'LANG',
        analyzer: 'engine',
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: 'info',
        summary: '分析器在单文件上抛异常（failOnAnalyzerError 可升为 error）。',
        remediation: '修复分析器缺陷；已知外部数据问题可保持 info 留痕。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#analyzer-error',
    }),
    defineRule({
        id: 'ARCH-DIR-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '倒置依赖，在领域层定义接口契约，由外层实现。',
        remediation: '核心逆流：领域层 (Domain) 反向依赖外层应用层/基础设施/接口层。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-dir-001',
    }),
    defineRule({
        id: 'ARCH-DIR-002',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '引入用例服务 (Application Service) 统筹业务流。',
        remediation: '越层穿透：接口层控制器绕过应用层直接直连基础设施实现。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-dir-002',
    }),
    defineRule({
        id: 'ARCH-LEAK-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '领域模型使用 POJO/原生实体，隔离外部框架专有类型。',
        remediation: '职责泄漏：纯领域模型直接引用或泄漏外部框架库 (Express/Vue/Godot/ORM)。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-leak-001',
    }),
    defineRule({
        id: 'ARCH-LEAK-002',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '分层越界：外层实现被内层直接反向引用（Clean/DDD 层序反转）。',
        remediation: '把依赖改回单向（内层定义接口、外层实现），或把该文件移入正确层。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-leak-002',
    }),
    defineRule({
        id: 'clean-layer-violation',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: '增量管线中的分层越界（clean-layer 口径）。',
        remediation: '按层序调整依赖方向或把实现下沉/上提到正确层。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#clean-layer-violation',
    }),
    defineRule({
        id: 'disallowed-import',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_GRAPH,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: '声明式导入边界违规：跨组依赖或未授权外部包。',
        remediation: '按配置的 allowGroups/allowExternal 调整导入，或显式登记豁免。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#disallowed-import',
    }),
    defineRule({
        id: 'duplicate-literal',
        family: 'LEGACY',
        analyzer: 'constants',
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '自动聚合多处行号并提示提取共享常量。',
        remediation: '同一文件内相同字面量出现频次超标（默认 ≥ 3 次）。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#duplicate-literal',
    }),
    defineRule({
        id: 'high-complexity',
        family: 'CPX',
        analyzer: 'complexity',
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '函数圈复杂度超过阈值。',
        remediation: '抽取具名步骤、早返回替代嵌套分支，或按职责拆分函数。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#high-complexity',
    }),
    defineRule({
        id: 'high-entropy-token',
        family: 'LEGACY',
        analyzer: 'secrets',
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '高熵字符串疑似密钥/令牌。',
        remediation: '移入配置/密钥管理；确为误报时用 matchRule 抑制并写明理由。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#high-entropy-token',
    }),
    defineRule({
        id: 'import-cycle',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_GRAPH,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: '模块级循环依赖（Python 相对导入与包解析同样覆盖）。',
        remediation: '把共享契约下沉为独立模块，或用惰性导入打断环（惰性导入不建边）。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#import-cycle',
    }),
    defineRule({
        id: 'large-file',
        family: 'BIG',
        analyzer: 'large-file',
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '文件行数/函数数超过阈值。',
        remediation: '按职责拆分模块，或把工具函数迁到专属文件。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#large-file',
    }),
    defineRule({
        id: 'secret-detected',
        family: 'LEGACY',
        analyzer: 'secrets',
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: '疑似硬编码凭据（按模式识别）。',
        remediation: '撤销并轮换该凭据；改为从环境/密钥管理读取。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#secret-detected',
    }),
    defineRule({
        id: 'unused-export',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_GRAPH,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '导出符号无人引用（TS/JS 口径；Python 无 export 关键字不参与）。',
        remediation: '删除无人使用的导出，或把它收回模块内部。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#unused-export',
    }),
    defineRule({
        id: 'unused-module',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_GRAPH,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: '模块无人导入（非入口白名单内）。',
        remediation: '删除该模块，或把入口 glob 加入 entryGlobs。',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#unused-module',
    }),
];
