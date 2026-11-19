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

`CHANGELOG.md` and `README.md` target end users and must never expose internal engineering jargon:

| Dimension | Blocked Internal Jargon | User-Facing Value |
| :--- | :--- | :--- |
| **Architecture** | "5-layer decoupling", "ablate trampolines", "SubAgent" | "Faster dashboard rendering", "Instant large-workspace stats" |
| **Budget/Memory** | "CC <= 15", "ELOC budget", "1:3 envelope", "zero alloc" | "Lower CPU & memory footprint", "Lightweight tracking" |
| **Gates/Sprints** | "commit-msg gate", "audit-all green", "Phase_XX / Batch N" | "Improved crash recovery", "Complete bilingual UI" |

- **Format**: Keep-a-Changelog `## [X.Y.Z] - YYYY-MM-DD` (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`); `README.md` uses `[Tagline -> Features -> Quick Start -> Extension Settings -> Feedback]` (internals in `docs/architecture.md`).

---

## 2. Discovery, `-HotSync` & Registry Repair

- **SSOT Discovery**: Packaging, version bumps, release tags, and CI discover extensions via `node scripts/common/project-registry-resolver.js --vscode-extensions`.
- **`package.ps1` / `package.sh`**: Output `.vsix` to `dist/<ext>/` (`-Keep 5`); `-HotSync` copies compiled builds to `$env:USERPROFILE\.vscode\extensions` and `$env:USERPROFILE\.cursor\extensions` (`<publisher>.<name>-<version>`); `Repair-ExtensionRegistry` prunes Ghost Entries from host `extensions.json` (UTF-8 no BOM).

---

## 3. SemVer Bump, Release Tagging & Assets

```bash
bash scripts/sh/check-display-assets.sh
bash scripts/sh/version-bump.sh workspace-timing patch --dry-run
pwsh -File scripts/ps1/package.ps1 -HotSync
bash scripts/sh/release-tag.sh workspace-timing patch --message "v0.5.1 — Improve crash recovery and bilingual dictionary" --no-push
```

- [extension-registry-repair.md](references/extension-registry-repair.md): Ghost-entry repair mechanics and jargon translation matrix.
- [package-release-runbook.md](templates/package-release-runbook.md): Keep-a-Changelog template, README skeleton, and release checklist.
