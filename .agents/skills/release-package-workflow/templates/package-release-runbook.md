# VS Code 扩展发布端到端操作检查清单 (Release Runbook)

本清单用于指导自动化代理（CI Agent）与工程维护人员执行 VS Code 扩展的端到端版本发布、本地质量预审、资产验证及自动化流水线闭环。

---

## 阶段一：发布前置健康度自查

- [ ] **工作区干净树守卫**：运行 `git status -s`，确认无未决改动与未跟踪残留；
- [ ] **子项目快速单测回归**：
  ```powershell
  pwsh -Command "Start-Process npm -ArgumentList 'run test:fast' -WorkingDirectory 'workspace-timing' -NoNewWindow -Wait"
  ```
- [ ] **双语字典与架构审查门禁**：
  ```powershell
  pwsh -Command "Start-Process npm -ArgumentList 'run review' -WorkingDirectory 'workspace-timing' -NoNewWindow -Wait"
  ```
- [ ] **变更日志完备性**：确认 `workspace-timing/CHANGELOG.md` 中 `## [Unreleased]` 区块包含本次发布的纯客观技术事实，无黑话与施工代号。

---

## 阶段二：本地打包、资产校验与热同步验证

- [ ] **发布展示资产健全性校验**：
  ```bash
  bash scripts/sh/check-display-assets.sh workspace-timing
  ```
  *断言：128x128 图标、发布横幅、README 与 CHANGELOG 均合规存在。*
- [ ] **本地打包与产物轮转测试**：
  ```powershell
  pwsh -File scripts/ps1/package.ps1 -Name workspace-timing -Keep 5
  ```
  *断言：`dist/workspace-timing/` 成功生成 `.vsix` 产物，且陈旧版本自动轮转修剪至保留上限内。*
- [ ] **（可选开发验证）双端热同步与注册表自愈**：
  ```powershell
  pwsh -File scripts/ps1/package.ps1 -Name workspace-timing -HotSync
  ```
  *断言：无缝同步至本地 VS Code / Cursor 扩展目录，注册表失效条目自愈清洗。*

---

## 阶段三：自动化版本递增与 Tag 发布

- [ ] **确认语义化版本递增级别**（`patch` / `minor` / `major`）；
- [ ] **执行端到端发布打标流水线**：
  ```bash
  bash scripts/sh/release-tag.sh workspace-timing patch --message "v0.5.1 — 修复日志追加边界并完善双语字典"
  ```
- [ ] **核验本地结果**：
  - 确认 `package.json` 版本号成功递增；
  - 确认 `CHANGELOG.md` 中 `[Unreleased]` 内容已自动迁移封存至新版本标题；
  - 确认 Git Tag 创建并推送到远端仓库。

---

## 阶段四：远端 CI/CD 自动化流水线验收

- [ ] **远端 CI 构建守卫**：检查 GitHub Actions 页面，确认 `Release Pipeline` 绿色通行；
- [ ] **Release 产物就绪核验**：确认 GitHub Releases 页面已成功发布对应 Tag 的 `.vsix` 安装包与自动化变更说明草稿。
