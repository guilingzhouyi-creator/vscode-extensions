/**
 * Module: Core Engine — Change Trajectory Management
 * File Path: src/core/trajectory/changeTrajectory.ts
 * Architecture Role: Stateful per-file trajectory store and orchestration facade; keeps an
 *   in-memory map of revision histories and delegates all comparison logic to AnomalyDetector
 * Dependencies & Triggers: Imports AnomalyDetector from ./anomalyDetector and the trajectory
 *   contracts from ./types; instantiated by Scanner, api.getChangeTrajectory and
 *   TrainingExporter; recordRevision runs after each audited revision (Scanner finalization and
 *   dual-track Step 1.7), while getTrajectory / getAllAnomalies feed escalation and guidance
 * Responsibilities: Normalize Windows separators to POSIX and key trajectories by that path;
 *   lazily create the FileChangeTrajectory (empty revisions, agents and anomalies); register
 *   each new agentUid once; compare a revision against the previous one using the full history
 *   and stamp the returned comparison with the normalized path; expose the latestComparison and
 *   activeAnomalies; look up a single trajectory; flatten active anomalies across all files;
 *   clear all stored state on demand
 * Exit Semantics & Design Rationale: recordRevision returns undefined for the first revision of
 *   a file (no baseline) and getTrajectory returns undefined for unknown paths instead of
 *   throwing; state is process-lifetime memory only, never persisted, so callers must replay
 *   review memory (as api.getChangeTrajectory does) or call clear() to avoid stale growth.
 */
import { AnomalyDetector } from './anomalyDetector';
import type {
    FileChangeTrajectory,
    FileRevision,
    TrajectoryComparison,
    EvolutionAnomaly,
} from './types';

/**
 * Stateful per-file store of revision trajectories and the orchestration facade over
 * AnomalyDetector.
 *
 * Contract: paths passed to `recordRevision` and `getTrajectory` are normalized (Windows
 * `\` to POSIX `/`) before they are used as map keys, so lookups are separator-insensitive.
 * The manager owns the only mutable state; the detector itself is stateless.
 *
 * Failure semantics: `recordRevision` returns `undefined` for a file's first revision
 * because no baseline exists yet, and `getTrajectory` returns `undefined` for unknown
 * paths instead of throwing. State lives only in process memory and is never persisted,
 * so callers replay review memory or call `clear()` to avoid unbounded growth.
 */
export class ChangeTrajectoryManager {
    private readonly trajectories = new Map<string, FileChangeTrajectory>();
    private readonly detector = new AnomalyDetector();

    /**
     * Register a newly audited revision into the trajectory model.
     *
     * The first revision for a path only creates the trajectory; every later revision is
     * compared against the immediately preceding one (with the full history consulted for
     * logical-rollback detection) and the resulting comparison is cached on the trajectory.
     *
     * @param filePath - file that was revised; Windows separators are normalized to `/`
     * before the path is used as the trajectory key.
     * @param revision - audited revision snapshot; its agent uid is registered once and the
     * revision is appended even when no comparison can be produced, and it may receive
     * rollback markers when a logical rollback is detected.
     * @returns the comparison against the previous revision, or `undefined` when this is the
     * first revision of the file (there is no baseline to compare against).
     */
    recordRevision(filePath: string, revision: FileRevision): TrajectoryComparison | undefined {
        const norm = filePath.replace(/\\/g, '/');
        let traj = this.trajectories.get(norm);
        if (!traj) {
            traj = {
                filePath: norm,
                revisions: [],
                totalRevisions: 0,
                participatingAgents: [],
                activeAnomalies: [],
            };
            this.trajectories.set(norm, traj);
        }

        if (!traj.participatingAgents.includes(revision.agentUid)) {
            traj.participatingAgents.push(revision.agentUid);
        }

        let comparison: TrajectoryComparison | undefined;
        if (traj.revisions.length > 0) {
            const previous = traj.revisions[traj.revisions.length - 1];
            comparison = this.detector.detect(revision, previous, traj.revisions);
            comparison.filePath = norm;
            traj.latestComparison = comparison;
            traj.activeAnomalies = comparison.anomalies;
        }

        traj.revisions.push(revision);
        traj.totalRevisions = traj.revisions.length;
        return comparison;
    }

    /**
     * Retrieve the complete trajectory for a file.
     *
     * @param filePath - path to look up; it is normalized exactly like `recordRevision`, so
     * callers may pass either Windows or POSIX separators.
     * @returns the stored trajectory including its revision history, latest comparison and
     * active anomalies, or `undefined` when the file was never recorded.
     */
    getTrajectory(filePath: string): FileChangeTrajectory | undefined {
        const norm = filePath.replace(/\\/g, '/');
        return this.trajectories.get(norm);
    }

    /**
     * Retrieve all active anomalies across all files.
     *
     * @returns a fresh array of `{ filePath, anomaly }` entries in trajectory insertion
     * order; mutating the returned array does not affect stored state, and the result is
     * empty when no trajectory currently has active anomalies.
     */
    getAllAnomalies(): Array<{ filePath: string; anomaly: EvolutionAnomaly }> {
        const list: Array<{ filePath: string; anomaly: EvolutionAnomaly }> = [];
        for (const [p, t] of this.trajectories.entries()) {
            for (const a of t.activeAnomalies) {
                list.push({ filePath: p, anomaly: a });
            }
        }
        return list;
    }

    /**
     * Clear all stored trajectories.
     *
     * Drops every revision history, cached comparison and active anomaly; subsequent
     * `getTrajectory` calls return `undefined` until the file is recorded again.
     */
    clear(): void {
        this.trajectories.clear();
    }
}
