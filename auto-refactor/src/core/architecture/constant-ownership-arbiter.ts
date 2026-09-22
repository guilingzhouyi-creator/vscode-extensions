/**
 * Module: Core Architecture — Cross-File Constant Ownership Arbiter
 * File Path: src/core/architecture/constant-ownership-arbiter.ts
 * Architecture Role: Arbitrates architectural ownership of constants across modules,
 *     domains, protocol layers, and config systems, preventing global catch-all "constants.ts"
 *     dumping and ensuring clear single-source-of-truth topologies.
 * Dependencies & Triggers: Consumes Issue from core/types; consumed by cross-file analyzers.
 * Responsibilities:
 *     1. Classify ownership into four architectural tiers: Module-Private, Domain-Shared,
 *        Protocol-Shared, and System-Config.
 *     2. Discourage anti-pattern catch-all global constants files.
 *     3. Emit CONST-OWN-001 when a constant is misplaced in the architectural hierarchy.
 * Exit Semantics & Design Rationale: Deterministic pure function without disk I/O.
 */

import type { Issue } from '../types';

const TIER_MODULE_PRIVATE = 'module_private';
const TIER_DOMAIN_SHARED = 'domain_shared';
const TIER_PROTOCOL_SHARED = 'protocol_shared';
const TIER_SYSTEM_CONFIG = 'system_config';

const CONSTANTS_ANALYZER = 'constants';
const RULE_CONST_OWN_001 = 'CONST-OWN-001';
const SEVERITY_WARNING = 'warning';
const SYSTEM_CONFIG_TARGET = 'src/core/config/config.ts';
const PROTOCOL_SHARED_TARGET = 'src/core/types.ts';
const CATCH_ALL_SUFFIX = '/constants.ts';
const CATCH_ALL_NAME = 'constants.ts';
const ROOT_DOMAIN = 'root';

/**
 * Four-tier constant architectural ownership hierarchy.
 */
export type ConstantOwnershipTier =
    | typeof TIER_MODULE_PRIVATE
    | typeof TIER_DOMAIN_SHARED
    | typeof TIER_PROTOCOL_SHARED
    | typeof TIER_SYSTEM_CONFIG;

/**
 * Observed usage site of a constant.
 */
export interface ConstantUsageSite {
    filePath: string;
    line: number;
    enclosingScope?: string;
}

/**
 * Ownership arbitration verdict for a constant.
 */
export interface ConstantOwnershipResolution {
    symbolName: string;
    normalizedValue: string;
    currentTier: ConstantOwnershipTier;
    recommendedTier: ConstantOwnershipTier;
    recommendedTargetFile: string;
    consumerFiles: string[];
    isMisplaced: boolean;
    rationale: string;
}

/**
 * Extracts the top-level subsystem domain from a repository-relative POSIX file path.
 */
function extractDomain(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 1) return ROOT_DOMAIN;
    if (parts[0] === 'src' && parts.length > 2) {
        return `src/${parts[1]}/${parts[2]}`;
    }
    return parts.slice(0, 2).join('/');
}

const CONFIGURABLE_THRESHOLD_PATTERN =
    /^(?:CONFIG_.*|.*(?:TIMEOUT|BUFFER|MAX_RETRY|BATCH_SIZE|CAPACITY).*)$/;

/**
 * Determines whether a symbol name implies configurable system threshold.
 */
function isConfigurableThreshold(name: string): boolean {
    return CONFIGURABLE_THRESHOLD_PATTERN.test(name.toUpperCase());
}

/**
 * Computes the recommended tier and placement file for a constant symbol.
 */
function computeRecommendedPlacement(
    symbolName: string,
    declarationFile: string,
    uniqueConsumers: string[],
): { recommendedTier: ConstantOwnershipTier; recommendedTargetFile: string; rationale: string } {
    if (isConfigurableThreshold(symbolName)) {
        return {
            recommendedTier: TIER_SYSTEM_CONFIG,
            recommendedTargetFile: SYSTEM_CONFIG_TARGET,
            rationale: `常量 "${symbolName}" 属于可配置的运行时阈值/容量，建议纳入配置体系。`,
        };
    }

    if (uniqueConsumers.length <= 1) {
        return {
            recommendedTier: TIER_MODULE_PRIVATE,
            recommendedTargetFile: uniqueConsumers[0] || declarationFile,
            rationale:
                `常量 "${symbolName}" 仅在单文件内消费，应作为模块私有常量，` +
                '严禁暴露至外部或塞入全局 constants 文件。',
        };
    }

    const domains = new Set(uniqueConsumers.map(extractDomain));
    if (domains.size === 1) {
        const domain = Array.from(domains)[0];
        return {
            recommendedTier: TIER_DOMAIN_SHARED,
            recommendedTargetFile: `${domain}/types.ts`,
            rationale:
                `常量 "${symbolName}" 在子系统 "${domain}" 内部多个文件复用，` +
                '建议归属于该领域的共享类型或常量库。',
        };
    }

    return {
        recommendedTier: TIER_PROTOCOL_SHARED,
        recommendedTargetFile: PROTOCOL_SHARED_TARGET,
        rationale:
            `常量 "${symbolName}" 跨越 ${domains.size} 个子系统领域消费，` +
            '建议提升至协议/契约契约层。',
    };
}

/**
 * Builds a misplaced ownership issue finding for a constant.
 */
function buildMisplacedIssue(
    symbolName: string,
    declarationFile: string,
    declarationLine: number,
    recommendedTier: ConstantOwnershipTier,
    recommendedTargetFile: string,
    rationale: string,
    consumerCount: number,
): Issue {
    return {
        id: `${CONSTANTS_ANALYZER}:${RULE_CONST_OWN_001}:${declarationFile}:${declarationLine}`,
        analyzer: CONSTANTS_ANALYZER,
        rule: RULE_CONST_OWN_001,
        severity: SEVERITY_WARNING,
        message:
            `常量 "${symbolName}" 架构所有权分层不合理（当前处于 ${declarationFile}，推荐层级为 [${recommendedTier}]）。` +
            rationale,
        location: {
            file: declarationFile,
            start: { line: declarationLine, column: 1 },
            end: { line: declarationLine, column: symbolName.length },
        },
        detail: {
            symbol: symbolName,
            currentFile: declarationFile,
            recommendedTargetFile,
            recommendedTier,
            consumerCount,
        },
        suggestion: `重构所有权归属：将 "${symbolName}" 迁移并收敛至 [${recommendedTargetFile}]。`,
    };
}

/**
 * Arbitrates the architectural ownership tier of a constant across file boundaries.
 *
 * @param symbolName - Name of the constant identifier.
 * @param normalizedValue - Literal value text.
 * @param declarationFile - File where the constant is declared.
 * @param declarationLine - Line number where declared.
 * @param consumerFiles - All files referencing this constant.
 * @returns Ownership resolution verdict and optional CONST-OWN-001 issue.
 */
export function arbitrateConstantOwnership(
    symbolName: string,
    normalizedValue: string,
    declarationFile: string,
    declarationLine: number,
    consumerFiles: string[],
): { resolution: ConstantOwnershipResolution; issue?: Issue } {
    const uniqueConsumers = Array.from(new Set(consumerFiles));
    const isCatchAllFile =
        declarationFile.endsWith(CATCH_ALL_SUFFIX) || declarationFile === CATCH_ALL_NAME;

    let currentTier: ConstantOwnershipTier = TIER_MODULE_PRIVATE;
    if (isCatchAllFile) {
        currentTier = TIER_PROTOCOL_SHARED;
    } else if (uniqueConsumers.length > 1) {
        currentTier = TIER_DOMAIN_SHARED;
    }

    const { recommendedTier, recommendedTargetFile, rationale } = computeRecommendedPlacement(
        symbolName,
        declarationFile,
        uniqueConsumers,
    );

    const isMisplaced =
        (isCatchAllFile && recommendedTier === TIER_MODULE_PRIVATE) ||
        (currentTier !== recommendedTier && !isCatchAllFile && uniqueConsumers.length > 1);

    const resolution: ConstantOwnershipResolution = {
        symbolName,
        normalizedValue,
        currentTier,
        recommendedTier,
        recommendedTargetFile,
        consumerFiles: uniqueConsumers,
        isMisplaced,
        rationale,
    };

    let issue: Issue | undefined;
    if (isMisplaced) {
        issue = buildMisplacedIssue(
            symbolName,
            declarationFile,
            declarationLine,
            recommendedTier,
            recommendedTargetFile,
            rationale,
            uniqueConsumers.length,
        );
    }

    return { resolution, issue };
}
