/**
 * Suite: Structured Resource Topology & Scale-Adaptive Governance Test Suite
 * Path: scripts/validate-structured-resource-topology.js
 * Invariants Tested:
 *   1. Snapshot Invariance (d(ELOC_core)/d(ELOC(r)) | R_t == 0)
 *   2. Semantic Volume anti-packing defense (ELOC compression captured by SV)
 *   3. Inverted caller index O(|E_s|) sparse graph generation
 *   4. Multi-modal cohesion formula weights and bounding
 *   5. Tarjan SCC cycle decomposition & 6 resolution strategies
 *   6. Bayesian language density prior update (EMA decay)
 *   7. 3-tier structured resource naming parsing and bounding
 *   8. Tripartite risk separation (Confidence, Severity, Impact)
 *   9. Full audit runner with adversarial test cases
 */
const assert = require('node:assert');
const {
  parseStructuredResourceNaming,
  calculateSnapshotCoreELOC,
  calculateOmnibusCapacityThreshold,
  calculateSemanticVolume,
  buildSparseCallerGraph,
  calculateMultiModalCohesion,
  diagnoseSccDependencyCycles,
  updateLanguageDensityPrior,
  calculateTripartiteRisk,
  auditStructuredResourceTopology,
} = require('../dist/core/architecture/structured-resource-topology');

console.log('=== Running Structured Resource Topology & Scale Invariant Test Suite ===');

// 1. Snapshot Invariance Test
{
  const fileBaseline = [
    { path: 'src/biz/service.ts', eloc: 500, isResource: false },
    { path: 'src/biz/controller.ts', eloc: 300, isResource: false },
    { path: 'src/const/constants.ts', eloc: 200, isResource: true },
  ];
  const frozenResources = new Set(['src/const/constants.ts']);
  const baselineCore = calculateSnapshotCoreELOC(fileBaseline, frozenResources);
  assert.strictEqual(baselineCore, 800, 'Baseline core ELOC must exclude frozen resource');

  // Add 10,000 lines of stuffed constants to the resource file
  const stuffedFiles = [
    { path: 'src/biz/service.ts', eloc: 500, isResource: false },
    { path: 'src/biz/controller.ts', eloc: 300, isResource: false },
    { path: 'src/const/constants.ts', eloc: 10200, isResource: true },
  ];
  const stuffedCore = calculateSnapshotCoreELOC(stuffedFiles, frozenResources);
  assert.strictEqual(
    stuffedCore,
    800,
    'Snapshot core ELOC must remain invariant under resource stuffing',
  );
  console.log(
    '  [PASS] Invariant 1: Snapshot-Conditioned Invariance (d(ELOC_core)/d(ELOC(r)) == 0)',
  );
}

// 2. Semantic Volume (SV) Anti-Packing Test
{
  // Normal formatting: 100 ELOC, 300 AST nodes, 50 symbols, 150 literals, depth 4
  const svNormal = calculateSemanticVolume(100, 300, 50, 150, 4);
  // Line-packed version: 10 ELOC (compressed), but identical AST nodes, symbols, literals, depth
  const svPacked = calculateSemanticVolume(10, 300, 50, 150, 4);

  assert.ok(
    svPacked > 100,
    `Packed SV must stay substantial (got ${svPacked}) despite compressed ELOC`,
  );
  assert.strictEqual(
    Math.round(svNormal - svPacked),
    23,
    'Difference should only reflect ELOC delta (0.25 * 90 = 22.5)',
  );
  console.log('  [PASS] Invariant 2: Semantic Volume (SV) Anti-Line-Packing Defense');
}

// 3. Inverted Caller Index & Sparse Graph Test
{
  const callers = [
    { callerPath: 'src/a.ts', importedSymbols: ['HTTP_OK', 'HTTP_NOT_FOUND', 'TIMEOUT'] },
    { callerPath: 'src/b.ts', importedSymbols: ['HTTP_OK', 'HTTP_FORBIDDEN'] },
    { callerPath: 'src/c.ts', importedSymbols: ['DB_TIMEOUT', 'DB_CONN'] },
  ];
  const { invertedIndex, sparseEdges } = buildSparseCallerGraph(callers);

  assert.deepStrictEqual(invertedIndex.get('HTTP_OK'), ['src/a.ts', 'src/b.ts']);
  assert.deepStrictEqual(invertedIndex.get('DB_CONN'), ['src/c.ts']);
  assert.ok(sparseEdges.length > 0, 'Sparse edges must be generated');
  console.log('  [PASS] Invariant 3: Inverted Caller Index O(|E_s|) Sparse Graph');
}

// 4. Multi-modal Cohesion Formula Test
{
  const highCohesion = calculateMultiModalCohesion(0.8, 0.9, 0.85, 0.95, 0.7);
  const lowCohesion = calculateMultiModalCohesion(0.1, 0.1, 0.05, 0.2, 0.1);

  assert.ok(highCohesion >= 0.85, `High cohesion must score >= 0.85 (got ${highCohesion})`);
  assert.ok(lowCohesion <= 0.2, `Low cohesion must score <= 0.20 (got ${lowCohesion})`);
  console.log('  [PASS] Invariant 4: Multi-modal Cohesion Metric');
}

// 5. Tarjan SCC Cycle Decomposition & 6-Strategy Diagnosis Test
{
  const adjList = new Map([
    ['constants_net', ['constants_auth']],
    ['constants_auth', ['constants_net']], // Net and Auth form a cycle
    ['constants_db', []],
  ]);
  const nodeTypes = new Map([
    ['constants_net', 'pure-type'],
    ['constants_auth', 'pure-type'],
    ['constants_db', 'pure-type'],
  ]);

  const diagnosis = diagnoseSccDependencyCycles(adjList, nodeTypes);
  assert.strictEqual(diagnosis.stronglyConnectedComponents.length, 2, 'Must find 2 SCC components');
  assert.strictEqual(diagnosis.cyclicComponents.length, 1, 'Must detect 1 cyclic component');
  assert.strictEqual(diagnosis.cyclicComponents[0].strategy, 'TYPE_SINKING');
  console.log('  [PASS] Invariant 5: Tarjan SCC Dependency Cycle Decomposition');
}

// 6. Bayesian Language Density Prior Update Test
{
  const initialPrior = 1.0;
  const sampleCppDensity = 2.4;
  const updated = updateLanguageDensityPrior(initialPrior, sampleCppDensity, 0.1);
  assert.strictEqual(updated, 1.14, 'Prior must update smoothly via EMA: 0.9*1.0 + 0.1*2.4 = 1.14');
  console.log('  [PASS] Invariant 6: Bayesian Language Density Prior EMA Update');
}

// 7. 3-Tier Structured Resource Naming Parsing Test
{
  const p1 = parseStructuredResourceNaming('constants.ts');
  assert.strictEqual(p1.baseType, 'constants');
  assert.strictEqual(p1.depth, 1);
  assert.strictEqual(p1.domain, null);

  const p2 = parseStructuredResourceNaming('constants_network.ts');
  assert.strictEqual(p2.baseType, 'constants');
  assert.strictEqual(p2.domain, 'network');
  assert.strictEqual(p2.depth, 2);

  const p3 = parseStructuredResourceNaming('constants_network_http.ts');
  assert.strictEqual(p3.baseType, 'constants');
  assert.strictEqual(p3.domain, 'network');
  assert.strictEqual(p3.subdomain, 'http');
  assert.strictEqual(p3.depth, 3);

  const p4 = parseStructuredResourceNaming(
    'constants_network_http_request_response_status_code.ts',
  );
  assert.strictEqual(p4.isOverDescriptive, true);
  assert.ok(p4.extraParts.length > 0);
  console.log('  [PASS] Invariant 7: 3-Tier Naming Hierarchy & Token Depth Parser');
}

// 8. Tripartite Risk Separation Test
{
  const riskHigh = calculateTripartiteRisk(0.9, 0.8, 0.7);
  const riskLow = calculateTripartiteRisk(0.3, 0.2, 0.1);
  assert.ok(riskHigh.risk > riskLow.risk, 'High risk must exceed low risk');
  console.log('  [PASS] Invariant 8: Tripartite Orthogonal Risk Separation');
}

// 9. Full Audit Runner & Adversarial Findings Test
{
  const testFiles = [
    {
      filePath: 'src/constants.ts',
      eloc: 800, // Excessive ELOC for generic tier-1
      astNodeCount: 2000,
      symbolCount: 120,
      literalCount: 500,
      astDepth: 4,
      language: 'typescript',
      isExecutableLogic: false,
    },
    {
      filePath: 'src/constants_net_http.ts',
      eloc: 4, // Over-specialized micro file
      astNodeCount: 10,
      symbolCount: 2,
      literalCount: 4,
      astDepth: 2,
      language: 'typescript',
      isExecutableLogic: false,
    },
    {
      filePath: 'src/constants_net_http_request_response_headers_status_list.ts',
      eloc: 50,
      astNodeCount: 150,
      symbolCount: 10,
      literalCount: 30,
      astDepth: 3,
      language: 'typescript',
      isExecutableLogic: false,
    },
    {
      filePath: 'src/rules_auth.ts',
      eloc: 60,
      astNodeCount: 200,
      symbolCount: 15,
      literalCount: 40,
      astDepth: 3,
      language: 'typescript',
      isExecutableLogic: true, // Trojan executable logic in resource file
    },
  ];

  const findings = auditStructuredResourceTopology(testFiles, 1000);
  const ruleIds = new Set(findings.map((f) => f.ruleId));

  assert.ok(ruleIds.has('NAM-RES-001'), 'Must emit NAM-RES-001 for omnibus constants sprawl');
  assert.ok(ruleIds.has('NAM-RES-002'), 'Must emit NAM-RES-002 for micro-fragmentation');
  assert.ok(
    ruleIds.has('NAM-RES-003') || ruleIds.has('NAM-RES-004'),
    'Must emit depth/over-descriptive findings',
  );
  assert.ok(
    ruleIds.has('NAM-RES-005'),
    'Must emit NAM-RES-005 for executable logic in resource file',
  );

  console.log(
    '  [PASS] Invariant 9: Full Structured Resource Topology Adversarial Audit (4 findings detected)',
  );
}

console.log('=== ALL 9 STRUCTURED RESOURCE TOPOLOGY INVARIANTS VERIFIED SUCCESSFULLY! ===');
