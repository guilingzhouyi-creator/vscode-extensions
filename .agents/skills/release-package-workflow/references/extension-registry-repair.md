# Extension Registry Self-Healing & End-User Changelog Guide

Details `-HotSync` extension registry repair (`extensions.json`) and end-user translation of internal engineering changes.

---

## 1. Self-Healing Host Extension Registry (`Repair-ExtensionRegistry`)

1. **Failure Mode**: Repeated local packaging or manual folder removal leaves dangling `relativeLocation` pointers in `~/.vscode/extensions/extensions.json`, shadowing new installs and breaking commands/icons.
2. **Three-Step Repair**: Parse `extensions.json`, validate each entry's directory + `package.json` on disk, drop phantom entries, write atomically as UTF-8 no BOM, and sync the latest build artifact into the versioned directory.

---

## 2. End-User Changelog Translation (Keep-a-Changelog)

Translate internal rules/budgets into observable user benefits:
- Reject: `"Refactored TimeAggregator.ts to remove loop heap allocs and cut ELOC to 450"`
- Accept: `"Significantly faster dashboard rendering and aggregation across large workspaces"`
- Reject: `"Fixed L3-HARDCODE violation by extracting Chinese labels to zh-CN.ts"`
- Accept: `"Completed bilingual English/Simplified Chinese localization across status bar and dashboard views"`

Use standard Keep-a-Changelog groups only: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
