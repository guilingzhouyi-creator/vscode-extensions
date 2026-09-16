/**
 * Module: Core Engine — Cross-Version Change Trajectory & Anomaly Detection Messages
 * File Path: src/core/messages/trajectory.ts
 * Architecture Role: Formatter catalog applied at report-assembly time; converts computed diff
 *   facts into the English anomaly, label and summary lines of a revision comparison
 * Dependencies & Triggers: Imports nothing, is re-exported by src/core/messages/index.ts, and is
 *   consumed by src/core/trajectory/anomalyDetector.ts whenever a current revision is compared
 *   with historical revisions from version diffs or agent runs
 * Responsibilities: Format logical rollback, composite and per-dimension quality regression, style
 *   drift, reintroduced issue and recurring conflicting-modification anomalies; expose the new and
 *   resolved issue labels plus rollback/improved/regressed summary lines
 * Exit Semantics & Design Rationale: Pure synchronous formatters frozen with `as const`; each
 *   string derives only from its arguments, so trajectory output is deterministic and
 *   snapshot-friendly while callers remain responsible for semantically valid identifiers
 */

/**
 * Frozen catalog of formatters and labels for cross-revision trajectory reports.
 *
 * Each formatter receives already-computed diff or anomaly facts and returns one
 * deterministic English line; the labels describe issue-state transitions. Callers remain
 * responsible for supplying semantically valid revision, agent and dimension identifiers.
 */
export const TrajectoryMessages = {
    /**
     * Announce a logical rollback: the current revision is semantically identical to an
     * earlier one.
     *
     * @param revisionId - Identifier of the historical revision whose content was restored.
     * @param agentUid - Identifier of the agent whose change reproduced that content.
     * @returns A summary line naming both the restored revision and the responsible agent.
     */
    LOGICAL_ROLLBACK: (revisionId: string, agentUid: string) =>
        `Code content is semantically identical to past revision ${revisionId} (Agent: ${agentUid}); confirmed logical rollback and code restoration`,

    /**
     * Announce an overall quality regression that exceeds the composite alert threshold.
     *
     * @param dropPoints - Positive magnitude of the overall quality-index drop, in points.
     * @param agentUid - Identifier of the agent whose revision introduced the regression.
     * @returns A summary line stating the drop and the responsible agent.
     */
    COMPOSITE_QUALITY_REGRESSION: (dropPoints: number, agentUid: string) =>
        `Overall quality index suffered severe regression: dropped by ${dropPoints} points (introduced by Agent: ${agentUid})`,

    /**
     * Announce a quality regression confined to one measured dimension.
     *
     * @param dimension - Human-readable quality dimension name, printed inside brackets.
     * @param dropPoints - Positive magnitude of the dimension's quality drop, in points.
     * @returns A summary line naming the affected dimension and its point loss.
     */
    DIMENSION_QUALITY_REGRESSION: (dimension: string, dropPoints: number) =>
        `Quality regression in dimension [${dimension}]: dropped by ${dropPoints} points`,

    /**
     * Report style drift between two agents that touched the same comparison window.
     *
     * @param fromAgent - Identifier of the agent whose earlier style is being compared.
     * @param toAgent - Identifier of the later agent whose style diverged.
     * @returns A line rendering the directional drift, from `fromAgent` to `toAgent`.
     */
    STYLE_DRIFT: (fromAgent: string, toAgent: string) =>
        `Detected standardization or comment style drift between different Agents (${fromAgent} -> ${toAgent})`,

    /**
     * Report a previously resolved violation that reappeared in the current revision.
     *
     * @param issueId - Stable identifier of the reintroduced violation.
     * @param originRevision - Revision in which the violation was first or last observed.
     * @returns A line naming the violation and its historical revision.
     */
    REINTRODUCED_ISSUE: (issueId: string, originRevision: string) =>
        `Historically resolved violation was reintroduced: ${issueId} (previously observed in revision ${originRevision})`,

    /**
     * Flag code domains modified repeatedly by multiple agents, a conflicting-design signal.
     *
     * @param domains - Domain labels to list; entries are joined with `, ` in argument order.
     * @returns A line that lists the recurring conflict domains.
     */
    RECURRING_CONFLICTING_MODS: (domains: string[]) =>
        `Multiple Agents repeatedly modified the same code domains (${domains.join(', ')}), indicating potential conflicting design approaches`,

    /** Label marking a violation that the current revision newly introduced. */
    NEW_ISSUE_LABEL: 'New violation introduced',
    /** Label marking a violation that the current revision resolved. */
    RESOLVED_ISSUE_LABEL: 'Violation resolved',

    /**
     * Summarize a confirmed logical rollback to a historical revision.
     *
     * @param revisionId - Identifier of the historical revision that was restored.
     * @returns A one-line rollback summary.
     */
    SUMMARY_ROLLBACK: (revisionId: string) =>
        `Logical rollback to historical revision ${revisionId}`,
    /**
     * Summarize a stable or improving quality index.
     *
     * @param delta - Non-negative quality gain in points, rendered with a leading `+`.
     * @returns A one-line improvement summary.
     */
    SUMMARY_IMPROVED: (delta: number) => `Code quality stable or improved (+${delta} pts)`,
    /**
     * Summarize a degraded quality index.
     *
     * @param delta - Negative quality change in points, rendered in parentheses.
     * @returns A one-line regression summary.
     */
    SUMMARY_REGRESSED: (delta: number) => `Code quality degraded (${delta} pts)`,
} as const;
