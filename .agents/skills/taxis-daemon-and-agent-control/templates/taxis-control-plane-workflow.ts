/**
 * Module: Skill Template — Taxis Agent Control Plane Workflow
 * File Path: .agents/skills/taxis-daemon-and-agent-control/templates/taxis-control-plane-workflow.ts
 * Architecture Role: Reference scaffold showing VFS snapshot projection, fail-closed variant
 *   evaluation, cycle-safe tree rendering, and real binary parity verification hooks.
 * Dependencies & Triggers: Consumes FractalGit typed interfaces; load on demand as scaffold.
 * Responsibilities:
 *   1. Stage empty files and explicit tombstones without silent drops.
 *   2. Reject all-failing variant batches fail-closed instead of promoting the least bad candidate.
 *   3. Render bounded, cycle-safe hierarchy previews up to depth 64.
 * Exit Semantics & Design Rationale: Throws typed errors on invalid inputs or closed gate failure;
 *   zero shell trampolines and zero uncaught state corruption.
 */

export interface StagedMutation {
  readonly path: string;
  readonly content: string | null;
}

export interface VariantScore {
  readonly id: string;
  readonly passedGate: boolean;
  readonly netDeltaQuality: number;
}

export interface TreeNodeView {
  readonly label: string;
  readonly children?: readonly TreeNodeView[];
}

const MAX_TREE_DEPTH = 64;

/**
 * Partition staged mutations into explicit writes (preserving empty files) and tombstones.
 */
export function partitionVfsMutations(mutations: readonly StagedMutation[]): {
  readonly writes: ReadonlyMap<string, string>;
  readonly deletions: readonly string[];
} {
  const writes = new Map<string, string>();
  const deletions: string[] = [];

  for (const item of mutations) {
    if (!item.path) {
      throw new Error('partitionVfsMutations: empty path rejected');
    }
    if (item.content === null) {
      deletions.push(item.path);
      continue;
    }
    writes.set(item.path, item.content);
  }

  return { writes, deletions };
}

/**
 * Fail-closed variant tournament selection: never returns a candidate that failed gate checks.
 */
export function selectWinningVariant(candidates: readonly VariantScore[]): VariantScore {
  let best: VariantScore | null = null;
  for (const candidate of candidates) {
    if (!candidate.passedGate) continue;
    if (best === null || candidate.netDeltaQuality > best.netDeltaQuality) {
      best = candidate;
    }
  }
  if (best === null) {
    throw new Error('selectWinningVariant: all candidate variants failed gate verification');
  }
  return best;
}

/**
 * Render an ASCII hierarchy guarded against cyclic object references and excessive depth.
 */
export function renderBoundedTree(
  node: TreeNodeView | null | undefined,
  depth = 0,
  visited = new Set<TreeNodeView>(),
): string[] {
  if (!node) return [];
  if (depth >= MAX_TREE_DEPTH || visited.has(node)) {
    return [`${'  '.repeat(depth)}[truncated]`];
  }

  visited.add(node);
  const lines = [`${'  '.repeat(depth)}${node.label || '<unnamed>'}`];
  for (const child of node.children ?? []) {
    lines.push(...renderBoundedTree(child, depth + 1, visited));
  }
  visited.delete(node);
  return lines;
}
