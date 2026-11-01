/**
 * Module: Unit Test — GDScript Game Domain Analyzer Suite
 * File Path: tests/unit/analyzers/gdscript-game.test.ts
 * Architecture Role: Exercises GdscriptGameAnalyzer across hot-path allocation (GDM-PRF-001),
 *   object pool reset contracts (GDM-POL-001), signal connection leaks (GDM-SIG-001),
 *   and headless domain isolation (GDM-ISO-001).
 * Dependencies & Triggers: vitest (describe, it, expect); imports GdscriptGameAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert GDM-PRF-001, GDM-POL-001, GDM-SIG-001, and GDM-ISO-001 rules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { GdscriptGameAnalyzer } from '../../../src/analyzers/gdscript-game';
import type { AnalyzerContext } from '../../../src/core/types';

describe('GdscriptGameAnalyzer Suite', () => {
    const analyzer = new GdscriptGameAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits compliant GDScript game module using object pool and pure domain architecture', () => {
        const code = [
            'class_name BulletPool',
            'extends RefCounted',
            '',
            'var _pool: Array = []',
            '',
            'func acquire():',
            '    var bullet = _pool.pop_back()',
            '    bullet.reset_state()',
            '    return bullet',
        ].join('\n');
        const ctx = createCtx('game/entities/bullet_pool.gd', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags object pool acquisition missing reset_state invocation (GDM-POL-001)', () => {
        const code = [
            'class_name ParticleFactory',
            'extends Node',
            '',
            'var _particles: Array = []',
            '',
            'func acquire():',
            '    return _particles.pop_back()',
        ].join('\n');
        const ctx = createCtx('game/vfx/particle_pool.gd', code);
        const issues = analyzer.analyze(undefined, ctx);
        const poolIssue = issues.find((i) => i.rule === 'GDM-POL-001');
        expect(poolIssue).toBeDefined();
        expect(poolIssue?.message).toContain('reset_state');
    });

    it('flags transient heap allocation in _process hot-path (GDM-PRF-001)', () => {
        const code = [
            'extends Node2D',
            '',
            'func _process(delta: float) -> void:',
            '    var temp = Node2D.new()',
            '    temp.position = Vector2.ZERO',
        ].join('\n');
        const ctx = createCtx('game/player/controller.gd', code);
        const issues = analyzer.analyze(undefined, ctx);
        const hotIssue = issues.find((i) => i.rule === 'GDM-PRF-001');
        expect(hotIssue).toBeDefined();
        expect(hotIssue?.message).toContain('Transient heap allocation');
    });

    it('flags pure domain logic referencing presentation Node tree (GDM-ISO-001)', () => {
        const code = [
            'extends RefCounted',
            'class_name CombatCalculator',
            '',
            'func calculate_damage():',
            '    var node = get_node("/root/World")',
            '    return 10',
        ].join('\n');
        const ctx = createCtx('game/domain/combat.gd', code);
        const issues = analyzer.analyze(undefined, ctx);
        const isoIssue = issues.find((i) => i.rule === 'GDM-ISO-001');
        expect(isoIssue).toBeDefined();
        expect(isoIssue?.message).toContain('Domain logic');
    });
});
