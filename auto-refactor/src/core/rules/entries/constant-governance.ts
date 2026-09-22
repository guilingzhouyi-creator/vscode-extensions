/**
 * Module: Core Engine — Rule Registry (constant governance entries)
 * File Path: src/core/rules/entries/constant-governance.ts
 * Architecture Role: Declarative rule metadata for constant layout, scope discipline,
 *   near-literal clustering, and cross-file ownership governance.
 * Dependencies & Triggers: core rule types plus defineRule(); consumed by ./registry.ts
 * Responsibilities: Declare RuleDefinition entries for CONST-LAY-001, CONST-SCP-001,
 *   CONST-SCP-002, CONST-CLU-001, CONST-DRF-001, and CONST-OWN-001.
 * Exit Semantics & Design Rationale: Pure data, no behaviour. Provides unified identity
 *   and documentation anchors for constant semantic governance rules.
 */

import type { RuleDefinition } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    SEVERITY_WARNING,
    SEVERITY_INFO,
    RULE_FAMILY_CONSTANTS,
} from '../types';

const ANALYZER_CONSTANTS = 'constants';
const DOCS_ANCHOR_BASE = 'docs/04-analyzers-and-rules/01-builtin-rules.md#';

const RULE_ID_CONST_LAY_001 = 'CONST-LAY-001';
const RULE_ID_CONST_SCP_001 = 'CONST-SCP-001';
const RULE_ID_CONST_SCP_002 = 'CONST-SCP-002';
const RULE_ID_CONST_CLU_001 = 'CONST-CLU-001';
const RULE_ID_CONST_DRF_001 = 'CONST-DRF-001';
const RULE_ID_CONST_OWN_001 = 'CONST-OWN-001';

function createGovernanceRule(
    id: string,
    summary: string,
    remediation: string,
    severity = SEVERITY_WARNING,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_CONSTANTS,
        analyzer: ANALYZER_CONSTANTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: severity,
        summary,
        remediation,
        docsAnchor: `${DOCS_ANCHOR_BASE}${id.toLowerCase()}`,
    });
}

/**
 * Constant semantic governance rules table.
 */
export const CONSTANT_GOVERNANCE_RULES: readonly RuleDefinition[] = [
    createGovernanceRule(
        RULE_ID_CONST_LAY_001,
        '模块级稳定常量在依赖区后必须进入首个正式代码声明域，严禁散落在函数内部、文件中段或业务逻辑之间。',
        '将模块级常量统一定义在文件导入声明（import/require）之后、任何函数/类声明之前的常量区。',
    ),
    createGovernanceRule(
        RULE_ID_CONST_SCP_001,
        '单函数局部不变量、延迟初始化值或受限生命周期资源禁止滥用扩大作用域提升至顶层。',
        '保持局部不变量在单函数或局部代码块内部的作用域范围，避免盲目提升至文件全局。',
    ),
    createGovernanceRule(
        RULE_ID_CONST_SCP_002,
        '单函数体内散落的多处同类局部硬编码应在函数头部统一定义为局部常量。',
        '在当前函数头部集中声明局部 const 常量并替换函数内部各处的散落字面量。',
        SEVERITY_INFO,
    ),
    createGovernanceRule(
        RULE_ID_CONST_CLU_001,
        '同调用域内存在未抽取的同源硬编码字面量（状态码/协议值/路径/事件名），应一揽子打包抽取。',
        '结合临近代码域聚类建议，将同一语义族的同源字面量一并抽离为常量，避免遗留散乱硬编码。',
    ),
    createGovernanceRule(
        RULE_ID_CONST_DRF_001,
        '跨文件同源语义常量存在命名分裂或数值微小漂移，必须建立单一真源（SSOT）。',
        '将多文件维护的同源常量统一定义在领域或协议共享常量库中，并消除数值或命名漂移。',
    ),
    createGovernanceRule(
        RULE_ID_CONST_OWN_001,
        '共享常量所有权分层错误，严禁塞入全局大杂烩 constants 文件或藏匿在底层私有模块。',
        '按照所有权四层模型，分流至 Module-Private、Domain-Shared、Protocol-Shared 或 System-Config。',
    ),
];
