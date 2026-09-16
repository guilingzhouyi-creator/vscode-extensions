/**
 * Module: Core Engine — Security Vulnerability & Injection Diagnostic Messages
 * File Path: src/core/messages/security.ts
 * Architecture Role: Declarative single source of OWASP/CWE-aligned user-facing security text and
 *   severities, kept separate from the detection heuristics in the security analyzer
 * Dependencies & Triggers: Imports DiagnosticDescriptor from ./types and each entry is checked by
 *   `as const satisfies DiagnosticDescriptor`; read by src/analyzers/security.ts when reporting
 *   SEC-VUL-001..006 and SEC-LEAK-001
 * Responsibilities: Supply message, suggestion, rationale and risk for arbitrary code execution
 *   (Critical), command injection and prototype pollution (High), insecure randomness, broken
 *   crypto hash and path traversal (Medium), and sensitive data logging (Medium)
 * Exit Semantics & Design Rationale: Plain frozen constants with no functions, so lookups are
 *   side-effect free and allocation-free; the `satisfies` constraint turns a missing or mistyped
 *   field into a compile error instead of a runtime report defect
 */

import type { DiagnosticDescriptor } from './types';

/** Risk tier for Medium-severity security findings such as weak crypto or leaked logs. */
const RISK_MEDIUM = 'Medium';

/**
 * Frozen registry of OWASP/CWE-aligned user-facing text for the security analyzer.
 *
 * Each entry is a complete, immutable `DiagnosticDescriptor` keyed by rule id. Keeping the
 * prose here separates severity and remediation wording from the detection heuristics, so a
 * heuristic can be tuned without rewriting the message users see.
 */
export const SecurityMessages = {
    /** SEC-VUL-001: dynamic evaluation of untrusted input can execute arbitrary code. */
    ARBITRARY_CODE_EXECUTION: {
        message:
            'Prohibit dynamic code execution via eval, Function, or dynamic expression compilers (Arbitrary Code Execution risk)',
        suggestion:
            'Use static lookup tables, safe JSON serialization, or dedicated sandboxed parsers instead of dynamic evaluation',
        rationale:
            'Dynamic code execution allows arbitrary untrusted inputs to execute code within the process context, leading to critical remote code execution (RCE).',
        risk: 'Critical',
    } as const satisfies DiagnosticDescriptor,

    /** SEC-VUL-002: shell command strings built from dynamic input enable injection. */
    COMMAND_INJECTION: {
        message:
            'Shell command execution uses dynamic string concatenation, susceptible to command injection',
        suggestion:
            'Use execFile or spawn with a fixed arguments array instead of shell command string interpolation',
        rationale:
            'Concatenating unescaped user or external variables directly into shell commands enables command chaining and process takeover.',
        risk: 'High',
    } as const satisfies DiagnosticDescriptor,

    /** SEC-VUL-003: mutating prototypes can poison behaviour for every later object. */
    PROTOTYPE_POLLUTION: {
        message:
            'Direct assignment to __proto__ or prototype may cause prototype pollution vulnerabilities',
        suggestion:
            'Use Object.create(null) or Map instances for dynamic key-value lookups, or validate property keys before assignment',
        rationale:
            'Modifying the prototype chain globally mutates default behavior across objects, causing denial of service or privilege escalation.',
        risk: 'High',
    } as const satisfies DiagnosticDescriptor,

    /** SEC-VUL-004: `Math.random` is predictable and unsafe for secret material. */
    INSECURE_RANDOMNESS: {
        message:
            'Insecure pseudo-random number generator (Math.random) used in security-sensitive credential/token context',
        suggestion:
            'Use a cryptographically secure random number generator such as crypto.randomBytes or crypto.getRandomValues',
        rationale:
            'Standard pseudo-random number generators produce predictable sequences that can be reverse-engineered to forge authentication tokens or cryptographic salts.',
        risk: RISK_MEDIUM,
    } as const satisfies DiagnosticDescriptor,

    /** SEC-VUL-005: MD5/SHA-1 collisions make them unfit for integrity or credentials. */
    BROKEN_CRYPTO_HASH: {
        message:
            'Deprecated collision-vulnerable cryptographic hash algorithm (MD5 or SHA1) detected',
        suggestion:
            'Upgrade security-sensitive hashing to SHA-256, SHA-512, or password hashing algorithms like Argon2 or scrypt',
        rationale:
            'MD5 and SHA-1 have known practical collision attacks and should never be used for digital signatures, integrity guarantees, or credential validation.',
        risk: RISK_MEDIUM,
    } as const satisfies DiagnosticDescriptor,

    /** SEC-VUL-006: unvalidated file paths can escape the intended base directory. */
    PATH_TRAVERSAL: {
        message:
            'File operation directly accepts unvalidated request parameter or variable, risking path traversal attacks',
        suggestion:
            'Resolve and strictly validate target file paths against an allowed base directory whitelist using path.resolve and path.relative',
        rationale:
            'Supplying ../ or absolute paths can escape the intended application directory, permitting unauthorized file reads, modifications, or deletions.',
        risk: RISK_MEDIUM,
    } as const satisfies DiagnosticDescriptor,

    /** SEC-LEAK-001: plaintext secrets in logs leak into aggregators and terminals. */
    SENSITIVE_DATA_LOGGING: {
        message:
            'Sensitive credential, secret, or password logged directly in plaintext diagnostics',
        suggestion: 'Mask or redact sensitive fields before writing to logs or telemetry streams',
        rationale:
            'Logging plaintext authentication credentials leaks secrets into external log aggregators, terminal records, and diagnostic dumps.',
        risk: RISK_MEDIUM,
    } as const satisfies DiagnosticDescriptor,
} as const;
