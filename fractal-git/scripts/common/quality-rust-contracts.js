/**
 * Module: Taxis Quality — Rust Contract Derivation
 * File Path: scripts/common/quality-rust-contracts.js
 * Architecture Role: Derive serde DTOs from the same schema as TypeScript.
 * Dependencies & Triggers: Node child_process and rustfmt, invoked by contract synchronization.
 * Responsibilities: Preserve closed objects, literal discriminators and measurement unions.
 * Exit Semantics & Design Rationale: DTOs describe wire shapes; only validation enforces schema constraints.
 */
'use strict';
const {spawnSync} = require('node:child_process');
const descriptions = Object.freeze({
  SchemaVersion: 'Protocol major version; structural validation accepts exactly v1.',
  Identifier: 'Bounded portable identity string; it conveys no authorization.',
  RepoPath: 'Repository path claim; the snapshot reader separately checks confinement.',
  Digest: 'Explicit SM3 digest namespace and complete lowercase content identity.',
  GitObject: 'Complete Git SHA-1 object identity, distinct from evidence digest identities.',
  SnapshotIdentity: 'Repository, candidate tree and manifest claims bound to one review.',
  Baseline: 'Explicit comparison strategy with schema-bounded distinct parent identities.',
  ReviewBinding: 'Full operation, snapshot, baseline and policy/configuration binding claims.',
  ReviewFailure: 'Portable failure details without exception objects or implicit success.',
  Provenance: 'Declared observation source and sample identities; execution still needs verification.',
  Unmeasured: 'Absence of measurement with an explicit reason, never a numeric fallback.',
  NotApplicable: 'Declared non-applicability; policy permission requires separate verification.',
  FailedMeasurement: 'A failed observation retaining structured failure details.',
  MeasuredNumber: 'Finite measured value with provenance; zero remains an actual measurement.',
  TrialCounts: 'Actual trial count claims; semantic checks must verify identities and denominators.',
  MeasuredTrials: 'Trial counts with provenance, distinct from static test-text inspection.',
  NumberMeasurement: 'Lossless union of numeric observation and explicit absence/failure states.',
  TrialMeasurement: 'Lossless union of counted trials and explicit absence/failure states.',
  Measurements: 'Independent quality, testing, mutation and generalization observations.',
  TrackStatus: 'Execution track state; a pending or failed track cannot prove completion.',
  CapabilityCoverage: 'One declared analyzer/language capability outcome with policy context.',
  Execution: 'Declared execution, required capability coverage and failure observations.',
  ExecutionTracks: 'Separate fast and deep execution states; routing is not execution.',
  EngineVersion: 'Engine revision and configuration identity used for an evidence claim.',
  Diagnostic: 'Bounded static finding with source analyzer and repository location.',
  Timing: 'Execution timing claims with safe integer bounds.',
  ReviewRequest: 'Structural request envelope; permissions are independently resolved by Taxis.',
  ReviewRequestActorContext: 'Actor correlation claim; it does not grant authority.',
  AnalysisEvidence: 'Structural analysis envelope; semantic completion is verified separately.',
  ReceiptPayload: 'Complete authority binding and decision included in receipt signing bytes.',
  TrustedReviewReceipt: 'Receipt wire envelope; parsing establishes neither issuer trust nor approval.',
  QualityDocument: 'Typed wire envelopes; only the structural parser enforces all schema constraints.',
});

function rustDoc(name, shape) {
  if (descriptions[name]) return `/// ${descriptions[name]}\n`;
  if (shape.enum || Object.hasOwn(shape, 'const')) {
    const values = shape.enum || [shape.const];
    return `/// Wire discriminator restricted by the schema to ${values.map(JSON.stringify).join(', ')}.\n`;
  }
  const strategy = shape.properties?.strategy?.const;
  if (strategy) {
    const parents = shape.properties.parents;
    return `/// ${strategy} baseline with ${parents.minItems}..=${parents.maxItems} distinct parent identities.\n`;
  }
  throw new Error(`Missing Rust contract documentation: ${name}`);
}


function pascal(text) {
  const result = text.split(/[^A-Za-z0-9]+/).map((part) => part[0].toUpperCase() + part.slice(1)).join('');
  if (!/^[A-Z][A-Za-z0-9]*$/.test(result)) throw new Error('Unsupported Rust contract identifier');
  return result;
}

function unionLabel(shape, index) {
  if (shape.$ref) return shape.$ref.replace(/^#\/\$defs\//, '');
  const literal = Object.values(shape.properties || {}).find((property) => typeof property.const === 'string');
  return literal ? pascal(literal.const) : `Variant${index + 1}`;
}

function generateRustContracts(schema, root) {
  const declarations = new Map();
  const definitions = schema.$defs;
  const derives = '#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]\n';

  function declareEnum(name, values) {
    if (values.some((value) => typeof value !== 'string')) throw new Error('Unsupported Rust enum literal');
    const names = values.map(pascal);
    if (new Set(names).size !== names.length) throw new Error('Colliding Rust enum variants');
    declarations.set(name, rustDoc(name, {enum: values}) + derives + `pub enum ${name} {\n` + values.map((value, index) =>
      `    #[serde(rename = ${JSON.stringify(value)})]\n    ${names[index]},\n`).join('') + '}\n');
    return name;
  }

  function objectType(name, shape) {
    if (shape.additionalProperties !== false) throw new Error('Open Rust DTO objects are unsupported');
    const required = new Set(shape.required || []);
    const fields = Object.entries(shape.properties).map(([key, value]) => {
      const field = key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase());
      const type = expression(value, name + pascal(key));
      const optional = !required.has(key);
      const attributes = (key !== field ? `    #[serde(rename = ${JSON.stringify(key)})]\n` : '') +
        (optional ? '    #[serde(default, skip_serializing_if = "Option::is_none")]\n' : '');
      return `${attributes}    pub ${field}: ${optional ? `Option<${type}>` : type},\n`;
    });
    declarations.set(name, rustDoc(name, shape) + derives + '#[serde(deny_unknown_fields)]\n' +
      `pub struct ${name} {\n${fields.join('')}}\n`);
    return name;
  }

  function unionType(name, alternatives) {
    const nullable = alternatives.find((item) => item.type === 'null');
    if (nullable && alternatives.length === 2) {
      return `Option<${expression(alternatives.find((item) => item !== nullable), name + 'Value')}>`;
    }
    const labels = alternatives.map(unionLabel);
    if (new Set(labels).size !== labels.length) throw new Error('Colliding Rust union variants');
    const variants = alternatives.map((item, index) => {
      const type = expression(item, name + labels[index]);
      const stored = name === 'QualityDocument' ? `Box<${type}>` : type;
      return `    ${labels[index]}(${stored}),\n`;
    });
    declarations.set(name, rustDoc(name, {oneOf: alternatives}) + derives +
      `#[serde(untagged)]\npub enum ${name} {\n${variants.join('')}}\n`);
    return name;
  }

  function expression(shape, name) {
    if (shape.$ref) {
      const reference = shape.$ref.replace(/^#\/\$defs\//, '');
      if (!Object.hasOwn(definitions, reference)) throw new Error('Unknown Rust schema reference');
      return reference;
    }
    if (typeof shape.const === 'string') return declareEnum(name, [shape.const]);
    if (typeof shape.const === 'number') return 'u32';
    if (shape.enum) return declareEnum(name, shape.enum);
    if (shape.oneOf) return unionType(name, shape.oneOf);
    switch (shape.type) {
      case 'object': return objectType(name, shape);
      case 'array': return `Vec<${expression(shape.items, name + 'Item')}>`;
      case 'string': return 'String';
      case 'boolean': return 'bool';
      case 'integer': return shape.minimum >= 0 ? 'u64' : 'i64';
      case 'number': return 'f64';
      default: throw new Error('Unsupported Rust schema shape');
    }
  }

  for (const [name, shape] of Object.entries(definitions)) {
    const type = expression(shape, name);
    if (type !== name) declarations.set(name, rustDoc(name, shape) + `pub type ${name} = ${type};\n`);
  }
  expression(schema, 'QualityDocument');
  const header = '//! Module: fg-core — Generated Quality DTOs\n' +
    '//! File Path: crates/fg-core/src/models/quality_contracts.rs\n' +
    '//! Architecture Role: Typed wire documents derived from quality-evidence.schema.json.\n' +
    '//! Dependencies & Triggers: Serde and sync-quality-evidence.js.\n' +
    '//! Responsibilities: Preserve closed wire shapes without claiming semantic validity.\n' +
    '//! Exit Semantics & Design Rationale: Regenerate; do not edit. Validation is a separate boundary.\n\n';
  const formatted = spawnSync('rustfmt', ['--emit', 'stdout', '--edition', '2021'], {
    cwd: root, input: header + [...declarations.values()].join('\n'), encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  if (formatted.error) throw formatted.error;
  if (formatted.status !== 0) throw new Error(`Rust contract formatting failed: ${formatted.stderr}`);
  return formatted.stdout.replace(/\r\n/g, '\n');
}

module.exports = {generateRustContracts};
