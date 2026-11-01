/**
 * Module: Core Constants — Security & Vulnerability Regular Expression Catalog
 * File Path: src/core/constants/regex-security.ts
 * Architecture Role: Single source of truth (SSOT) for security audit patterns, arbitrary code
 *     execution, command injection, prototype pollution, and sensitive data leakage patterns.
 * Dependencies & Triggers: Zero external dependencies; consumed by security analyzer and guards.
 * Responsibilities:
 *     1. Centralize canonical security patterns (dynamic execution, shell injection, broken
 *        crypto, and path traversal).
 *     2. Enforce the state-separation discipline: stateless immutable constants vs fresh factories.
 *     3. Expose frozen REGEX_SECURITY domain namespace.
 * Exit Semantics & Design Rationale: Pure, frozen regex constants; zero side effects and
 *     strictly immune to ReDoS back-tracking traps.
 */

/** Matches high-entropy 32..64 hex characters typical of hashes or API tokens. */
export const HEX_TOKEN_ENTROPY_PATTERN = /\b[0-9a-fA-F]{32,64}\b/;

/** Matches PEM-encoded private key header. */
export const PRIVATE_KEY_HEADER_PATTERN = /-----BEGIN\s+[A-Z\s]+PRIVATE\s+KEY-----/;

/** Matches generic secret assignment tokens in code or config. */
export const GENERIC_SECRET_ASSIGN_PATTERN =
    /(?:api_?key|auth_?token|client_?secret|private_?key|password)\s*[:=]\s*['"][^'"]{8,}['"]/i;

/** Matches high-risk API credential and token prefixes. */
export const CREDENTIAL_TOKEN_PATTERN =
    /(?:ghp_|gho_|github_pat_|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|xox[baprs]-|-----BEGIN|Bearer\s)/i;

/** Matches dangerous dynamic evaluation calls across JavaScript/TypeScript. */
export const DANGEROUS_EVAL_PATTERN = /\b(eval\s*\(|new\s+Function\s*\(|execScript\s*\()/;

/** Matches Python dynamic execution calls (exec, eval, compile with exec mode). */
export const PYTHON_EXEC_PATTERN = /\b(exec\s*\(|eval\s*\(|compile\s*\([^)]*['"]exec['"]\))/;

/** Matches Godot GDScript dynamic expression execution. */
export const GDSCRIPT_EXEC_PATTERN = /\bExpression\.new\s*\(\)\.execute\b/;

/** Matches child process execution calls across JavaScript/TypeScript/Python. */
export const COMMAND_EXEC_PATTERN =
    /\b(child_process\.(?:exec|execSync)|subprocess\.(?:Popen|call|run))\s*\(/;

/** Matches JavaScript dynamic shell command injection with unescaped interpolation. */
export const SHELL_INJECTION_PATTERN =
    /\b(?:child_process\s*\.\s*(?:exec|execSync)|exec|execSync)\s*\(\s*(?:`[^`]*\${|['"][^'"]*['"]\s*\+)/;

/** Matches Python subprocess calls executing with shell=True. */
export const PYTHON_SHELL_INJECTION_PATTERN =
    /\b(?:os\.system|subprocess\.(?:call|Popen|run))\s*\([^)]*shell\s*=\s*True/;

/** Matches prototype pollution assignment patterns. */
export const PROTO_POLLUTION_PATTERN =
    /(?:__proto__\s*=|\[\s*['"]__proto__['"]\s*\]\s*=|constructor\s*\.\s*prototype\s*=)/;

/** Matches contextual indicators for security-sensitive cryptographic tokens. */
export const INSECURE_RANDOM_CTX_PATTERN =
    /(?:token|secret|key|salt|nonce|auth|pass|session|pwd|credential)/i;

/** Matches non-cryptographic pseudo-random number generator calls. */
export const INSECURE_RANDOM_CALL_PATTERN =
    /\b(?:Math\.random\s*\(\)|rand\s*\(\)|random\.random\s*\(\))/;

/** Matches broken or deprecated cryptographic hash algorithms (MD5, SHA1). */
export const BROKEN_CRYPTO_PATTERN =
    /\b(?:createHash\s*\(\s*['"](?:md5|sha1)['"]|crypto\.createHash\s*\(\s*['"](?:md5|sha1)['"]|hashlib\.(?:md5|sha1)\s*\()/i;

/** Matches untrusted path traversal inputs into filesystem functions. */
export const PATH_TRAVERSAL_PATTERN =
    /\b(?:readFile|readFileSync|createReadStream|unlink|rmdir)\s*\([^)]*(?:req\.(?:query|params|body)|request\.(?:query|params|body)|urlParams|searchParams|userInput)/;

/** Matches sensitive credential variables logged directly to console or logger. */
export const SENSITIVE_LOG_PATTERN =
    /\b(?:console\.(?:log|warn|error|info|debug)|logger\.(?:log|warn|error|info|debug))\s*\([^)]*(?:password|passwd|secretKey|client_secret|apiKey|authToken|bearerToken|accessToken)/i;

/** Matches backend secret or token references via process.env in client/production files. */
export const SENSITIVE_BACKEND_ENV_PATTERN =
    /\bprocess\.env\.(?:[A-Z0-9_]*(?:SECRET|PRIVATE|DATABASE_URL|DB_PASS|API_KEY|TOKEN)[A-Z0-9_]*)\b/;

/** Matches local developer absolute directory paths (e.g. C:\... or /Users/... or /home/...). */
export const LOCAL_ABSOLUTE_PATH_PATTERN =
    /(?:[A-Za-z]:[\\/]|(?:\/(?:Users|home|workspace|root)[\\/]))[a-zA-Z0-9_.-]+/;

/** Matches public sourceMappingURL directives excluding inline data URIs. */
export const SOURCE_MAP_PUBLIC_DIRECTIVE_PATTERN = /\bsourceMappingURL=(?!data:application\/json)/;

/** Matches console debug or trace logging calls. */
export const CONSOLE_DEBUG_TRACE_PATTERN = /\bconsole\.(?:debug|trace)\s*\(/;

/** Matches pending developer markers (TODO / FIXME). */
export const PENDING_TODO_FIXME_PATTERN = /\b(?:TODO|FIXME)\b/;

/** Matches sensitive authentication and secret field assignments. */
export const SENSITIVE_FIELD_ASSIGN_PATTERN =
    /\b(?:passwordHash|passwordSalt|secretKey|clientSecret|privateKey|authToken)\s*[:=]/i;

/** Matches internal or administrative API endpoint call expressions. */
export const INTERNAL_ENDPOINT_CALL_PATTERN =
    /(?:fetch|axios\.(?:get|post|put|delete)|request)\s*\(\s*['"`](?:https?:\/\/[^'"`]+)?\/(?:api\/)?(?:internal|admin\/internal|actuator|debug|private)\//i;

/** Matches internal or administrative API endpoint path strings. */
export const INTERNAL_ENDPOINT_PATH_PATTERN =
    /['"`]\/(?:internal|admin\/internal|actuator|debug)\/[a-zA-Z0-9_/-]+['"`]/i;

/** Matches CSS visual hiding used as authorization on privileged markup elements. */
export const CSS_AUTH_BYPASS_PATTERN =
    /<(?:button|div|span|form)[^>]*(?:style\s*=\s*['"][^'"]*display\s*:\s*none|hidden\b)[^>]*(?:admin|manage|delete|grant|privileged)/i;

/** Matches inactive or disabled feature flags delivering dead execution branches to clients. */
export const FEATURE_FLAG_DEAD_GATE_PATTERN =
    /\bif\s*\(\s*(?:FEATURE_FLAGS\.[A-Z0-9_]+\s*===?\s*false|!FEATURE_FLAGS\.[A-Z0-9_]+)\s*\)\s*\{/i;

/** Matches unreleased, debug, or internal staging routes packaged for clients. */
export const CLIENT_DEBUG_ROUTE_PATTERN =
    /\b(?:path|route)\s*:\s*['"`]\/(?:test|sandbox|debug|preview|internal-only)[a-zA-Z0-9_/-]*['"`]/i;

/** Matches message event listener registrations on window or global context. */
export const MESSAGE_LISTENER_PATTERN =
    /(?:addEventListener\s*\(\s*['"`]message['"`]|(?:window\.)?onmessage\s*=)/i;

/** Matches sensitive client-side action triggers requiring user activation. */
export const SENSITIVE_ACTION_TRIGGER_PATTERN =
    /\b(?:window\.open\s*\(|localStorage\.setItem\s*\(|sessionStorage\.setItem\s*\(|\.download\s*=|vscode\.postMessage\s*\(|document\.execCommand\s*\()/i;

/** Matches user activation or origin checks guarding synthetic message handling. */
export const USER_ACTIVATION_OR_ORIGIN_PATTERN =
    /\b(?:(?:event|e|ev|msg)\.userActivation\b|userActivation\.(?:isActive|hasBeenActive)|\.origin\b)/i;

/** Frozen domain namespace aggregating credential, injection, and security hazard patterns. */
export const REGEX_SECURITY = Object.freeze({
    HEX_TOKEN_ENTROPY: HEX_TOKEN_ENTROPY_PATTERN,
    PRIVATE_KEY_HEADER: PRIVATE_KEY_HEADER_PATTERN,
    GENERIC_SECRET_ASSIGN: GENERIC_SECRET_ASSIGN_PATTERN,
    CREDENTIAL_TOKEN: CREDENTIAL_TOKEN_PATTERN,
    DANGEROUS_EVAL: DANGEROUS_EVAL_PATTERN,
    PYTHON_EXEC: PYTHON_EXEC_PATTERN,
    GDSCRIPT_EXEC: GDSCRIPT_EXEC_PATTERN,
    COMMAND_EXEC: COMMAND_EXEC_PATTERN,
    SHELL_INJECTION: SHELL_INJECTION_PATTERN,
    PYTHON_SHELL_INJECTION: PYTHON_SHELL_INJECTION_PATTERN,
    PROTO_POLLUTION: PROTO_POLLUTION_PATTERN,
    INSECURE_RANDOM_CTX: INSECURE_RANDOM_CTX_PATTERN,
    INSECURE_RANDOM_CALL: INSECURE_RANDOM_CALL_PATTERN,
    BROKEN_CRYPTO: BROKEN_CRYPTO_PATTERN,
    PATH_TRAVERSAL: PATH_TRAVERSAL_PATTERN,
    SENSITIVE_LOG: SENSITIVE_LOG_PATTERN,
    SENSITIVE_BACKEND_ENV: SENSITIVE_BACKEND_ENV_PATTERN,
    LOCAL_ABSOLUTE_PATH: LOCAL_ABSOLUTE_PATH_PATTERN,
    SOURCE_MAP_PUBLIC_DIRECTIVE: SOURCE_MAP_PUBLIC_DIRECTIVE_PATTERN,
    CONSOLE_DEBUG_TRACE: CONSOLE_DEBUG_TRACE_PATTERN,
    PENDING_TODO_FIXME: PENDING_TODO_FIXME_PATTERN,
    SENSITIVE_FIELD_ASSIGN: SENSITIVE_FIELD_ASSIGN_PATTERN,
    INTERNAL_ENDPOINT_CALL: INTERNAL_ENDPOINT_CALL_PATTERN,
    INTERNAL_ENDPOINT_PATH: INTERNAL_ENDPOINT_PATH_PATTERN,
    CSS_AUTH_BYPASS: CSS_AUTH_BYPASS_PATTERN,
    FEATURE_FLAG_DEAD_GATE: FEATURE_FLAG_DEAD_GATE_PATTERN,
    CLIENT_DEBUG_ROUTE: CLIENT_DEBUG_ROUTE_PATTERN,
    MESSAGE_LISTENER: MESSAGE_LISTENER_PATTERN,
    SENSITIVE_ACTION_TRIGGER: SENSITIVE_ACTION_TRIGGER_PATTERN,
    USER_ACTIVATION_OR_ORIGIN: USER_ACTIVATION_OR_ORIGIN_PATTERN,
});
