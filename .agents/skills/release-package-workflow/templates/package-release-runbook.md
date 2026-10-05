# VS Code 扩展发布端到端操作检查清单 (Release Runbook)

本清单用于指导发布负责人或 Agent 执行标准的版本发布、本地验证与流水线闭环。

---

## 阶段一：发布前置健康度自查

- [ ] 确保全仓工作区处于干净状态（`git status` 无未决改动）；
- [ ] 确保目标扩展的单元测试全部通过：
  ```bash
  cd workspace-timing && npm run test:fast
  ```
- [ ] 确保审查门禁通过：
  ```bash
  cd workspace-timing && npm run review
  ```
- [ ] 确保 `CHANGELOG.md` 中 `## [Unreleased]` 区块已客观记录所有改动事实。

---

## 阶段二：本地打包与资产校验

- [ ] 执行打包资产完整性扫描：
  ```bash
  bash scripts/sh/check-display-assets.sh workspace-timing
  ```
- [ ] 执行本地生成测试包：
  ```powershell
  pwsh -File scripts/ps1/package.ps1 -Name workspace-timing
  ```
- [ ] （可选）本地热同步到 VS Code / Cursor 预览效果：
  ```powershell
  pwsh -File scripts/ps1/package.ps1 -Name workspace-timing -HotSync
  ```

---

## 阶段三：自动化版本递增与打标

- [ ] 确认版本递增级别（patch / minor / major）；
- [ ] 执行端到端版本打标发布流水线：
  ```bash
  bash scripts/sh/release-tag.sh workspace-timing patch --message "v0.5.1 — 修复日志追加边界并完善双语字典"
  ```
- [ ] 观察终端输出，确认本地提交建立、Tag 创建及远端推送成功。

---

## 阶段四：远端 CI/CD 验证

- [ ] 打开 GitHub 仓库 Actions 页面，确认 `Release Pipeline` 绿色通过；
- [ ] 确认 Releases 页面已自动生成新版本产物与变更日志草稿。
