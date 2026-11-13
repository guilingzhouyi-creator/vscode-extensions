# Product Docs & Extension Release Runbook

## 1. User-Facing `CHANGELOG.md` Template
```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.2.0] - 2026-10-23
### Added
- Added weekly and monthly coding duration trend views with one-click summary export.
### Changed
- Reduced idle resource usage by throttling background status-bar refresh ticks.
### Fixed
- Fixed an edge case splitting sessions across local midnight boundaries.
```

---

## 2. User-Facing `README.md` Skeleton
```markdown
# <Extension Display Name>

> Concise single-sentence user value proposition (zero internal architecture codes or gate jargon).

## Features
- **Accurate Real-Time Tracking**: Tracks active editor coding time independently per workspace.
- **Crash-Safe Local Persistence**: Dual-write storage protects logged sessions across sudden restarts.

## Quick Start
1. Install the extension; active today's coding duration appears automatically in the status bar.
2. Click the status bar item or run `Workspace Timing: Show Dashboard` to open analytics.

## Settings
| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `workspaceTiming.idleTimeoutSeconds` | `number` | `300` | Seconds of inactivity before pausing |
```

---

## 3. Release Verification Checklist
- [ ] **1. Asset & Jargon Check**: Run `bash scripts/sh/check-display-assets.sh` verifying `images/icon.png` (128x128), `README.md`, and `CHANGELOG.md` are jargon-free.
- [ ] **2. Compile & Test**: Run `cd workspace-timing && npm run compile && npm run test:fast && npm run review`.
- [ ] **3. Local Package & HotSync**: Run `pwsh -File scripts/ps1/package.ps1 -HotSync` and reload host editor.
- [ ] **4. Version & Tag**: With clean `git status -s`, run `bash scripts/sh/version-bump.sh workspace-timing patch` and `bash scripts/sh/release-tag.sh`.
