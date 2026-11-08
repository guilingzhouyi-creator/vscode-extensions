/**
 * Module: Taxis Quality Contract Synchronization
 * File Path: scripts/common/sync-quality-evidence.js
 * Architecture Role: Derive Rust/TypeScript types and runtime schema from the authoritative schema.
 * Dependencies & Triggers: Node filesystem; invoked before the Taxis TypeScript test entry.
 * Responsibilities: Generate deterministic contracts and reject drift without mutating in check mode.
 * Exit Semantics & Design Rationale: Unsupported schema forms fail explicitly instead of widening types.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'quality-evidence.schema.json'), 'utf8');
const schema = JSON.parse(source);
const definitions = schema.$defs;

function typeExpression(shape, indent = 0) {
  if (shape.$ref) {
    const name = shape.$ref.replace(/^#\/\$defs\//, '');
    if (!Object.hasOwn(definitions, name)) throw new Error('Unknown quality schema reference');
    return name;
  }
  if (Object.hasOwn(shape, 'const')) return JSON.stringify(shape.const);
  if (shape.enum) return shape.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (shape.oneOf) return shape.oneOf.map((item) => `(${typeExpression(item, indent)})`).join(' | ');
  switch (shape.type) {
    case 'string': return 'string';
    case 'number':
    case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'array': return `ReadonlyArray<${typeExpression(shape.items, indent)}>`;
    case 'object': {
      if (shape.additionalProperties !== false) throw new Error('Open quality objects are unsupported');
      const required = new Set(shape.required || []);
      const fields = Object.entries(shape.properties).map(([name, value]) =>
        `${' '.repeat(indent + 4)}readonly ${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${typeExpression(value, indent + 4)};`);
      return `{\n${fields.join('\n')}\n${' '.repeat(indent)}}`;
    }
    default: throw new Error('Unsupported quality schema type');
  }
}

function header(file, role) {
  return `/**\n * Module: Taxis Quality — Generated Contract\n * File Path: ${file}\n * Architecture Role: ${role}\n * Dependencies & Triggers: Generated from quality-evidence.schema.json.\n * Responsibilities: Preserve the single source contract for TypeScript consumers.\n * Exit Semantics & Design Rationale: Regenerate with sync-quality-evidence.js; never edit manually.\n */\n`;
}

for (const name of Object.keys(definitions)) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error('Invalid generated type identifier');
}
const contractsFile = 'ts/quality/evidence-contracts.ts';
const schemaFile = 'ts/quality/evidence-schema.ts';
const contracts = header(contractsFile, 'Read-only wire types derived from the authoritative JSON Schema.') +
  Object.entries(definitions).map(([name, shape]) => `export type ${name} = ${typeExpression(shape)};\n`).join('\n') +
  `\nexport type QualityDocument = ${typeExpression(schema)};\n`;
function formatSchemaNode(val, indent = 0) {
  if (val === null || typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) {
    if (val.every((x) => typeof x !== 'object' || x === null)) return JSON.stringify(val);
    const items = val.map((x) => `${' '.repeat(indent + 4)}${formatSchemaNode(x, indent + 4)}`);
    return `[\n${items.join(',\n')}\n${' '.repeat(indent)}]`;
  }
  const entries = Object.entries(val);
  const isPrimitiveOrFlatArray = (v) =>
    v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => typeof x !== 'object' || x === null));
  const isCompactLeaf = entries.length <= 5 && entries.every(([, v]) => isPrimitiveOrFlatArray(v));
  if (isCompactLeaf) return JSON.stringify(val);
  const isSmallObjectSchema =
    val.type === 'object' &&
    val.properties &&
    Object.keys(val.properties).length <= 3 &&
    Object.values(val.properties).every((p) => p && typeof p === 'object' && Object.values(p).every(isPrimitiveOrFlatArray));
  if (isSmallObjectSchema) return JSON.stringify(val);
  const lines = entries.map(([k, v]) => `${' '.repeat(indent + 4)}${JSON.stringify(k)}: ${formatSchemaNode(v, indent + 4)}`);
  return `{\n${lines.join(',\n')}\n${' '.repeat(indent)}}`;
}
const embedded = header(schemaFile, 'Embedded schema used without runtime reads of sibling projects.') +
  `export const qualityEvidenceSchema = ${formatSchemaNode(schema)} as const;\n`;
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((argument) => argument !== '--check')) throw new Error('Unsupported synchronization argument');
const rustFile = 'crates/fg-core/src/models/quality_contracts.rs';
const rustContracts = require('./quality-rust-contracts').generateRustContracts(schema, root);
for (const [file, content] of [[contractsFile, contracts], [schemaFile, embedded], [rustFile, rustContracts]]) {
  const target = path.join(root, file);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
      throw new Error(`Quality contract drift: ${file}`);
    }
  } else {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content);
  }
}
