/**
 * Module: Core Engine — Rule Registry (standard library & systems runtime entries)
 * File Path: src/core/rules/entries/stdlib.ts
 * Architecture Role: Declarative rule metadata for standard library and systems runtime safety,
 *   unsafe contracts, constant-time cryptography, no_std heap escapes, and platform compilation.
 * Dependencies & Triggers: core rule types plus defineRule(); consumed by ./registry.ts
 * Responsibilities: Declare RuleDefinition entries for STDLIB-PANIC-001, STDLIB-ALLOC-001,
 *   STDLIB-UNSAFE-001, STDLIB-CONST-001, STDLIB-RECURSION-001, and STDLIB-PORT-001.
 * Exit Semantics & Design Rationale: Pure data, no behaviour. Provides unified identity
 *   and documentation anchors for standard library and runtime verification rules.
 */

import type { RuleDefinition } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    RULE_FAMILY_STDLIB,
} from '../types';

const ANALYZER_STDLIB = 'stdlib';
const DOCS_ANCHOR_BASE = 'docs/04-analyzers-and-rules/01-builtin-rules.md#';

const RULE_ID_STDLIB_PANIC_001 = 'STDLIB-PANIC-001';
const RULE_ID_STDLIB_ALLOC_001 = 'STDLIB-ALLOC-001';
const RULE_ID_STDLIB_UNSAFE_001 = 'STDLIB-UNSAFE-001';
const RULE_ID_STDLIB_CONST_001 = 'STDLIB-CONST-001';
const RULE_ID_STDLIB_RECURSION_001 = 'STDLIB-RECURSION-001';
const RULE_ID_STDLIB_PORT_001 = 'STDLIB-PORT-001';

function createStdlibRule(
    id: string,
    summary: string,
    remediation: string,
    severity = SEVERITY_WARNING,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_STDLIB,
        analyzer: ANALYZER_STDLIB,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: severity,
        summary,
        remediation,
        docsAnchor: `${DOCS_ANCHOR_BASE}${id.toLowerCase()}`,
    });
}

/**
 * Standard library and systems runtime verification rules table.
 */
export const STDLIB_RULES: readonly RuleDefinition[] = [
    createStdlibRule(
        RULE_ID_STDLIB_PANIC_001,
        '系统标准库公开接口严禁逃逸裸 panic/unwrap/abort，强制 Result/Option 或有界 error 返回。',
        '对可能失败的公开 API 采用 Result<T, E> 或显式 error code 表达错误，内部调用使用 match 或 ? 操作符解包。',
        SEVERITY_WARNING,
    ),
    createStdlibRule(
        RULE_ID_STDLIB_ALLOC_001,
        '裸机与 no_std 系统运行环境下隐式堆逃逸与动态重分配静态拦截。',
        '在 no_std / core 作用域下使用固定容量栈缓冲、借用切片或预分配内存池，避免裸调 Box::new / malloc。',
        SEVERITY_ERROR,
    ),
    createStdlibRule(
        RULE_ID_STDLIB_UNSAFE_001,
        'Rust/C++ 底层 unsafe 块强制附带 SAFETY: 契约证明，缺失即阻断。',
        '在每个 unsafe 块或函数前编写 SAFETY: 契约注释，明确记录调用者必须保证的前置条件与内存安全不变量。',
        SEVERITY_ERROR,
    ),
    createStdlibRule(
        RULE_ID_STDLIB_CONST_001,
        '标准库密码学与哈希敏感比较严禁分支时间泄漏，强制常量时间恒定延迟比对。',
        '使用恒定时间累加比对（如 constant_time_eq / subtle::ConstantTimeEq），严禁在字节不匹配时提前 return false。',
        SEVERITY_WARNING,
    ),
    createStdlibRule(
        RULE_ID_STDLIB_RECURSION_001,
        '底层核心算法无界深层递归缺乏显式栈深检查或上限防卫。',
        '为递归算法引入显式 depth 计数限制，或改用显式工作栈与迭代平铺展开循环。',
        SEVERITY_WARNING,
    ),
    createStdlibRule(
        RULE_ID_STDLIB_PORT_001,
        '底层平台条件编译 #[cfg(...)] 缺少未知平台或未支持目标架构时的 fallback 阻断。',
        '在特定操作系统/目标平台条件编译块末尾添加 compile_error! 或通用软实现作为兜底后备。',
        SEVERITY_WARNING,
    ),
];
