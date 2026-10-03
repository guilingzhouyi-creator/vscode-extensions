/**
 * Module: Core Engine - Praxis Presentation Chinese Dictionary Barrel
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn.ts
 * Architecture Role: Substantive barrel module aggregating domain Chinese dictionaries.
 * Dependencies & Triggers: Consumed by presentation/i18n-provider.ts and
 *   Praxis presentation layer.
 * Responsibilities: Aggregate and freeze ZH_CN_RULES across domain partitions;
 *   export ZH_CN_COMMON.
 * Exit Semantics & Design Rationale: Direct domain aggregation with zero
 *   intermediate forwarding hops.
 */

import type { PraxisRuleI18nEntry } from '../i18n-types';
import { ZH_CN_ARCHITECTURE_RULES } from './zh-cn/rules-architecture';
import { ZH_CN_GOVERNANCE_RULES } from './zh-cn/rules-governance';
import { ZH_CN_LANGUAGE_RULES } from './zh-cn/rules-languages';
import { ZH_CN_SECURITY_RULES } from './zh-cn/rules-security';

export { ZH_CN_COMMON } from './zh-cn/common';

/**
 * 完整中文规则本地化字典表（聚合架构、语言、规范、安全等领域子表）。
 */
export const ZH_CN_RULES: Readonly<Record<string, PraxisRuleI18nEntry>> = Object.freeze({
    ...ZH_CN_ARCHITECTURE_RULES,
    ...ZH_CN_LANGUAGE_RULES,
    ...ZH_CN_GOVERNANCE_RULES,
    ...ZH_CN_SECURITY_RULES,
});
