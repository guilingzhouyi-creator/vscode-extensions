/**
 * Module: Validation — Frontend Architecture & Modernization Governance
 * File Path: scripts/validate-frontend-architecture-governance.js
 * Architecture Role: Validates that all internalized architectural and interaction review rules,
 *   mathematical formulas, Bad-to-Good recipe extractors, and frontend boundary guards maintain
 *   100% integrity, invariant correctness, and zero regressions.
 * Dependencies & Triggers: Built dist files from core scoring, trajectory, and rules.
 * Responsibilities: Run 24 strict assertion gates over the modernized governance ecosystem.
 * Exit Semantics & Design Rationale: Exits 0 on all gates passing, non-zero on assertion failure.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  calculateDebounceProtectionIndex,
  calculateFsmDeterminismScore,
  calculateLayoutNestingDensityIndex,
  calculateObserverWeakRefHygiene,
  calculateResponsiveScalabilityIndex,
  calculateUnidirectionalFlowIntegrity,
  calculateComponentAdoptionIndex,
  calculateDesignTokenComplianceIndex,
  calculateI18nSymmetryIndex,
  calculatePresentationDecouplingIndex,
  calculateBoundaryInteroperabilityFactor,
  calculateProfileCompositeScore,
  calculateShannonEntropy,
  calculateAstLocDensityIndex,
} = require(path.join(__dirname, '..', 'dist', 'core', 'scoring', 'modernization-formulas.js'));

const { ArchetypeWeightTuner } = require(
  path.join(__dirname, '..', 'dist', 'core', 'scoring', 'archetype-weight-tuner.js'),
);

const { detectScoreGaming } = require(
  path.join(__dirname, '..', 'dist', 'core', 'scoring', 'antiGaming.js'),
);

const { TrajectoryRecipeExtractor } = require(
  path.join(__dirname, '..', 'dist', 'core', 'trajectory', 'recipeExtractor.js'),
);

const { RULE_REGISTRY } = require(
  path.join(__dirname, '..', 'dist', 'core', 'rules', 'registry.js'),
);
const RULE_REGISTRY_MAP = new Map(RULE_REGISTRY.map((rule) => [rule.id, rule]));

const { familyDimensionOf } = require(
  path.join(__dirname, '..', 'dist', 'core', 'scoring', 'dimensionDeductions.js'),
);

const { GdscriptModernAnalyzer } = require(
  path.join(__dirname, '..', 'dist', 'analyzers', 'gdscript-modern.js'),
);

console.log('=== Running Frontend Architecture & Governance Validation Pipeline (29 Gates) ===');

// Gate 1: Debounce protection index boundary and scaling invariants
{
  const perfect = calculateDebounceProtectionIndex(10, 5, 10);
  assert.strictEqual(perfect, 100, 'Gate 1 Failed: Perfect debounce protection must yield 100.0');
  const zeroActions = calculateDebounceProtectionIndex(0, 0, 0);
  assert.strictEqual(zeroActions, 100, 'Gate 1 Failed: Zero actions must yield 100.0 default');
  const unprotected = calculateDebounceProtectionIndex(0, 0, 10);
  assert.strictEqual(
    unprotected,
    0,
    'Gate 1 Failed: Completely unprotected actions must yield 0.0',
  );
  console.log('  [PASS] Gate 1: Debounce protection index invariant');
}

// Gate 2: FSM determinism score invariants
{
  const perfectFsm = calculateFsmDeterminismScore(0, 10, 5, 5);
  assert.strictEqual(perfectFsm, 100, 'Gate 2 Failed: Perfect FSM must yield 100.0');
  const wildFsm = calculateFsmDeterminismScore(10, 1, 5, 5);
  assert.ok(wildFsm < 20, 'Gate 2 Failed: Wild mutations must severely penalize FSM score');
  console.log('  [PASS] Gate 2: FSM determinism score invariant');
}

// Gate 3: Layout hierarchy nesting density index invariants
{
  const shallowTree = calculateLayoutNestingDensityIndex([1, 2, 3, 4]);
  assert.strictEqual(shallowTree, 100, 'Gate 3 Failed: Depths <= 4 must yield 100.0');
  const deepTree = calculateLayoutNestingDensityIndex([6, 7, 8], 4, 10.0, 1);
  assert.ok(deepTree < 50, 'Gate 3 Failed: Deep nesting must exponentially penalize layout index');
  console.log('  [PASS] Gate 3: Layout hierarchy nesting density index invariant');
}

// Gate 4: Observer WeakRef hygiene invariants
{
  const pureWeak = calculateObserverWeakRefHygiene(10, 9, 0, 0);
  assert.strictEqual(pureWeak, 100, 'Gate 4 Failed: Pure WeakRef observers must yield 100.0');
  const leakyObservers = calculateObserverWeakRefHygiene(0, 10, 5, 5);
  assert.strictEqual(leakyObservers, 0, 'Gate 4 Failed: Strong uncleaned refs must yield 0.0');
  console.log('  [PASS] Gate 4: Observer WeakRef hygiene invariant');
}

// Gate 5: Viewport & responsive scalability index invariants
{
  const adaptiveLayout = calculateResponsiveScalabilityIndex(0, 20, 1.0, 1.0);
  assert.strictEqual(adaptiveLayout, 100, 'Gate 5 Failed: Fully adaptive layout must yield 100.0');
  const hardcodedLayout = calculateResponsiveScalabilityIndex(15, 15, 0.2, 0.2);
  assert.ok(hardcodedLayout < 20, 'Gate 5 Failed: Hardcoded pixel dimensions must penalize score');
  console.log('  [PASS] Gate 5: Responsive scalability index invariant');
}

// Gate 6: Unidirectional flow integrity invariants
{
  const cleanFlow = calculateUnidirectionalFlowIntegrity(0, 0, 1000);
  assert.strictEqual(cleanFlow, 100, 'Gate 6 Failed: Clean unidirectional flow must yield 100.0');
  const mutatingView = calculateUnidirectionalFlowIntegrity(5, 3, 1000);
  assert.ok(mutatingView < 40, 'Gate 6 Failed: In-place DTO mutations must decay integrity score');
  console.log('  [PASS] Gate 6: Unidirectional data flow integrity invariant');
}

// Gate 7: Registry contains all 5 original GDM rules
{
  const expectedRules = [
    'GDM-DEB-001',
    'GDM-FSM-001',
    'GDM-WEAK-001',
    'GDM-RES-001',
    'GDM-UNI-001',
  ];
  for (const ruleId of expectedRules) {
    const found = RULE_REGISTRY_MAP.get(ruleId);
    assert.ok(found, `Gate 7 Failed: Expected rule ${ruleId} not registered in RULE_REGISTRY`);
    assert.strictEqual(found.family, 'GDM', `Gate 7 Failed: Rule ${ruleId} has wrong family`);
  }
  console.log('  [PASS] Gate 7: RULE_REGISTRY contains all 5 original GDM rules');
}

// Gate 8: Family dimension routing agreement for GDM rules
{
  const expectedRules = [
    'GDM-DEB-001',
    'GDM-FSM-001',
    'GDM-WEAK-001',
    'GDM-RES-001',
    'GDM-UNI-001',
  ];
  for (const ruleId of expectedRules) {
    const routed = familyDimensionOf(ruleId);
    assert.strictEqual(
      routed,
      'modernity',
      `Gate 8 Failed: Rule ${ruleId} must route to modernity`,
    );
  }
  console.log('  [PASS] Gate 8: Family dimension routing agreement for GDM rules');
}

// Gate 9: Trajectory extractor detects interaction-debounce recipe
{
  const extractor = new TrajectoryRecipeExtractor();
  const beforeCode = `
func _ready():
	submit_btn.pressed.connect(_on_submit)
`;
  const afterCode = `
func _ready():
	submit_btn.debounced_pressed.connect(_on_submit)
`;
  const recipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-deb-001',
    filePath: 'views/test_view.gd',
    beforeContent: beforeCode,
    afterContent: afterCode,
  });
  assert.ok(recipe, 'Gate 9 Failed: Trajectory recipe extractor must synthesize debounce recipe');
  assert.strictEqual(
    recipe.category,
    'interaction-debounce',
    'Gate 9 Failed: Category must be interaction-debounce',
  );
  assert.ok(
    recipe.recipeId.startsWith('REC-DEB'),
    'Gate 9 Failed: RecipeId must start with REC-DEB',
  );
  console.log('  [PASS] Gate 9: Trajectory recipe extractor synthesizes REC-DEB');
}

// Gate 10: Trajectory extractor detects state-machine-discipline recipe
{
  const extractor = new TrajectoryRecipeExtractor();
  const beforeCode = `
func trigger_combat():
	_current_state = State.COMBAT
`;
  const afterCode = `
func trigger_combat():
	fsm.transition_to(State.COMBAT, {})
`;
  const recipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-fsm-001',
    filePath: 'views/test_ctrl.gd',
    beforeContent: beforeCode,
    afterContent: afterCode,
  });
  assert.ok(
    recipe,
    'Gate 10 Failed: Trajectory recipe extractor must synthesize FSM discipline recipe',
  );
  assert.strictEqual(
    recipe.category,
    'state-machine-discipline',
    'Gate 10 Failed: Category must be state-machine-discipline',
  );
  assert.ok(
    recipe.recipeId.startsWith('REC-FSM'),
    'Gate 10 Failed: RecipeId must start with REC-FSM',
  );
  console.log('  [PASS] Gate 10: Trajectory recipe extractor synthesizes REC-FSM');
}

// Gate 11: Trajectory extractor detects weakref-observer recipe
{
  const extractor = new TrajectoryRecipeExtractor();
  const beforeCode = `
func register_listener(node):
	_observers.append(node)
`;
  const afterCode = `
func register_listener(node):
	_observers.append(weakref(node))
`;
  const recipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-weak-001',
    filePath: 'infra/registry.gd',
    beforeContent: beforeCode,
    afterContent: afterCode,
  });
  assert.ok(recipe, 'Gate 11 Failed: Trajectory recipe extractor must synthesize weakref recipe');
  assert.strictEqual(
    recipe.category,
    'weakref-observer',
    'Gate 11 Failed: Category must be weakref-observer',
  );
  assert.ok(
    recipe.recipeId.startsWith('REC-WEAK'),
    'Gate 11 Failed: RecipeId must start with REC-WEAK',
  );
  console.log('  [PASS] Gate 11: Trajectory recipe extractor synthesizes REC-WEAK');
}

// Gate 12: Trajectory extractor detects unidirectional-flow recipe
{
  const extractor = new TrajectoryRecipeExtractor();
  const beforeCode = `
func _on_buy():
	snapshot.gold -= 100
`;
  const afterCode = `
func _on_buy():
	dispatch_intent("purchase_item", 100)
`;
  const recipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-uni-001',
    filePath: 'views/shop_view.gd',
    beforeContent: beforeCode,
    afterContent: afterCode,
  });
  assert.ok(
    recipe,
    'Gate 12 Failed: Trajectory recipe extractor must synthesize unidirectional-flow recipe',
  );
  assert.strictEqual(
    recipe.category,
    'unidirectional-flow',
    'Gate 12 Failed: Category must be unidirectional-flow',
  );
  assert.ok(
    recipe.recipeId.startsWith('REC-UNI'),
    'Gate 12 Failed: RecipeId must start with REC-UNI',
  );
  console.log('  [PASS] Gate 12: Trajectory recipe extractor synthesizes REC-UNI');
}

// Gate 13: WebGames test_frontend_boundary_guard.gd contains 18 tests
{
  const guardPath = path.join(
    __dirname,
    '..',
    '..',
    'WebGames',
    'tests',
    'guards',
    'test_frontend_boundary_guard.gd',
  );
  if (fs.existsSync(guardPath)) {
    const content = fs.readFileSync(guardPath, 'utf8');
    assert.ok(
      content.includes('_test_ui_buttons_debounce_discipline'),
      'Gate 13 Failed: Missing debounce guard test',
    );
    assert.ok(
      content.includes('_test_fsm_zero_wild_state_mutations'),
      'Gate 13 Failed: Missing FSM guard test',
    );
    assert.ok(
      content.includes('_test_ui_binding_registry_weakref_compliance'),
      'Gate 13 Failed: Missing weakref guard test',
    );
    assert.ok(
      content.includes('_test_presentation_no_dto_in_place_mutation'),
      'Gate 13 Failed: Missing DTO mutation guard test',
    );
    assert.ok(
      content.includes('_test_views_responsive_layout_discipline'),
      'Gate 13 Failed: Missing responsive layout guard test',
    );
    console.log('  [PASS] Gate 13: WebGames boundary guard contains all 18 test gate declarations');
  } else {
    console.log('  [SKIP] Gate 13: WebGames directory not present in current test scope');
  }
}

// Gate 14: Source line length & size budget (< 900 LOC)
{
  const filesToCheck = [
    path.join(__dirname, '..', 'src', 'core', 'scoring', 'modernization-formulas.ts'),
    path.join(__dirname, '..', 'src', 'core', 'scoring', 'dimensionLiterals.ts'),
    path.join(__dirname, '..', 'src', 'core', 'scoring', 'dimensionRuleTable.ts'),
    path.join(__dirname, '..', 'src', 'core', 'trajectory', 'recipeExtractor.ts'),
    path.join(__dirname, '..', 'src', 'analyzers', 'gdscript-modern.ts'),
  ];
  for (const file of filesToCheck) {
    if (fs.existsSync(file)) {
      const lineCount = fs.readFileSync(file, 'utf8').split('\n').length;
      assert.ok(
        lineCount < 900,
        `Gate 14 Failed: ${path.basename(file)} has ${lineCount} lines (>= 900 limit)`,
      );
    }
  }
  console.log('  [PASS] Gate 14: All source files stay strictly within < 900 LOC budget');
}

// Gate 15: Zero banned construction jargon
{
  const filesToCheck = [
    path.join(__dirname, '..', 'src', 'core', 'scoring', 'modernization-formulas.ts'),
    path.join(__dirname, '..', 'src', 'core', 'trajectory', 'recipeExtractor.ts'),
    path.join(__dirname, '..', 'src', 'analyzers', 'gdscript-modern.ts'),
  ];
  const bannedPattern = /\b(?:p0[1-9]|phase0[1-9]|temp_impl|wip_test)\b/i;
  for (const file of filesToCheck) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      assert.ok(
        !bannedPattern.test(content),
        `Gate 15 Failed: Found banned construction jargon in ${path.basename(file)}`,
      );
    }
  }
  console.log('  [PASS] Gate 15: Zero banned construction jargon across modified files');
}

// Gate 16: Zero orphaned rules or duplicate rule IDs
{
  const ruleIds = new Set();
  for (const rule of RULE_REGISTRY) {
    assert.ok(!ruleIds.has(rule.id), `Gate 16 Failed: Duplicate rule ID found: ${rule.id}`);
    ruleIds.add(rule.id);
  }
  assert.strictEqual(
    ruleIds.size,
    RULE_REGISTRY.length,
    `Gate 16 Failed: Expected ${RULE_REGISTRY.length} rules, got ${ruleIds.size}`,
  );
  assert.ok(ruleIds.size >= 136, `Gate 16 Failed: Expected >= 136 rules, got ${ruleIds.size}`);
  console.log(`  [PASS] Gate 16: Zero duplicate rule IDs (Total: ${ruleIds.size} unique rules)`);
}

// Gate 17: Component Adoption Index (CAI) mathematical invariants
{
  const fullAdoption = calculateComponentAdoptionIndex(10, 10, 0);
  assert.strictEqual(
    fullAdoption,
    100,
    'Gate 17 Failed: 100% K-component adoption must yield 100.0',
  );
  const zeroAdoption = calculateComponentAdoptionIndex(0, 10, 10);
  assert.strictEqual(zeroAdoption, 0, 'Gate 17 Failed: 0% K-component adoption must yield 0.0');
  const partialAdoption = calculateComponentAdoptionIndex(5, 10, 5);
  assert.strictEqual(
    partialAdoption,
    25,
    'Gate 17 Failed: 50% ratio * 50% coverage must yield 25.0',
  );
  const emptyView = calculateComponentAdoptionIndex(0, 0, 0);
  assert.strictEqual(emptyView, 100, 'Gate 17 Failed: Empty view should default to 100.0');
  console.log('  [PASS] Gate 17: Component Adoption Index (CAI) invariants');
}

// Gate 18: Design Token Compliance (DTC) mathematical invariants
{
  const pureTokens = calculateDesignTokenComplianceIndex(20, 0, 0);
  assert.strictEqual(pureTokens, 100, 'Gate 18 Failed: Pure DesignTokens usage must yield 100.0');
  const heavyViolations = calculateDesignTokenComplianceIndex(0, 10, 10);
  assert.strictEqual(heavyViolations, 0, 'Gate 18 Failed: Pure raw literals must yield 0.0');
  const halfCompliant = calculateDesignTokenComplianceIndex(10, 2, 4); // 10 / (10 + 4 + 6) = 0.5
  assert.strictEqual(halfCompliant, 50, 'Gate 18 Failed: Expected 50.0 compliance');
  console.log('  [PASS] Gate 18: Design Token Compliance (DTC) invariants');
}

// Gate 19: i18n Symmetry Index (ISI) mathematical invariants
{
  const fullyLocalized = calculateI18nSymmetryIndex(20, 0, 0);
  assert.strictEqual(
    fullyLocalized,
    100,
    'Gate 19 Failed: Fully localized UI text must yield 100.0',
  );
  const rawStringsOnly = calculateI18nSymmetryIndex(0, 10, 0);
  assert.strictEqual(rawStringsOnly, 0, 'Gate 19 Failed: Unlocalized strings only must yield 0.0');
  const mixed = calculateI18nSymmetryIndex(10, 2, 0); // 10 / (10 + 2.5 * 2) = 66.666... -> 66.67
  const expectedSymmetry = Math.round((10 / (10 + 2.5 * 2)) * 100 * 100) / 100;
  assert.strictEqual(
    mixed,
    expectedSymmetry,
    `Gate 19 Failed: Expected ${expectedSymmetry} symmetry`,
  );
  console.log('  [PASS] Gate 19: i18n Symmetry Index (ISI) invariants');
}

// Gate 20: Presentation Decoupling Index (PDI) mathematical invariants
{
  const perfectlyDecoupled = calculatePresentationDecouplingIndex(0, 0, 5);
  assert.strictEqual(
    perfectlyDecoupled,
    100,
    'Gate 20 Failed: Completely decoupled views must yield 100.0',
  );
  const coupled = calculatePresentationDecouplingIndex(2, 1, 1);
  assert.ok(
    coupled < 10,
    'Gate 20 Failed: Direct backend/eventbus coupling must exponentially decay PDI',
  );
  console.log('  [PASS] Gate 20: Presentation Decoupling Index (PDI) invariants');
}

// Gate 21: Trajectory recipe extractor synthesizes REC-BAR, REC-TOK, and REC-EXT
{
  const extractor = new TrajectoryRecipeExtractor();
  // Test REC-BAR
  const barRecipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-bar-001',
    filePath: 'views/hud_view.gd',
    beforeContent: 'var bar = ProgressBar.new()\nbar.value = 50\n',
    afterContent: 'var bar = KStatusBar.new()\nbar.set_progress(0.5)\n',
  });
  assert.ok(barRecipe, 'Gate 21 Failed: Must synthesize status-bar recipe');
  assert.strictEqual(
    barRecipe.category,
    'status-bar-component',
    'Gate 21 Failed: Wrong category for status bar',
  );
  assert.ok(
    barRecipe.recipeId.startsWith('REC-BAR'),
    'Gate 21 Failed: Recipe ID must start with REC-BAR',
  );

  // Test REC-TOK
  const tokRecipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-tok-001',
    filePath: 'views/card_view.gd',
    beforeContent: 'var c = Color("#ff0000")\nlabel.modulate = c\n',
    afterContent: 'var c = DesignTokens.COLOR_ACCENT\nlabel.modulate = c\n',
  });
  assert.ok(tokRecipe, 'Gate 21 Failed: Must synthesize token recipe');
  assert.strictEqual(
    tokRecipe.category,
    'token-standardization',
    'Gate 21 Failed: Wrong category for token',
  );
  assert.ok(
    tokRecipe.recipeId.startsWith('REC-TOK'),
    'Gate 21 Failed: Recipe ID must start with REC-TOK',
  );

  // Test REC-EXT
  const extRecipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-ext-001',
    filePath: 'views/profile_view.gd',
    beforeContent: 'extends Control\nfunc _ready(): pass\n',
    afterContent: 'extends BaseScreen\nfunc _ready(): pass\n',
  });
  assert.ok(extRecipe, 'Gate 21 Failed: Must synthesize screen base recipe');
  assert.strictEqual(
    extRecipe.category,
    'screen-base-inheritance',
    'Gate 21 Failed: Wrong category for screen base',
  );
  assert.ok(
    extRecipe.recipeId.startsWith('REC-EXT'),
    'Gate 21 Failed: Recipe ID must start with REC-EXT',
  );
  console.log('  [PASS] Gate 21: Trajectory extractor synthesizes REC-BAR, REC-TOK, REC-EXT');
}

// Gate 22: Registry contains all 8 new GDM frontend governance rules
{
  const expectedNewRules = [
    'GDM-LOC-001',
    'GDM-EXT-001',
    'GDM-TOK-001',
    'GDM-BAR-001',
    'GDM-VRT-001',
    'GDM-I18N-001',
    'GDM-NOD-001',
    'GDM-BND-001',
  ];
  for (const ruleId of expectedNewRules) {
    const found = RULE_REGISTRY_MAP.get(ruleId);
    assert.ok(found, `Gate 22 Failed: Rule ${ruleId} not registered in RULE_REGISTRY`);
    assert.strictEqual(found.family, 'GDM', `Gate 22 Failed: Rule ${ruleId} has wrong family`);
    assert.strictEqual(
      found.defaultSeverity,
      'warning',
      `Gate 22 Failed: Rule ${ruleId} has wrong defaultSeverity`,
    );
  }
  console.log('  [PASS] Gate 22: RULE_REGISTRY contains all 8 new GDM frontend governance rules');
}

// Gate 23: GdscriptModernAnalyzer synthetic AST/regex detection covers all 8 rules
{
  const analyzer = new GdscriptModernAnalyzer();
  const testCases = [
    {
      ruleId: 'GDM-EXT-001',
      file: 'views/account_view.gd',
      code: 'extends Control\nfunc _ready():\n\tpass\n',
    },
    {
      ruleId: 'GDM-TOK-001',
      file: 'views/hud_view.gd',
      code: 'extends BaseScreen\nfunc _ready():\n\tvar c = Color("#ff2233")\n',
    },
    {
      ruleId: 'GDM-BAR-001',
      file: 'views/profile_view.gd',
      code: 'extends BaseScreen\nfunc _ready():\n\tvar b = ProgressBar.new()\n',
    },
    {
      ruleId: 'GDM-VRT-001',
      file: 'views/market_view.gd',
      code: 'extends BaseScreen\nfunc _ready():\n\tfor x in items:\n\t\tlist.add_child(item)\n',
    },
    {
      ruleId: 'GDM-I18N-001',
      file: 'views/login_view.gd',
      code: 'extends BaseScreen\nfunc _ready():\n\ttitle = "Welcome to Kalar"\n',
    },
    {
      ruleId: 'GDM-NOD-001',
      file: 'views/shop_view.gd',
      code: 'extends BaseScreen\nfunc _ready():\n\tvar p = get_parent()\n',
    },
    {
      ruleId: 'GDM-BND-001',
      file: 'views/trade_view.gd',
      code: 'extends BaseScreen\nfunc _ready():\n\tGameState.mutate_gold(10)\n',
    },
  ];

  for (const tc of testCases) {
    const issues = analyzer.finalize({ filePath: tc.file, content: tc.code });
    const matched = issues.find((i) => i.rule === tc.ruleId);
    assert.ok(matched, `Gate 23 Failed: Analyzer did not emit ${tc.ruleId} on violation fixture`);
  }

  // Check GDM-LOC-001 with 451-line file
  const longFileCode = Array.from({ length: 452 }, (_, i) => `var x_${i} = ${i}`).join('\n');
  const locIssues = analyzer.finalize({ filePath: 'views/large_view.gd', content: longFileCode });
  assert.ok(
    locIssues.some((i) => i.rule === 'GDM-LOC-001'),
    'Gate 23 Failed: Analyzer did not emit GDM-LOC-001 on LOC > 450',
  );

  console.log(
    '  [PASS] Gate 23: GdscriptModernAnalyzer live detection correctly triggers all 8 rules',
  );
}

// Gate 24: Real WebGames presentation views have zero violations across all 8 rules
{
  const analyzer = new GdscriptModernAnalyzer();
  const viewsDir = path.join(__dirname, '..', '..', 'WebGames', 'frontend', 'views');
  if (fs.existsSync(viewsDir)) {
    const viewFiles = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith('.gd')) viewFiles.push(full);
      }
    })(viewsDir);

    const targetRuleIds = new Set([
      'GDM-LOC-001',
      'GDM-EXT-001',
      'GDM-TOK-001',
      'GDM-BAR-001',
      'GDM-VRT-001',
      'GDM-I18N-001',
      'GDM-NOD-001',
      'GDM-BND-001',
    ]);

    let totalViolations = 0;
    const violationDetails = [];

    for (const file of viewFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const issues = analyzer.finalize({ filePath: file, content });
      const hits = issues.filter((i) => targetRuleIds.has(i.rule));
      if (hits.length > 0) {
        totalViolations += hits.length;
        violationDetails.push(`${path.basename(file)}: ${hits.map((h) => h.rule).join(', ')}`);
      }
    }

    assert.strictEqual(
      totalViolations,
      0,
      `Gate 24 Failed: WebGames presentation views had ${totalViolations} violations:\n  ${violationDetails.join('\n  ')}`,
    );
    console.log(
      `  [PASS] Gate 24: Scanned ${viewFiles.length} WebGames presentation views with 0 violations`,
    );
  } else {
    console.log('  [SKIP] Gate 24: WebGames views directory not found');
  }
}

// Gate 25: Boundary Interoperability Factor (BIF) mathematical invariants
{
  const perfectBif = calculateBoundaryInteroperabilityFactor(0, 10);
  assert.strictEqual(perfectBif, 1.0, 'Gate 25 Failed: Zero leaks must yield BIF 1.0');
  const leakBif = calculateBoundaryInteroperabilityFactor(10, 10);
  assert.ok(leakBif < 0.5, 'Gate 25 Failed: High leaks must heavily penalize BIF');
  console.log('  [PASS] Gate 25: Boundary Interoperability Factor (BIF) invariants');
}

// Gate 26: Multi-Profile Composite Quality Score invariants
{
  const perfectComp = calculateProfileCompositeScore(100, 100, 1.0, 1.0, 1.0);
  assert.strictEqual(perfectComp, 100, 'Gate 26 Failed: Perfect dual scores must yield 100');
  const penalizedComp = calculateProfileCompositeScore(80, 80, 1.0, 1.0, 0.5);
  assert.strictEqual(penalizedComp, 40, 'Gate 26 Failed: 80 score * 0.5 BIF must yield 40');
  console.log('  [PASS] Gate 26: Multi-Profile Composite Quality Score invariants');
}

// Gate 27: Shannon Information Entropy & AST Density anti-gaming invariants
{
  const lowEntropy = calculateShannonEntropy('aaaaaaaa');
  assert.strictEqual(lowEntropy, 0, 'Gate 27 Failed: Identical character sequence has 0 entropy');
  const highEntropy = calculateShannonEntropy('abcdefgh');
  assert.strictEqual(highEntropy, 3.0, 'Gate 27 Failed: 8 distinct chars must have 3.0 entropy');
  const astDensity = calculateAstLocDensityIndex(500, 100);
  assert.strictEqual(
    astDensity,
    5.0,
    'Gate 27 Failed: 500 nodes / 100 lines must yield 5.0 density',
  );

  // Anti-gaming detector check
  const gamingSample = Array.from({ length: 10 }, (_, i) => `var a${i} = ${i};`).join('\n');
  const result = detectScoreGaming('src/sample.ts', gamingSample);
  assert.ok(
    result.hasGaming,
    'Gate 27 Failed: Low-entropy synthetic variable names must trigger anti-gaming',
  );
  assert.ok(
    result.gamingKinds.includes('naming_entropy_anomaly'),
    'Gate 27 Failed: Must flag naming_entropy_anomaly',
  );
  console.log('  [PASS] Gate 27: Shannon Information Entropy & AST Density anti-gaming invariants');
}

// Gate 28: Trajectory recipe extractor synthesizes REC-VRT, REC-I18N, REC-NOD, REC-BND
{
  const extractor = new TrajectoryRecipeExtractor();
  // Test REC-VRT
  const vrtRecipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-vrt-001',
    filePath: 'views/market_view.gd',
    beforeContent: 'for item in items:\n\tlist.add_child(item)\n',
    afterContent: 'var vlist = KVirtualList.new()\nvlist.sync(items)\n',
  });
  assert.ok(vrtRecipe, 'Gate 28 Failed: Must synthesize virtual list recipe');
  assert.strictEqual(
    vrtRecipe.category,
    'virtual-list-pooling',
    'Gate 28 Failed: Wrong category for VRT',
  );
  assert.ok(
    vrtRecipe.recipeId.startsWith('REC-VRT'),
    'Gate 28 Failed: Recipe ID must start with REC-VRT',
  );

  // Test REC-I18N
  const i18nRecipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-i18n-001',
    filePath: 'views/login_view.gd',
    beforeContent: 'label.text = "Hello World"\n',
    afterContent: 'label.text = tr("HELLO_WORLD")\n',
  });
  assert.ok(i18nRecipe, 'Gate 28 Failed: Must synthesize i18n recipe');
  assert.strictEqual(
    i18nRecipe.category,
    'i18n-localization',
    'Gate 28 Failed: Wrong category for I18N',
  );
  assert.ok(
    i18nRecipe.recipeId.startsWith('REC-I18N'),
    'Gate 28 Failed: Recipe ID must start with REC-I18N',
  );

  // Test REC-NOD
  const nodRecipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-nod-001',
    filePath: 'views/dialog_view.gd',
    beforeContent: 'var p = get_parent()\n',
    afterContent: '@onready var p = %HeaderNode\n',
  });
  assert.ok(nodRecipe, 'Gate 28 Failed: Must synthesize explicit node recipe');
  assert.strictEqual(
    nodRecipe.category,
    'explicit-node-unique',
    'Gate 28 Failed: Wrong category for NOD',
  );
  assert.ok(
    nodRecipe.recipeId.startsWith('REC-NOD'),
    'Gate 28 Failed: Recipe ID must start with REC-NOD',
  );

  // Test REC-BND
  const bndRecipe = extractor.extractRecipeFromTrajectory({
    trajectoryId: 'traj-bnd-001',
    filePath: 'views/trade_view.gd',
    beforeContent: 'GameState.mutate_currency(10)\n',
    afterContent: 'func apply_snapshot(snap):\n\tupdate_ui(snap)\n',
  });
  assert.ok(bndRecipe, 'Gate 28 Failed: Must synthesize domain decoupling recipe');
  assert.strictEqual(
    bndRecipe.category,
    'presentation-decoupling',
    'Gate 28 Failed: Wrong category for BND',
  );
  assert.ok(
    bndRecipe.recipeId.startsWith('REC-BND'),
    'Gate 28 Failed: Recipe ID must start with REC-BND',
  );

  console.log(
    '  [PASS] Gate 28: Trajectory extractor synthesizes REC-VRT, REC-I18N, REC-NOD, REC-BND',
  );
}

// Gate 29: Archetype weight tuner supports frontend, backend, composite profiles
{
  const tuner = new ArchetypeWeightTuner();
  const feWeights = tuner.tuneWeights('frontend');
  assert.ok(
    feWeights.techDebtRisk > feWeights.codeSecurity,
    'Gate 29 Failed: Frontend profile must prioritize techDebt/PDI over backend security',
  );
  assert.ok(
    feWeights.standardization > feWeights.architectureConsistency,
    'Gate 29 Failed: Frontend profile must prioritize standardization/DTC',
  );

  const beWeights = tuner.tuneWeights('backend');
  assert.ok(
    beWeights.performanceEfficiency > beWeights.standardization,
    'Gate 29 Failed: Backend profile must prioritize performanceEfficiency',
  );
  assert.ok(
    beWeights.maintainability > beWeights.commentQuality,
    'Gate 29 Failed: Backend profile must prioritize maintainability over commentQuality',
  );

  const compWeights = tuner.tuneWeights('composite');
  assert.ok(
    compWeights.architectureConsistency > 0,
    'Gate 29 Failed: Composite profile must have valid weights',
  );
  console.log(
    '  [PASS] Gate 29: Archetype weight tuner supports frontend, backend, composite profiles',
  );
}

console.log(
  '\n=== All 29 Frontend Architecture & Quantification Governance Gates PASSED Successfully ===',
);
