# Immutable source snapshot input

The snapshot input port in [source-snapshot.ts](../../src/core/review/source-snapshot.ts) fixes analysis bytes independently of the mutable workspace. It describes source identity and byte availability; it does not prove tree membership, authorize the repository, or approve a change.

## Capture and identity

`captureSourceSnapshot(descriptor, entries, budget)` verifies every blob's declared byte length and full Git SHA-1 object identity before copying the bytes into private storage. The object identity hashes the Git `blob <length>\0` header followed by the exact bytes. The descriptor supplies an explicit repository ID and full Git tree identity. An optional declared manifest digest must match the captured manifest.

The required host budget bounds entry count, per-blob bytes and total captured bytes. No unlimited/default budget is supplied. Capture holds a bounded in-memory set; a future object-store adapter may implement the same port with bounded streaming before publication. Supplying a tree OID alone does not establish that entries belong to that tree: the Taxis adapter must verify tree traversal and object types.

The manifest digest is SM3 of the UTF-8 JSON serialization of:

```text
["source-snapshot-manifest-v1", [[path, mode, "git-sha1", objectId, byteLength], ...]]
```

Entries sort by exact UTF-16 path order. Paths must be NFC, relative POSIX paths in a portable filename profile. Duplicate paths, differently cased directory/file spellings, file/directory collisions, traversal, empty components, backslashes, control characters, lone surrogates, Windows reserved names/characters and trailing dots/spaces fail. Paths are rejected rather than silently normalized. A change in mode or path changes the manifest digest even when blob bytes are identical. The manifest's versioned tuple encoding is separate from the evidence envelope's RFC 8785 encoding.

Snapshot identity, manifest entries and the port are frozen. Every read returns a fresh byte buffer. Mutating either the original input buffer or a previously returned buffer cannot change the stored source. Reads optionally require an exact declared object identity. Missing paths remain missing; there is no host-file fallback or case-insensitive path lookup.

## Explicit input states

| Read kind | Behavior |
| :--- | :--- |
| `text` | Strict UTF-8 content, exact bytes, file mode, BOM flag and newline style. Empty files remain valid empty text. |
| `binary` | NUL-containing byte input remains binary and does not enter text analysis. |
| `unsupported` | Invalid UTF-8 retains bytes with reason `invalid-utf8`; replacement decoding is not used. |
| `symlink` | Mode `120000` retains the link blob; the target is never followed. |
| `submodule` | Mode `160000` retains the commit identity; it is not treated as an empty source file. |
| `missing` | A path absent from the captured manifest, including a requested deletion, is explicit. Requiring a blob identity for a missing path fails. |

Regular and executable files use modes `100644` and `100755`. Link/submodule outcomes declare input handling; they do not claim language analyzer support or policy permission to skip the item.

## Scanner entry

`Scanner.scanSnapshot(snapshot, scope?)` uses the existing asynchronous single-file analyzer stage and returns snapshot identity, static issues, file metrics and an observation for every requested path. It performs no workspace discovery, warm/diff cache reuse, mutable source reads, review-memory publication or trajectory publication. Non-text inputs stay visible in observations and are not handed to text analyzers. Cancellation is checked before/after execution and between files.

Create a fresh scanner with an explicit project archetype and `cacheEnabled: false`. A previously used workspace scanner cannot start snapshot analysis, and a snapshot scanner rejects later workspace, warm, diff and in-process filesystem scans. This bounds graph/index reuse until the separate generation-aware graph/cache integration is available. Existing workspace and Diff APIs continue to analyze mutable workspace input; their results do not automatically become snapshot-bound evidence.

The single-file SDK also exposes `semanticCapabilities` from the existing semantic registry. It distinguishes TypeScript AST extraction from Python/Rust/Go/GDScript lexical graph extraction and preserves unknown custom adapter versions as null. These frozen declarations contain no execution status and do not grant slice support or complete coverage. Asynchronous graph adapters are awaited before SDK/Diff consumers read the graph; extraction failures propagate. The SDK's mutable-workspace file entry has not yet been replaced by the unified snapshot review executor.

The snapshot path reuses configured analyzers, not a sandbox for arbitrary plugin code. Policy/configuration binding, supported language capabilities, parser failures, actual analyzer execution, deep-track completion and third-party plugin isolation require their own checks. In particular, zero issues and zero analyzed text files are not proof of complete review. The subsequent review executor must consume the explicit input observations when deciding coverage.

## Execution observations

Snapshot scans return immutable per-file `execution` observations from the same parser and analyzer calls that produced diagnostics. Each planned analyzer records its declared version (or `null`), actual hook/batch call count, failure, and routing/preflight skip reason. A skipped candidate remains `not-run`; it receives no policy applicability exemption.

TypeScript and oxc retain errors from the exact native parse, including lazy projection and materialized traversal. Recovered errors remain `degraded`. An adapter with lexical precision or without a precision declaration cannot establish complete AST coverage. Unsupported language coverage remains incomplete even when its diagnostic is disabled. Line-window calls preserve their bounds and remain partial relative to full-file execution.

A consumer of `Scanner.runAnalyzers` can request the same observations using `observeExecution: true`. The default scan path does not construct a recorder or wrap analyzer hooks. These observations are local execution facts: downstream review aggregation still has to bind required capabilities, versions, scope and snapshot identity. Cache reuse and trusted gate receipts require additional validation.

## Verification

[Source snapshot tests](../../tests/unit/quality/source-snapshot.test.ts) cover buffer isolation, identity/length mismatch, empty/executable/BOM/newline handling, deletion/rename, binary/link/submodule/encoding outcomes, portable path conflicts, manifest determinism and budgets. [Scanner tests](../../tests/unit/quality/snapshot-scan.test.ts) exercise the compiled production scanner against a non-existent host root, confirm exact captured content reaches analysis, preserve non-text observations, reject input-mode mixing, and check cancellation.

Taxis object-store population, full baseline/diff change manifests, protocol streaming, generation-aware graph/cache reuse and final cross-platform acceptance remain separate tasks.
