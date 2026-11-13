import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import {
    TrajectoryRecipeExtractor,
    loadTrajectoryPluginsFromPresets,
    parsePresetTrajectoryPlugin,
} from '../../../src/core/trajectory/recipeExtractor';
import type { RefactoringRecipe } from '../../../src/core/trajectory/recipeTypes';
import { numberMeasurement } from '../../../src/core/review/review-contracts';

function makeProbeRecipe(tags: string[], targetLanguage?: string): RefactoringRecipe {
    return {
        recipeId: 'REC-TEST-001',
        name: 'Probe Recipe',
        category: 'config-hoisting',
        description: 'Probe recipe for plugin isolation tests.',
        precondition: {
            targetLanguage,
            minLines: 1,
            antiPatternTags: tags,
        },
        operations: [
            {
                opKind: 'hoist-config-lookup',
                targetSymbol: 'probe',
                description: 'Probe transform operation.',
            },
        ],
        expectedQualityGain: null,
        qualityGain: numberMeasurement(null, { source: 'test' }, 'unmeasured'),
        sourceTrajectoryId: 'traj-probe',
    };
}

describe('TrajectoryRecipeExtractor plugin decoupling', () => {
    it('stays project-neutral when built-in preset auto-loading is disabled', () => {
        const coreOnly = new TrajectoryRecipeExtractor({ autoLoadBuiltinPresets: false });
        const configQueryRecipe = makeProbeRecipe(['hot-path-config-query'], 'gdscript');
        const gdSnippet = [
            'func tick():',
            '  var a = GameConfig.get_hp()',
            '  var b = GameConfig.get_atk()',
            '  var c = GameConfig.get_def()',
        ].join('\n');

        expect(coreOnly.matchesRecipe(configQueryRecipe, gdSnippet, 'gdscript')).toBe(false);

        const genericRecipe = makeProbeRecipe(['long-parameter-list']);
        expect(
            coreOnly.matchesRecipe(
                genericRecipe,
                'function compute(alphaParam, betaParam, gammaParam, deltaParam) { return alphaParam; }',
                'typescript',
            ),
        ).toBe(true);
    });

    it('auto-loads godot-game preset plugin for gdscript without core hardcoding', () => {
        const defaultExtractor = new TrajectoryRecipeExtractor();
        const configQueryRecipe = makeProbeRecipe(['hot-path-config-query'], 'gdscript');
        const shimRecipe = makeProbeRecipe(['stale-shim-layer'], 'gdscript');
        const poolRecipe = makeProbeRecipe(['transient-heap-allocation'], 'gdscript');

        const gdConfigSnippet = [
            'var a = GameConfig.get_hp()',
            'var b = GameConfig.get_atk()',
            'var c = GameConfig.get_def()',
        ].join('\n');
        expect(defaultExtractor.matchesRecipe(configQueryRecipe, gdConfigSnippet, 'gdscript')).toBe(
            true,
        );
        expect(
            defaultExtractor.matchesRecipe(
                shimRecipe,
                'func migrate():\n  return from_stat_mutation(x)',
                'gdscript',
            ),
        ).toBe(true);
        expect(
            defaultExtractor.matchesRecipe(
                poolRecipe,
                'var node = template.duplicate(true)',
                'gdscript',
            ),
        ).toBe(true);
        expect(defaultExtractor.getTagRuleCount('gdscript')).toBeGreaterThan(
            defaultExtractor.getTagRuleCount(),
        );
    });

    it('supports scoped custom plugins and ignores malformed preset configs gracefully', () => {
        const extractor = new TrajectoryRecipeExtractor({
            autoLoadBuiltinPresets: false,
            plugins: [
                {
                    id: 'custom-rust-rules',
                    language: 'rust',
                    tagRules: {
                        'panic-call': {
                            kind: 'pattern',
                            pattern: '\\.unwrap\\(\\)',
                        },
                    },
                },
            ],
        });
        const rustRecipe = makeProbeRecipe(['panic-call'], 'rust');
        expect(extractor.matchesRecipe(rustRecipe, 'let x = opt.unwrap();', 'rust')).toBe(true);
        expect(
            extractor.matchesRecipe(makeProbeRecipe(['panic-call']), 'let x = opt.unwrap();', 'ts'),
        ).toBe(false);

        expect(parsePresetTrajectoryPlugin(null)).toBeUndefined();
        expect(
            parsePresetTrajectoryPlugin({
                trajectoryPlugin: {
                    id: 'broken-regex',
                    tagRules: { bad: { kind: 'pattern', pattern: '[unclosed' } },
                },
            }),
        ).toBeUndefined();

        const presetsDir = path.resolve(__dirname, '../../../presets');
        const loaded = loadTrajectoryPluginsFromPresets([presetsDir]);
        expect(loaded.some((plugin) => plugin.language === 'gdscript')).toBe(true);
    });
});
