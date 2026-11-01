/**
 * Module: Unit Test — GDScript Modernization Analyzer Suite (GDM-* Rules)
 * File Path: tests/unit/analyzers/gdscript-modern.test.ts
 * Architecture Role: Exercises GdscriptModernAnalyzer line scanner across Godot 3 to Godot 4
 *   syntax migrations (yield, onready, export, tool, PoolArray).
 * Dependencies & Triggers: vitest (describe, it, expect); imports GdscriptModernAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert GDM-YIELD-001, GDM-ONREADY-001, GDM-EXPORT-001, and GDM-POOL-001.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { GdscriptModernAnalyzer } from '../../../src/analyzers/gdscript-modern';
import type { AnalyzerContext } from '../../../src/core/types';

describe('GdscriptModernAnalyzer Suite', () => {
    const analyzer = new GdscriptModernAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits modern Godot 4 GDScript using @onready, @export and await', () => {
        const code = [
            '@tool',
            'extends Node2D',
            '@export var speed: float = 100.0',
            '@onready var sprite = $Sprite2D',
            'func _ready() -> void:',
            '    await get_tree().create_timer(1.0).timeout',
        ].join('\n');
        const ctx = createCtx('scripts/player.gd', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags legacy Godot 3 yield syntax in favor of await (GDM-YIELD-001)', () => {
        const code = [
            'extends Node2D',
            'func wait_a_bit():',
            '    yield(get_tree().create_timer(1.0), "timeout")',
        ].join('\n');
        const ctx = createCtx('scripts/timer.gd', code);
        const issues = analyzer.analyze(undefined, ctx);
        const yieldIssue = issues.find((i) => i.rule === 'GDM-YIELD-001');
        expect(yieldIssue).toBeDefined();
        expect(yieldIssue?.message).toContain('yield');
    });

    it('flags legacy onready var syntax without @ prefix (GDM-ONREADY-001)', () => {
        const code = [
            'extends Node2D',
            'onready var label = $Label',
        ].join('\n');
        const ctx = createCtx('scripts/hud.gd', code);
        const issues = analyzer.analyze(undefined, ctx);
        const onreadyIssue = issues.find((i) => i.rule === 'GDM-ONREADY-001');
        expect(onreadyIssue).toBeDefined();
        expect(onreadyIssue?.message).toContain('@onready');
    });

    it('flags legacy Godot 3 PoolStringArray in favor of PackedStringArray (GDM-POOL-001)', () => {
        const code = [
            'extends Node',
            'var items: PoolStringArray = PoolStringArray()',
        ].join('\n');
        const ctx = createCtx('scripts/inventory.gd', code);
        const issues = analyzer.analyze(undefined, ctx);
        const poolIssue = issues.find((i) => i.rule === 'GDM-POOL-001');
        expect(poolIssue).toBeDefined();
        expect(poolIssue?.message).toContain('Packed');
    });
});
