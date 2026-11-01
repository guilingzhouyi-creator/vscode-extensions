/**
 * Module: Core Praxis Presentation — Chinese Defect Taxonomy and Remediation Verb Strings
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn/taxonomy.ts
 * Architecture Role: Localized human-facing prose for the six defect taxonomies and the action
 *   verbs that prescribe a fix. Kept here rather than in the governance SSOT because the engine
 *   catalog carries only what a machine consumer reads, and a Chinese string inside the scanned
 *   engine tree is a translation that escaped its dictionary.
 * Dependencies & Triggers: Consumed by presentation surfaces that render taxonomy or verb prose.
 * Responsibilities: Export the frozen zh-CN taxonomy table and action-verb description table.
 * Exit Semantics & Design Rationale: Pure frozen constants; no logic, no side effects. The keys are
 *   exhaustive over the engine enums, so a new category or verb without a translation is visible as
 *   a missing key rather than as a silently untranslated card.
 */

/** Localized title and description for one defect taxonomy. */
export interface ZhCnTaxonomyEntry {
    readonly title: string;
    readonly description: string;
}

/**
 * Chinese defect taxonomy prose, keyed by the engine taxonomy code.
 */
export const ZH_CN_TAXONOMY: Readonly<Record<string, ZhCnTaxonomyEntry>> = Object.freeze({
    ARCH_LAYER: Object.freeze({
        title: '架构分层与依赖边界',
        description: '分层拓扑隔离、领域依赖纯净度与循环依赖防护。',
    }),
    CTRL_FLOW: Object.freeze({
        title: '控制流与复杂度预算',
        description: '单函数圈复杂度、控制流嵌套深度与卫语句平铺控制流。',
    }),
    NUM_PREC: Object.freeze({
        title: '数值精度与截断安全',
        description: '浮点数两位小数精度对齐、IEEE 754 负零消除与紧凑账本单行物理预算。',
    }),
    TEST_MODERN: Object.freeze({
        title: '测试现代性与断言真伪',
        description: '杜绝同义反复虚假断言、浮点裸字面量脆弱等值与仅验证桩对象的假象测试。',
    }),
    GOV_NORM: Object.freeze({
        title: '工程规范与技术用语客观化',
        description: '物理命名对齐、全工作区零空文件守卫与去口号化求真务实技术用语。',
    }),
    SEC_GUARD: Object.freeze({
        title: '安全防护与凭证防泄漏',
        description: '高熵敏感密钥防泄漏、协议路径防护与安全鉴权拦截。',
    }),
});

/**
 * Chinese remediation-verb prose, keyed by the engine action verb.
 */
export const ZH_CN_ACTION_VERBS: Readonly<Record<string, string>> = Object.freeze({
    extract_pure_predicate: '将复合判定或正则提取为无状态纯函数以降低圈复杂度。',
    apply_guard_clause: '逆向断言提前返回以平铺深层控制流嵌套。',
    align_numeric_precision: '规范四舍五入缩放系数至两位小数 (0.01) 并消除 -0 符号差异。',
    replace_with_tolerance_assertion: '将脆弱的浮点绝对等值断言替换为容差比较函数或 toBeCloseTo。',
    sanitize_prose_terminology: '将临时性、夸大性或主观评价词汇替换为客观中立的技术事实陈述。',
    decouple_facade: '消除单行空包转发跳板或为门面注入实质契约校验与不可变性冻结。',
    extract_constant: '将裸字面量提取为模块或领域级单一真源常量。',
    hoist_declaration: '将循环内不变分配、正则构建或配置解析提升至循环外。',
    narrow_scope: '收敛过度导出的符号或模块至私有/局部作用域。',
    split_function: '将超长函数拆解为职责单一的独立子过程。',
    simplify_control_flow: '简化冗长布尔逻辑或多重嵌套三元表达式。',
    replace_token: '替换过时或废弃的语法关键字与绑定模式。',
    insert_comment_contract: '补齐结构化 JSDoc 契约声明与参数文档。',
    guard_recursion: '为递归遍历追加深度上限或已访问集合以杜绝调用栈溢出。',
    use_constant_time_comparison: '使用恒定时间比对函数比对安全敏感口令或签名以防时序侧信道攻击。',
    scaffold_constant_library: '将离散常量归拢为结构化常量字典或拓扑库。',
    scaffold_gate_system: '落地标准化提交前或推送前双层质量守卫流水线。',
    request_clarification: '在规格要求、命名意图或结构定义模糊时发起澄清请求。',
    rename_symbol: '重命名符号以符合规范命名标准并表达明确语义意图。',
    introduce_parameter_object: '将过多的关联函数参数归拢封装为参数对象或选项接口。',
    decompose_module: '将过大或多职责模块拆解为内聚的单一职责子模块。',
    inline_orphan_function: '将单次调用孤儿微函数就地内联至调用点以消除参数泥团并增强局部内聚。',
    melt_trampoline: '消融单目标透明转发跳板使调用方直接引用目标底层实现。',
    compact_diluted_lines: '紧凑化过度垂直分散的代码换行或碎片化链式调用为紧凑语句。',
    decompose_congested_tokens: '通过提取局部只读中间常量分解单行严重拥挤的复合表达式。',
    enrich_facade: '为接线比率超标的门面注入参数契约校验、不可变冻结保障或领域聚合逻辑。',
    eliminate_tautological_loop: '移除代数条件熵增趋零的形式主义循环，替换为直接查找或高阶纯函数。',
});
