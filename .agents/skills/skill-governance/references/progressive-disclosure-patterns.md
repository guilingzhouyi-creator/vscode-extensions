# JIT Progressive Disclosure Patterns for Agent Skills

## 1. Why JIT Progressive Disclosure Matters

Context budget directly limits multi-agent instruction accuracy:
1. **Attention Dilution**: Monolithic >500-line skill files bury rigid invariants and verification steps.
2. **Concurrent Activation Overhead**: Tasks frequently activate 3–5 skills simultaneously; bloated prose crowds out source files.
3. **Cognitive Layering**: Agents need scope, non-negotiable red lines, and verification commands upfront; algorithms and scaffolds load strictly on demand.

## 2. Three-Tier Physical Layout

```text
[Level 1: Fast Decision Entry]  SKILL.md (50~200 target, <= 300 lines)
  ├─ Scope, triggers, rigid axioms & quick-reference matrix
  └─ Verification commands & JIT links to Level 2/3
[Level 2: Deep Specs on Demand] references/*.md
  ├─ Platform isolation mechanics, formal proofs & rule taxonomies
[Level 3: Ready-to-Use Scaffolds] templates/*.*
  └─ Compliant code/config/spec templates (CC <= 15, Depth <= 4)
```

## 3. Authoring Checklist

1. **Lean Entrypoint**: Move code blocks >30 lines into `templates/` and exhaustive specs into `references/`.
2. **Active Linking**: Link every file under `references/`, `templates/`, and `scripts/` from a `.md` doc inside the skill (zero orphan assets).
3. **Relative Links Only**: Verify targets exist on disk (`DOC-LNK-001`); never use drive letters or local file URI prefixes (`HC-ABS-PATH`).
4. **Uniform Naming**: Keep all skill folders and markdown/script filenames in `kebab-case`.
