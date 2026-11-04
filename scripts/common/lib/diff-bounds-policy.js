/**
 * Module: Governance Guard — Staged Differential Boundary Policy
 * File Path: scripts/common/lib/diff-bounds-policy.js
 * Architecture Role: Single source of truth for every staged-differential boundary used by
 *   `STAGED-DIFF-14`. Each boundary carries a floor, a target band and a ceiling rather than one
 *   bare red line, so "too thin to review" and "too large to review" are both expressible.
 * Dependencies & Triggers: Pure data plus pure predicates; consumed by gate-differential-bounds.js,
 *   diff-exemption-ledger.js, and the gate self-tests.
 * Responsibilities:
 *   1. Declare the per-file and per-batch envelopes in one place with the rule that owns each.
 *   2. Classify a volume against its envelope: BELOW_FLOOR, IN_BAND, ABOVE_CEILING.
 *   3. Classify a ratio against its two-sided band: FLOOR_BREACH, TARGET_DEFICIT, IN_BAND.
 *   4. Declare the exemption parameters so the gate and its ledger cannot disagree.
 * Exit Semantics & Design Rationale: Total functions, no I/O, no exceptions. Bands are expressed as
 *   data so a reviewer can read the accepted range without reverse-engineering conditionals, and so
 *   the self-test can assert the gate honours exactly these numbers. A ratio band is read from
 *   below twice: the floor is the point of invalid content and the target is the point of accepted
 *   density, which is why a shortfall between them is the only shortfall an exemption may address.
 */
'use strict';

/** Rule identifiers owned by global tooling; one per boundary family. */
const RULE_BOUND = 'GAT-BOUND-001';
const RULE_DENS = 'GAT-DENS-001';
const RULE_BATCH = 'GAT-BATCH-001';
const RULE_EXEMPTION = 'GAT-EXMP-001';
const RULE_STREAK = 'GAT-STREAK-001';

/** Band position of a measured volume relative to its declared envelope. */
const BAND_BELOW_FLOOR = 'below-floor';
const BAND_IN_BAND = 'in-band';
const BAND_ABOVE_CEILING = 'above-ceiling';

/** Band position of a measured ratio relative to its floor and target. */
const DENSITY_FLOOR_BREACH = 'floor-breach';
const DENSITY_TARGET_DEFICIT = 'target-deficit';
const DENSITY_IN_BAND = 'in-band';

/** Single-file add envelope in 5D ELOC: a new file, an edit, and a refactor each get their own ceiling. */
const FILE_ADD_BANDS = Object.freeze({
    newFile: Object.freeze({ floor: 0, target: 180, ceiling: 360, rule: RULE_BOUND }),
    existingFile: Object.freeze({ floor: 0, target: 60, ceiling: 120, rule: RULE_BOUND }),
    refactorWitness: Object.freeze({ floor: 0, target: 90, ceiling: 180, rule: RULE_BOUND }),
});

/** Single-file delete envelope in 5D ELOC; the ceiling widens when a refactor witness exists. */
const FILE_DEL_BANDS = Object.freeze({
    plain: Object.freeze({ floor: 0, target: 50, ceiling: 100, rule: RULE_BOUND }),
    witnessed: Object.freeze({ floor: 0, target: 140, ceiling: 280, rule: RULE_BOUND }),
});

/** Deleted 5D ELOC above which an existing file is treated as a refactor rather than an edit. */
const REFACTOR_WITNESS_MIN_DEL_ELOC = 10;

/**
 * Substantive density band for added lines.
 *
 * Read from below. The floor rejects a commit that is mostly prose; the target marks the point below
 * which density is judged too thin to review unaided. The target is deliberately not 1.0: a module
 * whose mandatory header, per-function docstrings and decision comments are honest still spends a
 * third of its lines on explanation, and demanding otherwise would price the explanation at zero.
 */
const SUBSTANTIVE_RATIO_BAND = Object.freeze({
    floor: 0.45,
    target: 0.6,
    hardCeiling: 0.85,
    rule: RULE_DENS,
});

/** Payload ratio band over the same physical lines, so a file cannot clear one band by failing the other. */
const TSPR_BAND = Object.freeze({
    floor: 0.3,
    target: 0.4,
    hardCeiling: 0.75,
    rule: RULE_DENS,
});

/**
 * Minimum added physical lines before density is measured at all.
 *
 * Below this width a ratio is dominated by its denominator: a ten-line addition with two comments
 * swings the ratio by five points per line, so judging it would reward padding rather than quality.
 */
const DENSITY_MIN_PHYS_ADD = 10;

/** Commit batch macro envelope in 5D ELOC, plus the empirical turnover bounds. */
const BATCH_BANDS = Object.freeze({
    add: Object.freeze({ floor: 0, target: 240, ceiling: 360, rule: RULE_BATCH }),
    del: Object.freeze({ floor: 0, target: 140, ceiling: 280, rule: RULE_BATCH }),
    turnoverFloor: 3.0,
    turnoverCap: 25.0,
});

/**
 * Point above which the payload ratio vouches for the density band.
 *
 * The two ratios answer different questions over the same lines: the substantive ratio asks "how much
 * of this diff is not prose", the payload ratio asks "of what is not prose, how much carries meaning".
 * A file at 98% payload has no trampolines and no stubs — its non-code lines are headers and decision
 * comments, not filler. Once the payload ratio is that high the thin-density reading is answered by
 * construction, so the substantive target stops blocking and the floor still applies. Without this,
 * the two bands double-penalise the same file for the same lines, and the only way out is deleting
 * the explanation that made the code reviewable.
 */
const TSPR_VOUCH_FOR_DENSITY = 0.85;

/**
 * Exemption parameters.
 *
 * `maxDrop` bounds how far a grant may move the target line; `minStreak` is how many consecutive
 * blocks the same identifier must accumulate first. Grants are scoped to one identifier and one
 * violation type for the life of the repository, and at most `maxPerBatch` may be granted per commit.
 */
const EXEMPTION_POLICY = Object.freeze({
    minStreak: 3,
    maxDrop: 0.15,
    maxPerBatch: 1,
    maxNewFilePhysAdd: 60,
    maxStreakBeforeAck: 5,
    rule: RULE_EXEMPTION,
});

/** Violation types that may never be exempted: each is answered by changing the commit, not a threshold. */
const NON_EXEMPTIBLE = Object.freeze([
    'BATCH_ADD_OVERFLOW',
    'BATCH_DEL_OVERFLOW',
    'CAPABILITY_EROSION',
    'SUBSTANTIVE_FLOOR_BREACH',
    'TSPR_FLOOR_BREACH',
    'TRAMPOLINE_VIOLATION',
]);

/**
 * Classifies a measured volume against an envelope.
 *
 * A band with no declared ceiling is read from below only, which is how a pure deletion envelope
 * expresses that removing dead code has no upper bound worth policing.
 *
 * @param value - Measured quantity.
 * @param band - Band descriptor carrying `ceiling` and an optional `floor`.
 * @returns One of BAND_BELOW_FLOOR, BAND_IN_BAND, BAND_ABOVE_CEILING.
 */
function classifyBand(value, band) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return BAND_BELOW_FLOOR;
    if (typeof band.floor === 'number' && value < band.floor) return BAND_BELOW_FLOOR;
    if (typeof band.ceiling === 'number' && value > band.ceiling) return BAND_ABOVE_CEILING;
    return BAND_IN_BAND;
}

/**
 * Classifies a measured ratio against its floor and target.
 *
 * The two thresholds are distinct on purpose: a floor breach states the content is invalid, while a
 * target deficit states the content is valid but too thin to review. Only the second is a matter of
 * judgement, so only the second can ever be granted an exemption.
 *
 * @param value - Measured ratio in [0, 1].
 * @param band - Density band descriptor carrying `floor` and `target`.
 * @returns One of DENSITY_FLOOR_BREACH, DENSITY_TARGET_DEFICIT, DENSITY_IN_BAND.
 */
function classifyDensity(value, band) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DENSITY_FLOOR_BREACH;
    if (value < band.floor) return DENSITY_FLOOR_BREACH;
    if (value < band.target) return DENSITY_TARGET_DEFICIT;
    return DENSITY_IN_BAND;
}

/**
 * Reports whether a violation type may be exempted at all.
 *
 * @param violationType - Violation discriminator emitted by the gate.
 * @returns True when the type is structural and therefore never exempt.
 */
function isNonExemptible(violationType) {
    return NON_EXEMPTIBLE.includes(violationType);
}

/**
 * Lists every band declaration together with a stable name, so callers can enumerate the accepted
 * ranges without importing each constant by name.
 *
 * @returns Frozen array of `{ name, band }` entries.
 */
function listBands() {
    return Object.freeze([
        { name: 'fileAdd.newFile', band: FILE_ADD_BANDS.newFile },
        { name: 'fileAdd.existingFile', band: FILE_ADD_BANDS.existingFile },
        { name: 'fileAdd.refactorWitness', band: FILE_ADD_BANDS.refactorWitness },
        { name: 'fileDel.plain', band: FILE_DEL_BANDS.plain },
        { name: 'fileDel.witnessed', band: FILE_DEL_BANDS.witnessed },
        { name: 'batch.add', band: BATCH_BANDS.add },
        { name: 'batch.del', band: BATCH_BANDS.del },
        { name: 'substantiveRatio', band: SUBSTANTIVE_RATIO_BAND },
        { name: 'tspr', band: TSPR_BAND },
    ]);
}

/**
 * Validates that every declared band is internally coherent.
 *
 * A band whose target sits below its floor would classify every acceptable measurement as a `target
 * deficit`, and a ceiling below its target would block the very band it describes. Both mistakes are
 * invisible when the numbers are read one at a time, so they are asserted over the whole table.
 *
 * @returns List of incoherence descriptions; empty when every band is coherent.
 */
function findBandIncoherence() {
    const problems = [];
    for (const { name, band } of listBands()) {
        if (typeof band.floor === 'number' && typeof band.target === 'number' && band.target < band.floor) {
            problems.push(`${name}: target ${band.target} sits below floor ${band.floor}`);
        }
        if (typeof band.target === 'number' && typeof band.ceiling === 'number' && band.ceiling < band.target) {
            problems.push(`${name}: ceiling ${band.ceiling} sits below target ${band.target}`);
        }
    }
    if (EXEMPTION_POLICY.maxDrop <= 0) problems.push('exemption: maxDrop must be positive');
    if (EXEMPTION_POLICY.maxPerBatch < 1) problems.push('exemption: maxPerBatch must admit a grant');
    return problems;
}

/**
 * Renders the accepted range of one band for a human reader.
 *
 * @param band - Band descriptor.
 * @returns One-line description of the floor, target and ceiling in force.
 */
function describeBand(band) {
    const parts = [];
    if (typeof band.floor === 'number') parts.push(`floor ${band.floor}`);
    if (typeof band.target === 'number') parts.push(`target ${band.target}`);
    if (typeof band.ceiling === 'number') parts.push(`ceiling ${band.ceiling}`);
    return parts.join(' / ');
}

/** Exported rule identifiers, so the gate never spells them as literals. */
const DIFF_RULES = Object.freeze({
    bound: RULE_BOUND,
    density: RULE_DENS,
    batch: RULE_BATCH,
    exemption: RULE_EXEMPTION,
    streak: RULE_STREAK,
});

module.exports = {
    DIFF_RULES,
    FILE_ADD_BANDS,
    FILE_DEL_BANDS,
    REFACTOR_WITNESS_MIN_DEL_ELOC,
    SUBSTANTIVE_RATIO_BAND,
    TSPR_BAND,
    BATCH_BANDS,
    EXEMPTION_POLICY,
    DENSITY_MIN_PHYS_ADD,
    TSPR_VOUCH_FOR_DENSITY,
    NON_EXEMPTIBLE,
    BAND_BELOW_FLOOR,
    BAND_IN_BAND,
    BAND_ABOVE_CEILING,
    DENSITY_FLOOR_BREACH,
    DENSITY_TARGET_DEFICIT,
    DENSITY_IN_BAND,
    classifyBand,
    classifyDensity,
    isNonExemptible,
    listBands,
    findBandIncoherence,
    describeBand,
};
