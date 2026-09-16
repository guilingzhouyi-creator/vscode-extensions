/**
 * Module: Core Engine — Hardcoded Secrets & High-Entropy Token Diagnostic Messages
 * File Path: src/core/messages/secrets.ts
 * Architecture Role: Message-catalog adapter that translates secret-analyzer detections into typed
 *   DiagnosticDescriptor records; it holds no detection logic of its own
 * Dependencies & Triggers: Imports the DiagnosticDescriptor contract from ./types (re-exported via
 *   src/core/messages/index.ts); invoked by src/analyzers/secrets.ts for the `secret-detected` and
 *   `high-entropy-token` rules
 * Responsibilities: Build sanitized message/suggestion/rationale/risk payloads for
 *   HARDCODED_SECRET (Critical, `kind` plus truncated pattern snippet) and HIGH_ENTROPY_TOKEN
 *   (High, Shannon entropy in bit/char and literal length), keeping credential wording centralized
 * Exit Semantics & Design Rationale: Two pure factory functions returning frozen descriptor
 *   objects; no I/O or shared state, and no throws for valid arguments, so security guidance stays
 *   consistent and auditable without duplicated strings in the analyzer
 */

import type { DiagnosticDescriptor } from './types';

/**
 * Frozen catalog of diagnostic descriptors for the secret analyzer's rule ids.
 *
 * Each factory produces the user-facing message, remediation suggestion, rationale and
 * severity for one detection family. The catalog is the single source of credential
 * wording, so analyzers only supply computed facts and never format security guidance.
 */
export const SecretMessages = {
    /**
     * Build the descriptor for the `secret-detected` rule: a suspected hardcoded credential
     * match.
     *
     * @param kind - Human-readable credential/pattern kind supplied by the detector; it is
     *   echoed verbatim in the diagnostic message.
     * @param snippet - Sanitized pattern snippet supplied by the detector; callers must never
     *   pass the complete secret value.
     * @returns A descriptor with `Critical` risk and centralized secret-removal guidance.
     */
    HARDCODED_SECRET: (kind: string, snippet: string): DiagnosticDescriptor => ({
        message: `Suspected hardcoded secret or credential: ${kind} (pattern snippet: ${snippet})`,
        suggestion:
            'Extract credentials from source code; inject via environment variables, host keychains, or secrets managers',
        rationale:
            'Hardcoded secrets committed to version control can be scraped by adversaries, leading to unauthorized infrastructure access.',
        risk: 'Critical',
    }),

    /**
     * Build the descriptor for the `high-entropy-token` rule: a continuous literal whose
     * entropy suggests a credential.
     *
     * @param entropy - Shannon entropy of the literal in bits per character, formatted to two
     *   decimals in the message.
     * @param length - Literal length in characters, reported so reviewers can judge whether the
     *   entropy signal came from a long random token rather than a short word.
     * @returns A descriptor with `High` risk and guidance to verify and externalize the value.
     */
    HIGH_ENTROPY_TOKEN: (entropy: number, length: number): DiagnosticDescriptor => ({
        message: `High-entropy string detected (${entropy.toFixed(2)} bit/char, length ${length}), suspected confidential credential or master key`,
        suggestion:
            'Verify if this literal is an encryption key or token; if sensitive, move to external secret configuration',
        rationale:
            'High Shannon entropy in continuous string literals is a strong statistical indicator of cryptographic keys or API tokens.',
        risk: 'High',
    }),
} as const;
