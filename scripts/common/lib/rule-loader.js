/**
 * Module: Common Rule Catalog Loader & O(1) Indexer
 * File Path: scripts/common/lib/rule-loader.js
 * Architecture Role: Shared utility providing cached singleton access and O(1) indexed lookups
 *   into the single-source-of-truth (SSOT) workspace rule catalog.
 * Dependencies & Triggers: Consumes scripts/common/rule-catalog.json; imported by gate guards and
 *   validation scripts across the workspace.
 * Responsibilities:
 *   1. Load and parse rule-catalog.json with memory-cached singleton semantics;
 *   2. Build fast lookup maps by rule ID, by family prefix, and by project;
 *   3. Expose zero-allocation query helpers (hasRule, getRule, getRulesByProject);
 *   4. Fail closed with descriptive error diagnostics if the catalog is corrupt or unreadable.
 * Exit Semantics & Design Rationale: Pure library module without process exit side effects,
 *   throwing Error if the catalog is missing or unparseable.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.resolve(__dirname, '../rule-catalog.json');

/** @type {object|null} */
let cachedCatalog = null;
/** @type {Map<string, object>|null} */
let ruleIdMap = null;
/** @type {Map<string, object[]>|null} */
let rulesByProjectMap = null;
/** @type {Map<string, object[]>|null} */
let rulesByFamilyMap = null;

/**
 * Loads and returns the raw rule catalog object, caching on first read.
 *
 * @returns {object} The parsed rule catalog object.
 * @throws {Error} If rule-catalog.json cannot be read or parsed.
 */
function loadRuleCatalog() {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`SSOT rule catalog file not found: ${CATALOG_PATH}`);
  }

  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    cachedCatalog = Object.freeze(JSON.parse(raw));
    return cachedCatalog;
  } catch (err) {
    throw new Error(`Failed to read/parse rule-catalog.json: ${err.message}`);
  }
}

/**
 * Initializes the indexed lookup maps if not already built.
 */
function ensureIndexes() {
  if (ruleIdMap) {
    return;
  }

  const catalog = loadRuleCatalog();
  const rules = Array.isArray(catalog.rules) ? catalog.rules : [];

  ruleIdMap = new Map();
  rulesByProjectMap = new Map();
  rulesByFamilyMap = new Map();

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule || !rule.id) {
      continue;
    }

    ruleIdMap.set(rule.id, rule);

    const project = rule.project || 'unknown';
    let projectList = rulesByProjectMap.get(project);
    if (!projectList) {
      projectList = [];
      rulesByProjectMap.set(project, projectList);
    }
    projectList.push(rule);

    const family = rule.family || (rule.id.split('-')[0] || 'unknown');
    let familyList = rulesByFamilyMap.get(family);
    if (!familyList) {
      familyList = [];
      rulesByFamilyMap.set(family, familyList);
    }
    familyList.push(rule);
  }
}

/**
 * Returns an O(1) Map of rule ID to Rule entry.
 *
 * @returns {Map<string, object>}
 */
function getRuleMap() {
  ensureIndexes();
  return ruleIdMap;
}

/**
 * Checks if a given rule ID exists in the SSOT catalog.
 *
 * @param {string} ruleId
 * @returns {boolean}
 */
function hasRule(ruleId) {
  if (!ruleId || typeof ruleId !== 'string') {
    return false;
  }
  ensureIndexes();
  return ruleIdMap.has(ruleId);
}

/**
 * Gets the rule metadata for a given rule ID.
 *
 * @param {string} ruleId
 * @returns {object|undefined}
 */
function getRule(ruleId) {
  if (!ruleId || typeof ruleId !== 'string') {
    return undefined;
  }
  ensureIndexes();
  return ruleIdMap.get(ruleId);
}

/**
 * Gets all rules belonging to a specified project.
 *
 * @param {string} project
 * @returns {readonly object[]}
 */
function getRulesByProject(project) {
  ensureIndexes();
  return rulesByProjectMap.get(project) || [];
}

/**
 * Gets all rules belonging to a specified family prefix.
 *
 * @param {string} family
 * @returns {readonly object[]}
 */
function getRulesByFamily(family) {
  ensureIndexes();
  return rulesByFamilyMap.get(family) || [];
}

module.exports = {
  loadRuleCatalog,
  getRuleMap,
  hasRule,
  getRule,
  getRulesByProject,
  getRulesByFamily,
};
