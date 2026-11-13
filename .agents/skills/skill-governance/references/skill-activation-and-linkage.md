# Skill Activation & Linkage Operations Guide

> Reference for maintainers of `.agents/skills` and `scripts/common/skill-registry.json`. Covers the activation surface, trigger design, linkage semantics, and SSOT sync workflow. See [skill-governance](../SKILL.md) and [progressive-disclosure-patterns.md](progressive-disclosure-patterns.md) for the 4-part layout spec.

## 1. Activation Surface: Frontmatter `description`

- Agents only see frontmatter `description` in the index before loading a skill; matching loads `SKILL.md`, and `references/` load on demand (JIT).
- `skill-registry-resolver.js` renders `description` from `activation.template` (`【触发：{triggers}】{pitch}`) joining `triggers` with `/`.
- `descriptionWindow` enforces `50..200` characters (`validate-skills.js` `DESCRIPTION_WINDOW`): enough for triggers + a crisp invocation condition/boundary without bloating turn-zero context.
- Keep exhaustive tables, formulas, and command matrices inside `SKILL.md` / `references/`, never in `description`.

## 2. Trigger Rules (`6..9` triggers, `>= 2` explicit categories)

- **Count & Reuse**: `6..9` unique triggers per skill (`triggersWindow`), each `2..8` characters via `Array.from`; at most `3` cross-skill reuses (`maxTriggerReuse`) so generic terms never collapse routing.
- **Category Classifier (`classifyTrigger`)**:
  1. Matches `activation.classes.symptom` -> `symptom`
  2. Matches `activation.classes.intent` -> `intent`
  3. Contains ASCII letters or matches `activation.classes.technical` -> `technical`
  4. Otherwise falls back to `topic`
- **Hard Contract (`checkTriggerContract`)**: Each skill must hit `>= 3` distinct categories (including `topic`), with `>= 2` from `{intent, symptom, technical}`.
- **Good Pitch**: State when activation is mandatory and what invariants/failure semantics it enforces rather than echoing the skill name.

## 3. Linkage Semantics: Predecessors, Successors & Parallel Supports

- Orchestrated under `domains` (`chain`, `supports`, `scenarios`) in `scripts/common/skill-registry.json`.
- **Predecessors / Successors**: Adjacent items on any `chain` containing this skill; domain entrypoints have no predecessors.
- **Parallel Supports**: Co-occurring skills across shared domains sorted by shared domain count (max `4`, excluding chains), representing constraints that apply concurrently to the same diff rather than extra agents.
- **Scenarios**: Up to `2` matching scenario rows render into `SKILL.md`'s linkage block; the full table renders into `docs/skill-catalog.md`.

## 4. Registry-Driven Maintenance Loop

Edit `scripts/common/skill-registry.json` only, then synchronize all generated surfaces in order:

```bash
node scripts/common/sync-skill-metadata.js    # Update frontmatter & SKILL-LINKS blocks
node scripts/common/render-skill-catalog.js   # Render docs/skill-catalog.md
node scripts/common/sync-skills.js            # Mirror .agents/skills -> plugin bundle
node scripts/common/validate-skills.js        # Verify closure, triggers, links & parity
```

Pass `--check` to the first three scripts for read-only CI drift checks. Never hand-edit generated frontmatter, `SKILL-LINKS`, or `docs/skill-catalog.md`.

## 5. Assertion Gates (`validate-skills.js`)

Two-segment internal assertion IDs (`SKILL_ASSERTIONS`) avoid colliding with 3-segment SSOT rules:
- `SKILL-METADATA`: Checks registry-to-disk closure, trigger contract, and description drift.
- `SKILL-LINKAGE`: Validates domain chains, supports, scenario targets, and archetype links.
- `SKILL-CATALOG`: Asserts byte-exact parity between `docs/skill-catalog.md` and registry output.

Always run `sync-skills.js` after any edit so the `.gitignore`d plugin bundle stays synced without `drift` failures.
