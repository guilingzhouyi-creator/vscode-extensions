/**
 * Module: Core Engine - Praxis Presentation Chinese Common Strings
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn/common.ts
 * Architecture Role: Chinese localization table for diagnostic cards and UI badges.
 * Dependencies & Triggers: Consumed by zh-cn/index.ts and i18nProvider.
 * Responsibilities: Export localized common UI phrases and badge labels.
 * Exit Semantics & Design Rationale: Pure constants, zero dependencies.
 */

import type { PraxisCommonI18nStrings } from '../../i18n-types';

/**
 * 中文通用短语表，涵盖判定结论、徽章标签与卡片操作指引。
 */
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
