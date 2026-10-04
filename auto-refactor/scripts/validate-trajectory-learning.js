/**
 * Module: Verification Harness - Historical Trajectory Learning & Recipe Extraction
 * File Path: scripts/validate-trajectory-learning.js
 * Architecture Role: Comprehensive verification harness for Bad-to-Good trajectory learning,
 *   refactoring recipe synthesis, mathematical scoring formulas, precondition matching,
 *   compatibility layer technical debt decay, deprecation lifecycle governance, regression
 *   detection (GOV-TRJ-001), and Praxis trajectory learning facade SPI integration.
 * Dependencies & Triggers: Consumes ../dist/api; executed in test-parallel runner.
 * Responsibilities: Validate all 16 core functional gates and mathematical
 *   models of Trajectory Learning.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing,
 *   throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
  TrajectoryRecipeExtractor,
  RegressionTrajectoryDetector,
  createPraxisTrajectoryLearningService,
  calculateTrajectoryQualityVelocity,
  calculateRecipeGeneralizationIndex,
  calculateParameterClumpDensity,
  calculateLoopAllocationPressure,
  calculateHookDecouplingRatio,
  calculateDataFlowPurityScore,
  calculateObjectPoolConservationIndex,
  calculateCasReentrancySafetyIndex,
  calculateIndirectionUtilityMetric,
  calculateConfigCacheFreshnessScore,
  calculateDtoCompatibilityBridgeIndex,
  calculateSchemaGroundingRate,
  calculateShimDebtDecayPenalty,
  calculateArchitectureDirectnessIndex,
  calculateDeprecationConvergenceHealth,
  calculateZeroCostModernUtility,
  calculateModernConstructAdoptionRate,
} = require('../dist/api');

async function main() {
  console.log('================================================================');
  console.log('🧪 Verifying Trajectory Learning & Architecture Modernization (16 Gates)');
  console.log('================================================================');

  const extractor = new TrajectoryRecipeExtractor();
  const detector = new RegressionTrajectoryDetector();
  const service = createPraxisTrajectoryLearningService(extractor, detector);

  // Gate 1: Monolithic to Extract-Method (REC-SPLIT)
  console.log('\n[Gate 1] Verifying Bad->Good decomposition into extract-method recipe...');
  const beforeMonolith = `
function processBatchOrder(orders: any[], config: any) {
    let total = 0;
    for (let i = 0; i < orders.length; i++) {
        const item = orders[i];
        if (item.active) {
            if (item.price > 100) { total += item.price * 0.9; }
            else if (item.price > 50) { total += item.price * 0.95; }
            else { total += item.price; }
        }
    }
    return total;
}
// Line 14
// Line 15
// Line 16
// Line 17
// Line 18
// Line 19
// Line 20
// Line 21
// Line 22
// Line 23
`;
  const afterDecomposed = `
function calculateItemDiscount(item: any): number {
    if (!item.active) return 0;
    if (item.price > 100) return item.price * 0.9;
    if (item.price > 50) return item.price * 0.95;
    return item.price;
}
function processBatchOrder(orders: any[], config: any) {
    return orders.reduce((sum, item) => sum + calculateItemDiscount(item), 0);
}
`;
  const splitInput = {
    trajectoryId: 'trj-split-001',
    filePath: 'src/orders.ts',
    beforeContent: beforeMonolith,
    afterContent: afterDecomposed,
    beforeScore: { compositeScore: 65, dimensions: {} },
    afterScore: { compositeScore: 88, dimensions: {} },
    language: 'typescript',
  };
  const recipe1 = extractor.extractRecipeFromTrajectory(splitInput);
  assert(recipe1 !== undefined, 'Expected extract-method recipe');
  assert.strictEqual(recipe1.category, 'extract-method');
  assert(recipe1.recipeId.startsWith('REC-SPLIT-'));
  assert.strictEqual(recipe1.operations[0].opKind, 'split-function');
  console.log(`  ✔ Synthesized Recipe: ${recipe1.recipeId} (${recipe1.name})`);

  // Gate 2: Long Parameter List to Parameter Object Pattern (REC-PARAM)
  console.log('\n[Gate 2] Verifying parameter list consolidation into parameter-object recipe...');
  const beforeParams = `
function renderChart(containerId: string, width: number, height: number, theme: string, showLegend: boolean, animate: boolean, palette: string[]) {
    return true;
}
// Line 5\n// Line 6\n// Line 7\n// Line 8\n// Line 9\n// Line 10
`;
  const afterParams = `
interface ChartOptions { width: number; height: number; theme: string; showLegend: boolean; animate: boolean; palette: string[]; }
function renderChart(containerId: string, options: ChartOptions) { return true; }
`;
  const paramInput = {
    trajectoryId: 'trj-param-002',
    filePath: 'src/chart.ts',
    beforeContent: beforeParams,
    afterContent: afterParams,
    beforeScore: { compositeScore: 70, dimensions: {} },
    afterScore: { compositeScore: 92, dimensions: {} },
    language: 'typescript',
  };
  const recipe2 = extractor.extractRecipeFromTrajectory(paramInput);
  assert(recipe2 !== undefined, 'Expected parameter-object recipe');
  assert.strictEqual(recipe2.category, 'parameter-object');
  assert(recipe2.recipeId.startsWith('REC-PARAM-'));
  assert.strictEqual(recipe2.operations[0].opKind, 'introduce-parameter-object');
  console.log(`  ✔ Synthesized Recipe: ${recipe2.recipeId} (${recipe2.name})`);

  // Gate 3: Switch Cascade to Strategy Dispatch Pattern (REC-STRAT)
  console.log('\n[Gate 3] Verifying conditional cascade to strategy-dispatch recipe...');
  const beforeSwitch = `
function handleEvent(type: string, data: any) {
    switch (type) {
        case 'click': return doClick(data);
        case 'hover': return doHover(data);
        case 'keydown': return doKeydown(data);
        case 'keyup': return doKeyup(data);
        default: return null;
    }
}
// Line 11\n// Line 12\n// Line 13\n// Line 14\n// Line 15\n// Line 16
`;
  const afterStrategy = `
const EVENT_HANDLERS: Record<string, (data: any) => any> = { click: doClick, hover: doHover, keydown: doKeydown, keyup: doKeyup };
function handleEvent(type: string, data: any) {
    const handler = EVENT_HANDLERS[type];
    return handler ? handler(data) : null;
}
`;
  const stratInput = {
    trajectoryId: 'trj-strat-003',
    filePath: 'src/events.ts',
    beforeContent: beforeSwitch,
    afterContent: afterStrategy,
    beforeScore: { compositeScore: 60, dimensions: {} },
    afterScore: { compositeScore: 89, dimensions: {} },
    language: 'typescript',
  };
  const recipe3 = extractor.extractRecipeFromTrajectory(stratInput);
  assert(recipe3 !== undefined, 'Expected strategy-dispatch recipe');
  assert.strictEqual(recipe3.category, 'strategy-dispatch');
  assert(recipe3.recipeId.startsWith('REC-STRAT-'));
  assert.strictEqual(recipe3.operations[0].opKind, 'extract-strategy');
  console.log(`  ✔ Synthesized Recipe: ${recipe3.recipeId} (${recipe3.name})`);

  // Gate 4: Object Pool & Reset State Lifecycle Pattern (REC-POOL)
  console.log('\n[Gate 4] Verifying object-pool-lifecycle pattern (REC-POOL)...');
  const beforePool = `
class CombatParticleEffect {
    var position: Vector2
    var velocity: Vector2
    func init_particle(pos: Vector2, vel: Vector2) -> void:
        position = pos
        velocity = vel
}
// Line 8\n// Line 9\n// Line 10\n// Line 11\n// Line 12\n// Line 13\n// Line 14\n// Line 15
`;
  const afterPool = `
class CombatParticleEffect {
    var position: Vector2
    var velocity: Vector2
    static var _pool: Array = []
    func reset_state() -> void:
        position = Vector2.ZERO
        velocity = Vector2.ZERO
    static func acquire(pos: Vector2, vel: Vector2) -> CombatParticleEffect:
        var p = _pool.pop_back() if not _pool.is_empty() else CombatParticleEffect.new()
        p.position = pos
        p.velocity = vel
        return p
    func release() -> void:
        reset_state()
        _pool.push_back(self)
}
`;
  const poolInput = {
    trajectoryId: 'trj-pool-004',
    filePath: 'src/particles.gd',
    beforeContent: beforePool,
    afterContent: afterPool,
    beforeScore: { compositeScore: 58, dimensions: {} },
    afterScore: { compositeScore: 90, dimensions: {} },
    language: 'gdscript',
  };
  const recipePool = extractor.extractRecipeFromTrajectory(poolInput);
  assert(recipePool !== undefined, 'Expected object-pool-lifecycle recipe');
  assert.strictEqual(recipePool.category, 'object-pool-lifecycle');
  assert(recipePool.recipeId.startsWith('REC-POOL-'));
  assert.strictEqual(recipePool.operations[0].opKind, 'introduce-object-pool');
  assert.strictEqual(recipePool.operations[1].opKind, 'inject-reset-state');
  console.log(`  ✔ Synthesized Recipe: ${recipePool.recipeId} (${recipePool.name})`);

  // Gate 5: CAS Reentrancy State Guard Pattern (REC-CAS)
  console.log('\n[Gate 5] Verifying cas-reentrancy-guard pattern (REC-CAS)...');
  const beforeCas = `
class BattleEngine {
    func execute_turn() -> void:
        _process_turn_phases()
}
// Line 5\n// Line 6\n// Line 7\n// Line 8\n// Line 9
`;
  const afterCas = `
class BattleEngine {
    var _is_executing: bool = false
    func execute_turn() -> void:
        if _is_executing: return
        _is_executing = true
        _process_turn_phases()
        _is_executing = false
}
`;
  const casInput = {
    trajectoryId: 'trj-cas-005',
    filePath: 'src/battle/engine.gd',
    beforeContent: beforeCas,
    afterContent: afterCas,
    beforeScore: { compositeScore: 66, dimensions: {} },
    afterScore: { compositeScore: 93, dimensions: {} },
    language: 'gdscript',
  };
  const recipeCas = extractor.extractRecipeFromTrajectory(casInput);
  assert(recipeCas !== undefined, 'Expected cas-reentrancy-guard recipe');
  assert.strictEqual(recipeCas.category, 'cas-reentrancy-guard');
  assert(recipeCas.recipeId.startsWith('REC-CAS-'));
  assert.strictEqual(recipeCas.operations[0].opKind, 'inject-cas-guard');
  console.log(`  ✔ Synthesized Recipe: ${recipeCas.recipeId} (${recipeCas.name})`);

  // Gate 6: Config Cache Invalidation Pattern (REC-HOTCFG)
  console.log('\n[Gate 6] Verifying config-cache-invalidation pattern (REC-HOTCFG)...');
  const beforeCfg = `
class CombatEvaluator {
    func evaluate_stats(item_id: String) -> Dictionary:
        return GameConfig.get_item(item_id)
}
// Line 5\n// Line 6\n// Line 7\n// Line 8\n// Line 9\n// Line 10\n// Line 11\n// Line 12
`;
  const afterCfg = `
class CombatEvaluator {
    static var _cached_stats: Dictionary = {}
    static var _cache_version: int = -1
    static func invalidate_cache() -> void:
        _cached_stats.clear()
        _cache_version = -1
    func _ensure_combat_cache() -> void:
        if _cache_version == GameConfig.config_reload_version: return
        invalidate_cache()
        _cache_version = GameConfig.config_reload_version
    func evaluate_stats(item_id: String) -> Dictionary:
        _ensure_combat_cache()
        return _cached_stats.get(item_id, {})
}
`;
  const cfgInput = {
    trajectoryId: 'trj-hotcfg-006',
    filePath: 'src/combat/evaluator.gd',
    beforeContent: beforeCfg,
    afterContent: afterCfg,
    beforeScore: { compositeScore: 68, dimensions: {} },
    afterScore: { compositeScore: 94, dimensions: {} },
    language: 'gdscript',
  };
  const recipeHotCfg = extractor.extractRecipeFromTrajectory(cfgInput);
  assert(recipeHotCfg !== undefined, 'Expected config-cache-invalidation recipe');
  assert.strictEqual(recipeHotCfg.category, 'config-cache-invalidation');
  assert(recipeHotCfg.recipeId.startsWith('REC-HOTCFG-'));
  assert.strictEqual(recipeHotCfg.operations[0].opKind, 'inject-cache-invalidation');
  console.log(`  ✔ Synthesized Recipe: ${recipeHotCfg.recipeId} (${recipeHotCfg.name})`);

  // Gate 7: Data Clump to Context DTO Aggregation Pattern (REC-DTO)
  console.log('\n[Gate 7] Verifying dto-context-aggregation pattern (REC-DTO)...');
  const beforeDto = `
class HudMutationManager {
    func apply_mutation(source_id: String, target_id: String, channel_type: int, delta_amount: float, timestamp: int, extra_flags: Dictionary) -> bool:
        return _execute_mutation(source_id, target_id, channel_type, delta_amount, timestamp, extra_flags)
}
// Line 5\n// Line 6\n// Line 7\n// Line 8\n// Line 9\n// Line 10\n// Line 11\n// Line 12
`;
  const afterDto = `
class HudMutationManager {
    func apply_mutation_context(context: HudMutationContextDTO) -> bool:
        if not context or not context.is_valid(): return false
        return _execute_context(context)
    func apply_mutation(source_id: String, target_id: String, channel_type: int, delta_amount: float, timestamp: int, extra_flags: Dictionary) -> bool:
        var context = HudMutationContextDTO.from_stat_mutation(source_id, target_id, channel_type, delta_amount, timestamp, extra_flags)
        return apply_mutation_context(context)
}
`;
  const dtoInput = {
    trajectoryId: 'trj-dto-007',
    filePath: 'src/hud/mutation_manager.gd',
    beforeContent: beforeDto,
    afterContent: afterDto,
    beforeScore: { compositeScore: 62, dimensions: {} },
    afterScore: { compositeScore: 91, dimensions: {} },
    language: 'gdscript',
  };
  const recipeDto = extractor.extractRecipeFromTrajectory(dtoInput);
  assert(recipeDto !== undefined, 'Expected dto-context-aggregation recipe');
  assert.strictEqual(recipeDto.category, 'dto-context-aggregation');
  assert(recipeDto.recipeId.startsWith('REC-DTO-'));
  assert.strictEqual(recipeDto.operations[0].opKind, 'introduce-dto-context');
  console.log(`  ✔ Synthesized Recipe: ${recipeDto.recipeId} (${recipeDto.name})`);

  // Gate 8: Dynamic Hook Decoupling Pattern (REC-HOOK)
  console.log('\n[Gate 8] Verifying hook-decoupling pattern (REC-HOOK)...');
  const beforeHook = `
class GameSessionFlow {
    func advance_flow(step: int) -> void:
        if step == 1: _show_character_create()
        elif step == 2: _start_prologue_cutscene()
        elif step == 3: _mount_hud_interface()
}
// Line 7\n// Line 8\n// Line 9\n// Line 10
`;
  const afterHook = `
class GameSessionFlow {
    func advance_flow(step: int) -> void:
        var context = { "step": step, "session": self }
        HookRegistry.dispatch_hook("session_lifecycle_step", context)
}
`;
  const hookInput = {
    trajectoryId: 'trj-hook-008',
    filePath: 'src/session/flow.gd',
    beforeContent: beforeHook,
    afterContent: afterHook,
    beforeScore: { compositeScore: 64, dimensions: {} },
    afterScore: { compositeScore: 93, dimensions: {} },
    language: 'gdscript',
  };
  const recipeHook = extractor.extractRecipeFromTrajectory(hookInput);
  assert(recipeHook !== undefined, 'Expected hook-decoupling recipe');
  assert.strictEqual(recipeHook.category, 'hook-decoupling');
  assert(recipeHook.recipeId.startsWith('REC-HOOK-'));
  assert.strictEqual(recipeHook.operations[0].opKind, 'inject-hook-dispatch');
  console.log(`  ✔ Synthesized Recipe: ${recipeHook.recipeId} (${recipeHook.name})`);

  // Gate 9: Shim Elimination & Obsolete Bridge Purge (REC-PURGE)
  console.log('\n[Gate 9] Verifying shim-elimination pattern (REC-PURGE)...');
  const beforeShim = `
class HudMutationManager {
    func apply_mutation_context(context: HudMutationContextDTO) -> bool:
        return _execute_context(context)
    func apply_mutation(source_id: String, target_id: String, channel_type: int, delta_amount: float, timestamp: int, extra_flags: Dictionary) -> bool:
        var context = HudMutationContextDTO.from_stat_mutation(source_id, target_id, channel_type, delta_amount, timestamp, extra_flags)
        return apply_mutation_context(context)
}
`;
  const afterPurgedShim = `
class HudMutationManager {
    func apply_mutation_context(context: HudMutationContextDTO) -> bool:
        return _execute_context(context)
}
`;
  const shimInput = {
    trajectoryId: 'trj-purge-009',
    filePath: 'src/hud/mutation_manager.gd',
    beforeContent: beforeShim,
    afterContent: afterPurgedShim,
    beforeScore: { compositeScore: 82, dimensions: {} },
    afterScore: { compositeScore: 98, dimensions: {} },
    language: 'gdscript',
  };
  const recipeShim = extractor.extractRecipeFromTrajectory(shimInput);
  assert(recipeShim !== undefined, 'Expected shim-elimination recipe');
  assert.strictEqual(recipeShim.category, 'shim-elimination');
  assert(recipeShim.recipeId.startsWith('REC-PURGE-'));
  assert.strictEqual(recipeShim.operations[0].opKind, 'remove-stale-shim');
  console.log(`  ✔ Synthesized Recipe: ${recipeShim.recipeId} (${recipeShim.name})`);

  // Gate 10: Direct Modern Migration Pattern (REC-DIRECT)
  console.log('\n[Gate 10] Verifying direct-modern-migration pattern (REC-DIRECT)...');
  const beforeDirectCaller = `
func on_battle_damaged(actor: Actor, target: Target, amount: float):
    mutation_mgr.apply_mutation(actor.id, target.id, 1, amount, Time.get_ticks_msec(), {})
`;
  const afterDirectCaller = `
func on_battle_damaged(actor: Actor, target: Target, amount: float):
    var ctx = HudMutationContextDTO.create(actor.id, target.id, 1, amount)
    mutation_mgr.apply_mutation_context(ctx)
`;
  const directInput = {
    trajectoryId: 'trj-direct-010',
    filePath: 'src/battle/caller.gd',
    beforeContent: beforeDirectCaller,
    afterContent: afterDirectCaller,
    beforeScore: { compositeScore: 75, dimensions: {} },
    afterScore: { compositeScore: 95, dimensions: {} },
    language: 'gdscript',
  };
  const recipeDirect = extractor.extractRecipeFromTrajectory(directInput);
  assert(recipeDirect !== undefined, 'Expected direct-modern-migration recipe');
  assert.strictEqual(recipeDirect.category, 'direct-modern-migration');
  assert(recipeDirect.recipeId.startsWith('REC-DIRECT-'));
  assert.strictEqual(recipeDirect.operations[0].opKind, 'bypass-shim-to-direct');
  console.log(`  ✔ Synthesized Recipe: ${recipeDirect.recipeId} (${recipeDirect.name})`);

  // Gate 11: Deprecation Lifecycle & Sunset Metadata Governance (REC-DEPR)
  console.log('\n[Gate 11] Verifying deprecation-lifecycle pattern (REC-DEPR)...');
  const beforeUnannotated = `
function calculateTaxLegacy(amount: number, state: string): number {
    return amount * 0.05;
}
`;
  const afterDeprecationAnnotated = `
/**
 * @deprecated [Since v1.4.0, Sunset v2.0.0] Use TaxCalculator.compute(TaxContext) instead.
 */
function calculateTaxLegacy(amount: number, state: string): number {
    return amount * 0.05;
}
`;
  const deprInput = {
    trajectoryId: 'trj-depr-011',
    filePath: 'src/finance/tax.ts',
    beforeContent: beforeUnannotated,
    afterContent: afterDeprecationAnnotated,
    beforeScore: { compositeScore: 72, dimensions: {} },
    afterScore: { compositeScore: 90, dimensions: {} },
    language: 'typescript',
  };
  const recipeDepr = extractor.extractRecipeFromTrajectory(deprInput);
  assert(recipeDepr !== undefined, 'Expected deprecation-lifecycle recipe');
  assert.strictEqual(recipeDepr.category, 'deprecation-lifecycle');
  assert(recipeDepr.recipeId.startsWith('REC-DEPR-'));
  assert.strictEqual(recipeDepr.operations[0].opKind, 'inject-deprecated-annotation');
  console.log(`  ✔ Synthesized Recipe: ${recipeDepr.recipeId} (${recipeDepr.name})`);

  // Gate 12: Zero-Cost Modern Abstraction & Direct View (REC-ZCOST)
  console.log('\n[Gate 12] Verifying zero-cost-modernization pattern (REC-ZCOST)...');
  const beforeBoxing = `
function evaluateContext(rawInput: any): any {
    var boxed = { "source": rawInput.source, "value": rawInput.val };
    return solver.solve(boxed);
}
`;
  const afterZeroCost = `
function evaluateContext(rawInput: TypedContextView): any {
    return solver.solve_direct(rawInput);
}
`;
  const zcostInput = {
    trajectoryId: 'trj-zcost-012',
    filePath: 'src/engine/eval.ts',
    beforeContent: beforeBoxing,
    afterContent: afterZeroCost,
    beforeScore: { compositeScore: 68, dimensions: {} },
    afterScore: { compositeScore: 96, dimensions: {} },
    language: 'typescript',
  };
  const recipeZcost = extractor.extractRecipeFromTrajectory(zcostInput);
  assert(recipeZcost !== undefined, 'Expected zero-cost-modernization recipe');
  assert.strictEqual(recipeZcost.category, 'zero-cost-modernization');
  assert(recipeZcost.recipeId.startsWith('REC-ZCOST-'));
  assert.strictEqual(recipeZcost.operations[0].opKind, 'introduce-zero-cost-view');
  console.log(`  ✔ Synthesized Recipe: ${recipeZcost.recipeId} (${recipeZcost.name})`);

  // Gate 13: Mathematical Scoring Formulas (All 17 Formulas)
  console.log('\n[Gate 13] Verifying mathematical scoring formulas...');
  const bScore = { compositeScore: 60, dimensions: {} };
  const aScore = { compositeScore: 90, dimensions: {} };
  assert.strictEqual(calculateTrajectoryQualityVelocity(bScore, aScore, 0.0), 30.0);
  assert.strictEqual(calculateTrajectoryQualityVelocity(bScore, aScore, 1.0), 20.0);
  assert.strictEqual(calculateTrajectoryQualityVelocity(bScore, aScore, 4.0), 10.0);

  assert.strictEqual(calculateRecipeGeneralizationIndex(10, 10, 0.0, 25.0), 25.0);
  assert.strictEqual(calculateRecipeGeneralizationIndex(3, 10, 0.5, 20.0), 3.0);

  assert.strictEqual(calculateParameterClumpDensity(3, 2, 4), 0);
  assert.strictEqual(calculateParameterClumpDensity(5, 4, 4), 2.0);
  assert.strictEqual(calculateParameterClumpDensity(7, 9, 4), 27.0);

  assert.strictEqual(calculateLoopAllocationPressure(0, 2), 0);
  assert.strictEqual(calculateLoopAllocationPressure(3, 0), 3.0);

  assert.strictEqual(calculateHookDecouplingRatio(8, 2), 0.8);
  assert.strictEqual(calculateDataFlowPurityScore(1, 0, 9), 0.9);
  assert.strictEqual(calculateObjectPoolConservationIndex(10, 10, true), 1.0);
  assert.strictEqual(calculateObjectPoolConservationIndex(10, 10, false), 0);
  assert.strictEqual(calculateCasReentrancySafetyIndex(9, 10, 0.0), 0.9);
  assert.strictEqual(calculateIndirectionUtilityMetric(100, 0), 100.0);
  assert.strictEqual(calculateConfigCacheFreshnessScore(5, 5, 0.0), 1.0);
  assert.strictEqual(calculateDtoCompatibilityBridgeIndex(5, 5, 0), 0.91);
  assert.strictEqual(calculateSchemaGroundingRate(18, 20), 0.9);

  // Modernization Formulas
  const shimFresh = calculateShimDebtDecayPenalty(10, 0, 5, 10);
  const shimOld = calculateShimDebtDecayPenalty(10, 50, 5, 10);
  const expectedFresh = Math.round(10 * 1.0 * (5 / 11) * 100) / 100;
  const expectedOld = Math.round(10 * (1.0 + 0.02 * 50) * (5 / 11) * 100) / 100;
  assert.strictEqual(shimFresh, expectedFresh);
  assert.strictEqual(shimOld, expectedOld);

  assert.strictEqual(calculateArchitectureDirectnessIndex(80, 20, 0), 0.8);
  assert.strictEqual(calculateDeprecationConvergenceHealth(10, 0, 0, 100), 1.0);
  assert.strictEqual(calculateDeprecationConvergenceHealth(10, 5, 10, 100), 0.49);
  assert.strictEqual(calculateZeroCostModernUtility(1.2, 0, 0.0, 1.0), 100.0);
  assert.strictEqual(calculateZeroCostModernUtility(0.8, 3, 0.5, 0.8, 0.2), 20.0);
  assert.strictEqual(calculateModernConstructAdoptionRate(90, 10), 0.9);
  console.log('  ✔ All 17 Mathematical Formulas verified with 100% precision');

  // Gate 14: Precondition Matching on All Learned Patterns
  console.log('\n[Gate 14] Verifying recipe precondition matching across all patterns...');
  [
    recipe1,
    recipe2,
    recipe3,
    recipePool,
    recipeCas,
    recipeHotCfg,
    recipeDto,
    recipeHook,
    recipeShim,
    recipeDirect,
    recipeDepr,
    recipeZcost,
  ].forEach((r) => service.registerRecipe(r));
  const candidatePoolCode = `func emit_sparks():\n    for i in range(10):\n        var s = Particle.new()\n        s.duplicate(true)\n// line 5\n// line 6\n// line 7\n// line 8\n// line 9\n// line 10\n// line 11\n// line 12\n// line 13\n// line 14\n// line 15\n`;
  const poolRecs = service.matchRecipes(candidatePoolCode, 'gdscript');
  assert(poolRecs.some((r) => r.category === 'object-pool-lifecycle'));
  console.log(
    `  ✔ Precondition matching passed for object-pool-lifecycle (${poolRecs.length} matches)`,
  );

  const candidateShimCode = `func call_legacy():\n    var x = from_stat_mutation("a", "b", 1, 2.0, 3, {})\n// line 3\n// line 4\n// line 5\n// line 6\n`;
  const shimRecs = service.matchRecipes(candidateShimCode, 'gdscript');
  assert(shimRecs.some((r) => r.category === 'shim-elimination'));
  console.log(`  ✔ Precondition matching passed for shim-elimination (${shimRecs.length} matches)`);

  // Gate 15: Cyclic Flip-Flop Detection (GOV-TRJ-001)
  console.log('\n[Gate 15] Verifying cyclic oscillation & flip-flop detection (GOV-TRJ-001)...');
  const revisions = [
    {
      revisionId: 'rev-001',
      fileHash: 'hash-aaa',
      astDigest: 'ast-aaa',
      timestamp: 1000,
      agentUid: 'agent-alice',
      qualityScore: { compositeScore: 70, dimensions: {} },
      ruleHitIds: [],
    },
    {
      revisionId: 'rev-002',
      fileHash: 'hash-bbb',
      astDigest: 'ast-bbb',
      timestamp: 2000,
      agentUid: 'agent-bob',
      qualityScore: { compositeScore: 85, dimensions: {} },
      ruleHitIds: [],
    },
    {
      revisionId: 'rev-003',
      fileHash: 'hash-aaa',
      astDigest: 'ast-aaa',
      timestamp: 3000,
      agentUid: 'agent-charlie',
      qualityScore: { compositeScore: 68, dimensions: {} },
      ruleHitIds: [],
    },
  ];
  const regIssues = detector.detectRegressions('src/core/payment.ts', revisions);
  assert(regIssues.length >= 1 && regIssues[0].rule === 'GOV-TRJ-001');
  console.log(`  ✔ Emitted blocking issue: ${regIssues[0].rule} -> ${regIssues[0].message}`);

  // Gate 16: Praxis Facade SPI & Performance Benchmark
  console.log('\n[Gate 16] Verifying Praxis trajectory learning facade & latency benchmark...');
  const verdict = await service.learnFromTrajectory({ ...poolInput, churnRatio: 0.4 });
  assert.strictEqual(verdict.hasBadToGoodImprovement, true);
  assert(verdict.qualityDelta > 0 && verdict.qualityVelocity > 0);
  console.log(
    `  ✔ Praxis Verdict: ΔScore=+${verdict.qualityDelta.toFixed(1)} | Velocity=${verdict.qualityVelocity.toFixed(1)} | GenIndex=${verdict.generalizationIndex.toFixed(1)} | Recipe=${verdict.extractedRecipe.recipeId}`,
  );

  const tStart = Date.now();
  for (let i = 0; i < 100; i++) {
    service.matchRecipes(candidatePoolCode, 'gdscript');
    service.matchRecipes(candidateShimCode, 'gdscript');
    detector.detectRegressions('src/test.ts', revisions);
  }
  const avgMs = (Date.now() - tStart) / 100;
  console.log(
    `  ✔ Processed 100 cycles in ${Date.now() - tStart}ms (Average: ${avgMs.toFixed(2)}ms per cycle)`,
  );
  assert(avgMs < 15.0);

  console.log('\n================================================================');
  console.log('🎉 ALL 16 GATES OF Trajectory Learning & Modernization VERIFIED!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\n❌ Trajectory Learning validation failed:', err);
  process.exit(1);
});
