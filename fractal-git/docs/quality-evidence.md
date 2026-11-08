# Quality evidence wire contract v1

[quality-evidence.schema.json](../quality-evidence.schema.json) is the authoritative draft 2020-12 schema for requests, analysis evidence, and review receipts. It describes wire structure. Parsing a document does not establish real execution, complete coverage, correct trial counts, snapshot matching, issuer trust, or permission to promote a change.

## Parsing and generated types

Run `node scripts/common/sync-quality-evidence.js` from the Taxis directory after changing the schema. The command generates Rust serde DTOs, TypeScript readonly types, and an embedded TypeScript runtime schema. It uses the installed `rustfmt` to format Rust output. `--check` rejects drift without writing files and runs before the formal TypeScript test entry.

Rust consumers enter through [quality_evidence.rs](../crates/fg-core/src/models/quality_evidence.rs); TypeScript consumers use [evidence-validation.ts](../ts/quality/evidence-validation.ts). Both first validate strict JSON, then the same embedded schema. Rust returns a wrapper with private fields and shared accessors. TypeScript recursively freezes parsed documents. Standalone DTOs express wire types; constructing or deserializing a DTO directly does not enforce all schema constraints.

No runtime read of a sibling Auto/Taxis checkout is required. TypeScript ships its generated embedded schema; Rust embeds the authoritative schema at compile time. Unknown fields, envelope kinds, major versions, abbreviated object identities, invalid discriminators, and malformed measurement states fail closed. Validators do not insert defaults, coerce values, or remove fields. External schema resolution is disabled.

The schema preserves four measurement states: `measured`, `unmeasured`, `not-applicable`, and `failed`. A measured zero stays measured. A missing measurement cannot become zero or success. `TrialCounts` describes counts structurally; semantic verification must still reject impossible ratios, duplicated execution identities, or counts without actual executions. Coverage and track labels alone do not prove completion.

## Encoding and identities

Review JSON uses the RFC 8785 canonical representation with these additional profile limits:

- Input and canonical output each contain at most 1 MiB.
- Nesting contains at most 64 containers.
- UTF-8 must be valid, without a BOM; unpaired Unicode surrogates fail.
- Duplicate decoded object keys fail, including differently escaped spellings of the same key.
- Numbers must be finite and have absolute values no greater than `Number.MAX_SAFE_INTEGER`. Integer timestamps and counts also have schema bounds.
- Object keys follow UTF-16 ordering; ECMAScript number formatting and negative-zero normalization apply. Recursively sorting objects followed by ordinary object serialization is insufficient for integer-like keys.

Content/policy/configuration digests use explicit `sm3` identities with 64 lowercase hexadecimal characters. Git tree/object identities remain explicit `git-sha1` values with 40 lowercase hexadecimal characters. These two identity domains are never interchangeable. All baseline strategies are explicit: initial, parent, explicit, or merge; the schema bounds their parent counts.

Repository paths in v1 have length and shape bounds only. Immutable snapshot readers must independently validate confinement, link handling, mode, object identity, and byte content before analysis. Auto's [immutable source snapshot port](../../auto-refactor/docs/06-praxis-delivery/05-immutable-source-snapshot.md) documents the implemented capture, input states and scanner boundary.

## Receipt signing bytes

The signing input is RFC 8785 encoding of exactly this unsigned envelope:

```json
{
  "schemaVersion": 1,
  "kind": "trusted-review-receipt",
  "payload": {}
}
```

The example shows the envelope shape; the actual payload must contain every field required by the schema. The full payload binds repository/tree/manifest, baseline, review and operation IDs, policy/configuration/required-capability digests, request/evidence digests, issuer/key ID/algorithm, decision, and issuance/expiry times. Only the outer `signature` field is excluded. No unsigned presentation fields are accepted in the receipt schema. Changes to any signed field require a new MAC.

Use the Rust wrapper's receipt signing method or TypeScript `receiptSigningBytes` to obtain these bytes. Both reject request/evidence envelopes. The shared `hmac-sm3` implementation requires an explicit 32-byte secret. There is no default production key. A valid MAC proves integrity for a key; it does not establish who is authorized to use the key, key revocation status, receipt freshness, semantic evidence validity, or whether the bound operation may proceed.

[receipt-signing-vector.json](../tests/fixtures/quality/receipt-signing-vector.json) contains a deliberately public interoperability key and an `unavailable` receipt. It binds the shared request/evidence digests and pins exact unsigned bytes, SM3 digest, and HMAC. The fixture asserts no trusted approval. The lower-level [canonical vectors](../tests/fixtures/quality/canonical-vectors.json) additionally cover integer-like keys, UTF-16 ordering, Unicode escaping, floating-point formatting, invalid input, and nested payload tampering.

## Dependencies and compatibility

| Dependency | Version | License | Purpose and boundary |
| :--- | :--- | :--- | :--- |
| Rust `serde_json_canonicalizer` | 0.4.1, exact | MIT | RFC 8785 bytes and ECMAScript number formatting, using `ryu-js` 1.0.3. |
| Rust `jsonschema` | 0.60.2, exact | MIT | Draft 2020-12 validation; default features disabled, without HTTP, filesystem, async, or TLS resolution. Requires Rust 1.85 or later. |
| TypeScript `ajv` | 8.20.0, exact | MIT | Draft 2020-12 validation against the embedded schema. |
| Node `crypto` / existing Rust authority primitives | Existing platform facilities | Platform/project terms | SM3 and HMAC-SM3; no additional signing algorithm or implicit trust store. |

The JSON Schema validator adds transitive build dependencies. Mature validators were selected to avoid a second handwritten schema implementation. Runtime memory, binary size, and first-validation compilation overhead remain subject to the plan's resource/performance acceptance; they have not been declared negligible. The Rust validator compiles its embedded schema once per process. The TypeScript validator compiles once when its module loads.

The major wire version is exactly 1. Unsupported major versions must be rejected until an explicit migration exists. Existing compact audit records, static canary output, and legacy credit proportions do not contain the required bindings, execution identities, or denominators. They remain legacy diagnostic/history data and cannot be upgraded by relabeling, filling in synthetic counts, or merely verifying their old signatures. In particular, legacy history aggregation is not an authoritative evidence producer.

## Verification

`npm test` checks generated contract drift, builds TypeScript, and discovers both quality test files. `cargo test -p fg-core --lib quality_evidence` validates the same structural positives, mutation negatives, duplicate-key rejection, typed round trips, and signing vector. `cargo test -p fg-core --lib quality_encoding` checks the lower-level canonical byte and cryptographic vectors. Run the existing workspace tests and Clippy checks before integration.

Trusted issuer lifecycle, receipt expiry/replay rejection, snapshot/baseline matching, semantic completion, and final promotion authority belong to the subsequent integration tasks. The structural parser and signing-byte helpers do not substitute for those checks.
