/**
 * Module: Core Engine - Praxis Presentation Chinese Dictionary
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn.ts
 * Architecture Role: Provide built-in Simplified Chinese (zh-CN) localization dictionary
 *   for Praxis frontend cards, diagnostics badges, and core governance rules.
 * Dependencies & Triggers: Implements definitions from ../i18n-types; consumed by i18nProvider.
 * Responsibilities: Export localized common UI strings and rule descriptions in Chinese.
 * Exit Semantics & Design Rationale: Static dictionary constant; guarantees complete coverage
 *   for high-frequency security, performance, architecture, and complexity rules.
 */

import type { PraxisCommonI18nStrings, PraxisRuleI18nEntry } from '../i18n-types';

/** 中文通用短语表 */
export const ZH_CN_COMMON: PraxisCommonI18nStrings = {
    verdictPass: '全部检查通过，未发现合规风险',
    verdictWarn: '存在需要关注的非阻断规范提示',
    verdictBlock: '发现关键阻断违规，请修复后继续',
    badgePass: '通过',
    badgeWarn: '警告',
    badgeBlock: '阻断',
    badgeInfo: '提示',
    linePrefix: '第 {0} 行',
    quickFixLabel: '建议修复',
    docsLabel: '查看规则文档',
    tokenSavingsLabel: 'Agent 提示 Token 压缩率: {0}%',
    defaultCategoryTitle: '代码规范检查',
};

/** 中文核心规则条目字典 */
export const ZH_CN_RULES: Record<string, PraxisRuleI18nEntry> = {
    'SEC-CST-001': {
        name: '禁止硬编码敏感凭据',
        summary: '在代码切片中检测到硬编码的高熵密钥、密码或 API Token。',
        remediation: '将敏感凭据迁移至安全环境变量或保密凭证存储服务中，切勿在源代码中显式书写。',
        rationale: '硬编码凭据极易随代码提交扩散并造成凭据泄漏风险。',
    },
    'ADV-PRF-001': {
        name: '循环内高开销运算外提',
        summary: '在循环或热路径中检测到重复的重型运算或未缓存的属性深度解析。',
        remediation: '将循环内恒定的计算表达式或属性查找提升到循环外部，使用局部变量缓存结果。',
        rationale: '避免在热路径上浪费 CPU 周期，提升代码局部执行吞吐量。',
    },
    'ADV-PRF-002': {
        name: '循环内瞬态堆分配防护',
        summary: '在紧凑循环内部检测到高频临时对象或闭包实例化，引发高 GC 压力。',
        remediation: '在循环外预先分配可复用实例或池化对象，在迭代中通过 reset_state() 清理复用。',
        rationale: '瞬态短生命周期对象会加剧垃圾回收器分代停顿，严重影响响应时间。',
    },
    'ARC-COH-001': {
        name: '单文件行数超出上限',
        summary: '文件总物理行数超出既定架构上限（通常为 400 行）。',
        remediation: '根据单一职责原则拆分领域职责，将内聚逻辑抽取为独立子模块。',
        rationale: '超大文件显著增加人机阅读认知负担，并增加并发合并冲突概率。',
    },
    'ARC-COH-002': {
        name: '单文件函数数量超标',
        summary: '单文件中定义的顶层函数与方法总数过多（通常超出 20 个）。',
        remediation: '评估职责聚合度，将从属辅助函数归类收拢至专用子模块或领域工具类中。',
        rationale: '过多函数混杂在同一文件通常意味着模块内聚性不足，存在隐藏上帝对象风险。',
    },
    'CMP-LOC-001': {
        name: '单函数圈复杂度过高',
        summary: '函数的独立判定分支过多（圈复杂度超出阈值），逻辑分支拓扑过于复杂。',
        remediation: '使用卫语句提前返回（Guard Clauses），或运用策略表/多态分发拆分多层分支。',
        rationale: '过高的分支复杂度呈指数级提升单元测试用例构造难度并隐藏边界缺陷。',
    },
    'CMP-LOC-002': {
        name: '嵌套层级过深',
        summary: '代码块缩进与控制流嵌套层次超出阈值（通常超过 4 层）。',
        remediation: '将内层深层控制流提取为独立私有函数，并采用及早返回原则扁平化逻辑。',
        rationale: '深层金字塔嵌套严重破坏代码可读性与局部推理推导能力。',
    },
    'TYP-ANY-001': {
        name: '避免隐式或裸 any 类型逃逸',
        summary: '检测到裸 any 或未约束的类型断言，破坏了 TypeScript 静态类型推导契约。',
        remediation: '使用具体接口、联合类型、泛型或 unknown 配合类型守卫（Type Guard）替代 any。',
        rationale: 'any 逃逸将导致静态类型编译器防护失效，使得运行时类型错误无法在编译期被拦截。',
    },
    'RES-LAK-001': {
        name: '资源未在终结块释放',
        summary: '打开的流、句柄、定时器或锁未在 finally 块或清理函数中保证释放。',
        remediation: '确保在 try...finally 结构中调用 release/close/dispose，或使用 Disposable 模式。',
        rationale: '异常路径下的资源遗漏将导致文件句柄枯竭、内存泄漏或死锁。',
    },
    'ASY-AWT-001': {
        name: '缺少必要的 await 异步调度',
        summary: '调用返回 Promise 的异步操作但未进行 await 等待，且未显式处理异常。',
        remediation: '在调用处增加 await，或者使用 .then().catch() 显式接管 Promise 决议与拒绝。',
        rationale: '未捕获的浮动 Promise 会导致竞态条件及未处理的全局异常（UnhandledRejection）。',
    },
    'MOD-EXP-001': {
        name: '避免无序通配导出',
        summary: '检测到大量未受保护的通配符导出（export *），可能引发符号污染与树摇失效。',
        remediation: '改用显式命名导出（Named Exports），明确暴露公开 API 边界。',
        rationale: '通配导出容易导致命名冲突、破坏模块边界封装并增加最终打包产物膨胀体积。',
    },
};
