---
name: release-package-workflow
description: >-
  【触发：pack/release/bump/broken/vsix/HotSync/semver/dist】Build VSIX bundles, run -HotSync rotation, bump semver cleanly, and align Keep-a-Changelog user release notes.
---

# release-package-workflow — User-Facing Docs, VSIX Packaging, HotSync & Release Tagging

Unifies **user-facing documentation isolation (`README.md` / `CHANGELOG.md` zero engineering jargon)** with **VS Code extension `.vsix` packaging, dual-host `-HotSync` registry self-healing, SemVer bumping, and automated release tagging**.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[test-benchmark-engineering](../test-benchmark-engineering/SKILL.md)、[docs-archive-governance](../docs-archive-governance/SKILL.md) → **本技能** → —；并行支援 `coding-craft`、`constraint-driven-development`、`debugging-and-error-recovery`、`gate-governance`。
- **领域**：VS Code Timing Extension（链上第 5 步）；其余 2 条领域链见 `docs/skill-catalog.md`
- **协作专员**：原型 `vs-extension`：`wt-construct`、`wt-review`、`wt-refactor`、`wt-explore`
- **何时联动**：Package vsix and run HotSync with changelog alignment → `release-package-workflow` + `workspace-timing-dev` + `gate-governance`；Align version bumps, changelogs, and milestone archives → `release-package-workflow` + `docs-archive-governance` + `batch-commit`
<!-- SKILL-LINKS:END -->

## 1. User-Facing Documentation Isolation (`DOC-RD-001` / `DOC-CL-001`)

`CHANGELOG.md` and extension root `README.md` target end users and must never leak internal engineering or gate jargon:

| Dimension | Blocked Internal Jargon (❌ Violation) | Required User-Facing Value Statement (✅ Compliant) |
| :--- | :--- | :--- |
| **Architecture** | "5-layer decoupling", "ablate trampolines", "SubAgent assembly" | "Faster dashboard rendering", "Instant stats across large workspaces" |
| **Complexity & Memory** | "CC <= 15", "ELOC budget", "1:3 dynamic envelope", "zero heap alloc" | "Lower background CPU & memory footprint", "Lightweight long-session tracking" |
| **Gates & Sprints** | "commit-msg gate", "audit-all green", "Phase_XX / Batch N" | "Improved crash recovery reliability", "Complete bilingual localization" |

1. **Keep-a-Changelog Format**: Heading `## [X.Y.Z] - YYYY-MM-DD` with standard subsections (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`).
2. **Product `README.md` Layout**: Include only `[Tagline -> Features -> Quick Start -> Extension Settings -> Feedback]`; place internal architecture diagrams in `docs/architecture.md`.

---

## 2. Local Packaging, Dual-Host `-HotSync` & Registry Self-Healing (`package.ps1` / `package.sh`)

Artifacts output to `dist/<ext>/`, retaining the latest 5 versions (`-Keep 5` automatic rotation):
- **`-HotSync` Dual-Host Sync**: Bypasses `.vsix` compression to sync compiled output directly into `$env:USERPROFILE\.vscode\extensions` and `$env:USERPROFILE\.cursor\extensions` (`<publisher>.<name>-<version>`).
- **`Repair-ExtensionRegistry` Self-Healing**: Parses host `extensions.json` before sync, removes Ghost Entries whose physical `relativeLocation` directory no longer exists, and writes back UTF-8 without BOM so extension commands and status-bar items register cleanly.

---

## 3. SemVer Bump (`version-bump.sh`) & Release Tagging (`release-tag.sh`)

```bash
bash scripts/sh/check-display-assets.sh
bash scripts/sh/version-bump.sh workspace-timing patch --dry-run
pwsh -File scripts/ps1/package.ps1 -HotSync
bash scripts/sh/release-tag.sh workspace-timing patch --message "v0.5.1 — Improve crash recovery and bilingual dictionary" --no-push
```

---

## 4. JIT References & Templates

- [extension-registry-repair.md](references/extension-registry-repair.md): Ghost-entry registry repair mechanics and jargon-to-user-value translation matrix.
- [package-release-runbook.md](templates/package-release-runbook.md): Keep-a-Changelog template, product README skeleton, and end-to-end release checklist.
