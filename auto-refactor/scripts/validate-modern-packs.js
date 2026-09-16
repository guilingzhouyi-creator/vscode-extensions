/**
 * Module: Verification Harness — Rust/GDScript Modernization Packs
 * File Path: scripts/validate-modern-packs.js
 * Architecture Role: Key-point lock for the `rust-modern` and `gdscript-modern` language packs:
 *     every rule must fire on its canonical shape, stay silent on the negative shapes, and stay
 *     inside its own file extension
 * Dependencies & Triggers: `npm run validate-modern-packs` (part of `npm test`); imports
 *     ../dist/api (scan) and drives synthetic fixtures written into a temp directory
 *     (scan) and drives synthetic fixtures written into a temp directory
 * Responsibilities: Assert all seven Rust rules and all seven GDScript rules hit; assert commented
 *     and quoted lookalikes stay silent; assert a pack ignores the other pack's extension; assert
 *     both packs stay default-off until a config declares them
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so a pack
 *     that silently stops reporting (or starts over-reporting) fails the build. Fixtures go through
 *     the public `scan()` entry point, so the harness exercises adapter + analyzer resolution
 *     rather than a hand-constructed context.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api');

/** One diagnostic shape per Rust rule; the fixture must produce exactly this id set. */
const RUST_RULE_IDS = [
  'RSM-TRY-001',
  'RSM-EXTERN-001',
  'RSM-MACRO-001',
  'RSM-STR-001',
  'RSM-CLONE-001',
  'RSM-UNWRAP-001',
  'RSM-FORMAT-001',
];

/** One diagnostic shape per GDScript rule; the fixture must produce exactly this id set. */
const GDSCRIPT_RULE_IDS = [
  'GDM-YIELD-001',
  'GDM-EXPORT-001',
  'GDM-ONREADY-001',
  'GDM-TOOL-001',
  'GDM-POOL-001',
  'GDM-CONNECT-001',
  'GDM-RPC-001',
];

/** Rust fixture: one canonical shape per rule, all on distinct lines. */
const RUST_POSITIVE = [
  'extern crate serde;',
  '',
  '#[macro_use]',
  'mod macros;',
  '',
  'fn parse(input: &String) -> Result<u32, Error> {',
  '    let value = try!(input.trim().parse::<u32>());',
  '    let cached = cache.get(key).unwrap();',
  '    if a.clone() == b {',
  '        println!("{}", value);',
  '    }',
  '    Ok(value)',
  '}',
  '',
].join('\n');

/** Rust fixture: the same keywords inside comments, strings and already-modern call sites. */
const RUST_NEGATIVE = [
  '// extern crate commented;',
  '/* #[macro_use] inside a block comment */',
  'const TEXT: &str = "try!(x) and .unwrap()";',
  'fn borrow(s: &str) -> usize { s.len() }',
  'fn ok() -> Result<(), E> { do_it()?; Ok(()) }',
  'fn inline(v: u32) { println!("{v}"); }',
  'fn compare(a: &Foo, b: &Foo) -> bool { a == b }',
  '',
].join('\n');

/** GDScript fixture: one Godot 3 shape per rule, all on distinct lines. */
const GDSCRIPT_POSITIVE = [
  'tool',
  'extends Node',
  '',
  'export(int) var speed = 10',
  'onready var sprite = $Sprite',
  '',
  'remote func hit():',
  '\tvar pool = PoolByteArray()',
  '\tyield(get_tree().create_timer(1.0), "timeout")',
  '\tbutton.connect("pressed", self, "_on_pressed")',
  '',
].join('\n');

/** GDScript fixture: Godot 4 forms plus commented/quoted lookalikes. */
const GDSCRIPT_NEGATIVE = [
  '# tool',
  '# export var x = 1',
  'var text = "yield(obj) and PoolByteArray"',
  'const NAME = "layout"',
  '@export var speed := 10',
  '@onready var sprite = $Sprite',
  'func _ready():',
  '\tawait get_tree().create_timer(1.0).timeout',
  '',
].join('\n');

/**
 * Write files and scan the tree with the given analyzer declarations.
 *
 * @param root - Fixture project root.
 * @param files - Map of relative path to UTF-8 content.
 * @param analyzers - Declarative analyzer block for the generated config file.
 * @returns Live (suppression-free) findings.
 */
async function scanFixture(root, files, analyzers) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const absolute = path.join(root, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  const configFile = path.join(root, 'auto-refactor.config.json');
  fs.writeFileSync(configFile, JSON.stringify({ include: ['**/*'], analyzers }, null, 2));
  const report = await scan({ root, configFile, logLevel: 'silent', cache: false });
  return report.issues.filter(
    (issue) => issue.rule.startsWith('RSM-') || issue.rule.startsWith('GDM-'),
  );
}

/**
 * Reduce findings to the sorted, de-duplicated rule ids they carry.
 *
 * @param issues - Findings from one fixture scan.
 * @returns Sorted unique rule ids.
 */
function ruleIds(issues) {
  return [...new Set(issues.map((issue) => issue.rule))].sort();
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-modern-packs-'));
  const bothPacks = { 'rust-modern': { enabled: true }, 'gdscript-modern': { enabled: true } };
  try {
    // ── 1. Every Rust rule fires on its canonical shape ──
    const rustHits = await scanFixture(root, { 'src/main.rs': RUST_POSITIVE }, bothPacks);
    assert.deepStrictEqual(
      ruleIds(rustHits),
      [...RUST_RULE_IDS].sort(),
      `rust-modern must report every rule, got ${JSON.stringify(ruleIds(rustHits))}`,
    );
    console.log('  [PASS] all seven rust-modern rules fire on their canonical shape');

    // ── 2. Rust negatives stay silent ──
    const rustSilent = await scanFixture(root, { 'src/negative.rs': RUST_NEGATIVE }, bothPacks);
    assert.deepStrictEqual(
      rustSilent.map((issue) => `${issue.rule}:${issue.location.start.line}`),
      [],
      `comments, strings and modern call sites must stay silent, got ${JSON.stringify(rustSilent)}`,
    );
    console.log('  [PASS] rust comments, strings and modern call sites stay silent');

    // ── 3. Every GDScript rule fires on its Godot 3 shape ──
    const gdHits = await scanFixture(root, { 'src/player.gd': GDSCRIPT_POSITIVE }, bothPacks);
    assert.deepStrictEqual(
      ruleIds(gdHits),
      [...GDSCRIPT_RULE_IDS].sort(),
      `gdscript-modern must report every rule, got ${JSON.stringify(ruleIds(gdHits))}`,
    );
    console.log('  [PASS] all seven gdscript-modern rules fire on their Godot 3 shape');

    // ── 4. GDScript negatives and Godot 4 forms stay silent ──
    const gdSilent = await scanFixture(root, { 'src/migrated.gd': GDSCRIPT_NEGATIVE }, bothPacks);
    assert.deepStrictEqual(
      gdSilent.map((issue) => `${issue.rule}:${issue.location.start.line}`),
      [],
      `Godot 4 forms and comments must stay silent, got ${JSON.stringify(gdSilent)}`,
    );
    console.log('  [PASS] gdscript comments and Godot 4 forms stay silent');

    // ── 5. Each pack ignores the other pack's extension ──
    const crossed = await scanFixture(
      root,
      { 'src/rust-as-gd.gd': RUST_POSITIVE, 'src/gd-as-rs.rs': GDSCRIPT_POSITIVE },
      bothPacks,
    );
    assert.deepStrictEqual(
      crossed.map((issue) => `${issue.rule}:${issue.location.file}`),
      [],
      `extension scoping must keep the packs apart, got ${JSON.stringify(crossed)}`,
    );
    console.log('  [PASS] each pack ignores the other pack’s file extension');

    // ── 6. Both packs are opt-in: no declaration, no finding ──
    const off = await scanFixture(
      root,
      { 'src/main.rs': RUST_POSITIVE, 'src/player.gd': GDSCRIPT_POSITIVE },
      {},
    );
    assert.deepStrictEqual(off, [], 'specialized packs must stay off until they are declared');
    console.log('  [PASS] modernization packs stay default-off until a config declares them');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('\n ALL MODERN PACK CHECKS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
