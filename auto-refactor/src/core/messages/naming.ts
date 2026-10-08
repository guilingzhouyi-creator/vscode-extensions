/**
 * Module: Core Messages — Naming Governance & Identifier Hygiene
 * File Path: src/core/messages/naming.ts
 * Architecture Role: Centralized catalog of diagnostic descriptors and remediation templates
 *   for naming length, abbreviation, and semantic clarity rules across language adapters.
 * Dependencies & Triggers: Imports DiagnosticDescriptor from ./types; consumed by naming
 *   analyzers, governance linters, and reporter formatters during code inspection.
 * Responsibilities:
 *   1. Provide structured diagnostic descriptors for variable identifier length bounds.
 *   2. Supply standardized remediation messages for function name length and semantics.
 *   3. Expose canonical descriptors for cryptic or truncated abbreviations.
 *   4. Export NamingMessages catalog with both functional and declarative access patterns.
 * Exit Semantics & Design Rationale: Immutable catalog with pure formatter functions and
 *   descriptors; deterministic outputs with zero side effects and zero runtime dependencies.
 */

import type { DiagnosticDescriptor } from './types';

/**
 * Diagnostic descriptor augmented with its associated rule identifier.
 */
export interface NamingDiagnosticDescriptor extends DiagnosticDescriptor {
    readonly ruleId: string;
}

/**
 * Parameter bag for naming diagnostic formatting.
 */
export interface NamingParamBag {
    readonly name?: string;
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly abbreviation?: string;
    readonly count?: number;
}

/**
 * Dual-interface descriptor factory: callable as a function and readable as a descriptor.
 */
export interface NamingDescriptorFactory {
    (
        nameOrParams?: string | NamingParamBag,
        limitOrAbbr?: number | string,
    ): NamingDiagnosticDescriptor;
    readonly ruleId: string;
    readonly message: string;
    readonly suggestion: string;
    readonly rationale: string;
    readonly risk: 'Low' | 'Medium' | 'High' | 'Critical';
}

interface NamingFactoryConfig {
    readonly ruleId: string;
    readonly defaultMessage: string;
    readonly suggestion: string;
    readonly rationale: string;
    readonly risk: 'Low' | 'Medium' | 'High' | 'Critical';
    readonly formatMessage: (name?: string, param?: number | string) => string;
}

/**
 * Helper to construct a dual-faced naming descriptor factory with CC <= 15 and Depth <= 4.
 */
function createNamingFactory(config: NamingFactoryConfig): NamingDescriptorFactory {
    const formatter = (
        nameOrParams?: string | NamingParamBag,
        limitOrAbbr?: number | string,
    ): NamingDiagnosticDescriptor => {
        let name: string | undefined;
        let param: number | string | undefined = limitOrAbbr;

        if (typeof nameOrParams === 'object' && nameOrParams !== null) {
            name = nameOrParams.name;
            param =
                nameOrParams.minLength ??
                nameOrParams.maxLength ??
                nameOrParams.abbreviation ??
                nameOrParams.count;
        } else if (typeof nameOrParams === 'string') {
            name = nameOrParams;
        }

        return {
            ruleId: config.ruleId,
            message: config.formatMessage(name, param),
            suggestion: config.suggestion,
            rationale: config.rationale,
            risk: config.risk,
        };
    };

    return Object.assign(formatter, {
        ruleId: config.ruleId,
        message: config.defaultMessage,
        suggestion: config.suggestion,
        rationale: config.rationale,
        risk: config.risk,
    });
}

const identifierTooShortFactory = createNamingFactory({
    ruleId: 'NAM-LEN-001',
    defaultMessage: 'Variable identifier is too short; semantic intent is obscured.',
    suggestion: 'Choose a descriptive, balanced variable name communicating clear semantic intent.',
    rationale:
        'Excessively short identifiers obscure variable semantics and increase cognitive burden.',
    risk: 'Low',
    formatMessage: (name, limit) => {
        const target = name ? `'${name}'` : 'Variable identifier';
        const bound = limit !== undefined ? ` (minimum length: ${limit})` : '';
        return `Variable identifier ${target} is too short${bound}; semantic intent is obscured.`;
    },
});

const identifierTooLongFactory = createNamingFactory({
    ruleId: 'NAM-LEN-001',
    defaultMessage: 'Variable identifier exceeds recommended maximum length budget.',
    suggestion:
        'Shorten identifier or decompose into modular namespace prefixes to eliminate redundancy.',
    rationale:
        'Overly verbose identifiers create visual noise and indicate missing module decomposition.',
    risk: 'Low',
    formatMessage: (name, limit) => {
        const target = name ? `'${name}'` : 'Variable identifier';
        const bound = limit !== undefined ? ` (maximum length: ${limit})` : '';
        return `Variable identifier ${target} exceeds maximum length budget${bound}.`;
    },
});

const functionNameTooShortFactory = createNamingFactory({
    ruleId: 'NAM-LEN-002',
    defaultMessage: 'Function name is too short to communicate operational responsibility.',
    suggestion:
        'Rename function with an expressive verb-noun phrase clearly describing its operation.',
    rationale:
        'Single-syllable or truncated function names obscure operational semantics and call-site intent.',
    risk: 'Medium',
    formatMessage: (name, limit) => {
        const target = name ? `'${name}'` : 'Function name';
        const bound = limit !== undefined ? ` (minimum length: ${limit})` : '';
        return `Function name ${target} is too short${bound} to communicate its operational responsibility.`;
    },
});

const crypticAbbreviationFactory = createNamingFactory({
    ruleId: 'NAM-ABR-001',
    defaultMessage: 'Identifier contains cryptic, incomplete, or non-standard abbreviations.',
    suggestion:
        'Expand abbreviated segment to standard unabbreviated domain terms or approved acronyms.',
    rationale:
        'Truncated and non-standard abbreviations degrade codebase searchability and readability.',
    risk: 'Medium',
    formatMessage: (name, abbr) => {
        if (name && abbr) {
            return `Identifier '${name}' contains cryptic abbreviation '${abbr}'.`;
        }
        if (name) {
            return `Identifier '${name}' contains cryptic or non-standard abbreviations.`;
        }
        return 'Identifier contains cryptic or non-standard abbreviations.';
    },
});

/**
 * Standard diagnostic messages and remediation suggestions for naming rules.
 */
export const NamingMessages = Object.freeze({
    identifierTooShort: identifierTooShortFactory,
    identifierTooLong: identifierTooLongFactory,
    functionNameTooShort: functionNameTooShortFactory,
    crypticAbbreviation: crypticAbbreviationFactory,

    // UPPER_SNAKE_CASE aliases for convention compatibility
    IDENTIFIER_TOO_SHORT: identifierTooShortFactory,
    IDENTIFIER_TOO_LONG: identifierTooLongFactory,
    FUNCTION_NAME_TOO_SHORT: functionNameTooShortFactory,
    CRYPTIC_ABBREVIATION: crypticAbbreviationFactory,
});
