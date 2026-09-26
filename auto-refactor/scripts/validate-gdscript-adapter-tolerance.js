/**
 * Module: Verification Harness — GDScript Adapter Literal & Tolerance Semantics
 * File Path: scripts/validate-gdscript-adapter-tolerance.js
 * Architecture Role: Validates that GDScript adapter correctly classifies dictionary keys,
 *   subscript expressions, engine API calls as tolerated while maintaining strict detection
 *   on real hardcoded strings and magic literals.
 * Dependencies & Triggers: Run via
 *   `node scripts/validate-gdscript-adapter-tolerance.js` and test-parallel.
 * Responsibilities: Exercise positive and negative parsing fixtures for GDScript tolerance rules.
 * Exit Semantics & Design Rationale: Process exits 0 on success; throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const { GDScriptAdapter } = require('../dist/core/ast/gdscript-adapter');
const { NodeKind } = require('../dist/core/ast/multilang');

const adapter = new GDScriptAdapter();

function collectLiterals(node, result = []) {
    if (node.kind === NodeKind.StringLiteral || node.kind === NodeKind.NumericLiteral) {
        result.push(node);
    }
    if (node.children) {
        for (const child of node.children) {
            collectLiterals(child, result);
        }
    }
    return result;
}

function runTests() {
    // 1. Dictionary keys should be tolerated, while string values are not tolerated
    const dictCode = `
func setup_data():
    var config = {
        "max_speed": 250,
        "hero_title": "GrandChampion"
    }
`;
    const dictAst = adapter.parse(dictCode, 'sample_dict.gd');
    const dictLits = collectLiterals(dictAst.root);

    const maxSpeedLit = dictLits.find((l) => l.text === 'max_speed');
    assert(maxSpeedLit, 'max_speed string literal must exist');
    assert.strictEqual(maxSpeedLit.tolerated, true, 'Dictionary key max_speed should be tolerated');

    const heroTitleLit = dictLits.find((l) => l.text === 'hero_title');
    assert(heroTitleLit, 'hero_title string literal must exist');
    assert.strictEqual(heroTitleLit.tolerated, true, 'Dictionary key hero_title should be tolerated');

    const grandChampLit = dictLits.find((l) => l.text === 'GrandChampion');
    assert(grandChampLit, 'GrandChampion value literal must exist');
    assert.strictEqual(grandChampLit.tolerated, false, 'String value GrandChampion should NOT be tolerated');

    // 2. Subscript expression index should be tolerated, array elements should not
    const subscriptCode = `
func access_item(data):
    var val = data["target_stat"]
    var arr = ["first_tag_item", "second_tag_item"]
    var elem = arr[0]
`;
    const subAst = adapter.parse(subscriptCode, 'sample_subscript.gd');
    const subLits = collectLiterals(subAst.root);

    const targetStatLit = subLits.find((l) => l.text === 'target_stat');
    assert(targetStatLit, 'target_stat literal must exist');
    assert.strictEqual(targetStatLit.tolerated, true, 'Subscript target_stat should be tolerated');

    const firstTagLit = subLits.find((l) => l.text === 'first_tag_item');
    assert(firstTagLit, 'first_tag_item literal must exist');
    assert.strictEqual(firstTagLit.tolerated, false, 'Array element first_tag_item should NOT be tolerated');

    const zeroIndexLit = subLits.find((l) => l.text === '0' && l.kind === NodeKind.NumericLiteral);
    assert(zeroIndexLit, 'Numeric subscript 0 literal must exist');
    assert.strictEqual(zeroIndexLit.tolerated, true, 'Numeric index 0 inside brackets should be tolerated');

    // 3. Engine API calls (get, emit_signal, is_action_pressed) should be tolerated
    const engineCode = `
func process_input():
    var is_active = node.get("visible_state")
    emit_signal("combat_turn_started")
    if is_action_pressed("custom_ui_attack"):
        play("attack_animation")
`;
    const engAst = adapter.parse(engineCode, 'sample_engine.gd');
    const engLits = collectLiterals(engAst.root);

    const visibleStateLit = engLits.find((l) => l.text === 'visible_state');
    assert(visibleStateLit, 'visible_state literal must exist');
    assert.strictEqual(visibleStateLit.tolerated, true, 'Engine node.get("visible_state") should be tolerated');

    const signalLit = engLits.find((l) => l.text === 'combat_turn_started');
    assert(signalLit, 'combat_turn_started literal must exist');
    assert.strictEqual(signalLit.tolerated, true, 'emit_signal("combat_turn_started") should be tolerated');

    const actionLit = engLits.find((l) => l.text === 'custom_ui_attack');
    assert(actionLit, 'custom_ui_attack literal must exist');
    assert.strictEqual(actionLit.tolerated, true, 'is_action_pressed("custom_ui_attack") should be tolerated');

    const animLit = engLits.find((l) => l.text === 'attack_animation');
    assert(animLit, 'attack_animation literal must exist');
    assert.strictEqual(animLit.tolerated, true, 'play("attack_animation") should be tolerated');

    console.log('[PASS] GDScriptAdapter tolerance and subscript validation succeeded.');
}

runTests();
