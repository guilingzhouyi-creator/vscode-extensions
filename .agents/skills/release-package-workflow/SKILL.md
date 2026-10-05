---
name: release-package-workflow
description: >-
  VS Code 扩展本地打包、双端热同步与自动化发布工作流。指导 Agent 执行 package.ps1/sh
  多版本轮转、-HotSync 双端热同步与扩展注册表自愈、SemVer 语义化版本递增（version-bump.sh）、
  资产校验（check-display-assets.sh）与 Git Tag 自动化发布闭环。
---

# release-package-workflow — 扩展打包分发、热同步与发布闭环规范

本技能规范了 VS Code 扩展的本地编译打包、多版本产物轮转、开发期双端热同步、语义化版本递增以及 GitHub Actions 自动化发布流水线。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **打包扩展产物**：执行 `.vsix` 本地打包（发布前置验证或交付本地安装包）；
2. **本地调试与热同步**：开发阶段需要将改动即时无缝同步至本机 VS Code 或 Cursor 扩展目录；
3. **版本演进与日志迁移**：功能交付后递增扩展版本号并封存 `CHANGELOG.md`；
4. **正式发布打标**：触发 GitHub Actions CI/CD 流水线自动化构建与 Release 留痕。

---

## 二、 本地打包与双端热同步 (`package.ps1` / `package.sh`)

打包脚本提供 PowerShell（`package.ps1`）与 Bash（`package.sh`）同构双实现，打包产物统一输出至 `dist/<ext>/`。

### 1. 核心参数与语义
- `-Name <ext>`：指定目标扩展目录（默认 `workspace-timing`）；
- `-Keep <N>`：产物自动清理保留数（默认保留最新 5 个历史版本，防止磁盘膨胀）；
- `-SkipBuild`：跳过 TypeScript 增量编译（仅用于源码已编译时的极速重新打包）；
- `-HotSync`：**核心调试特性**。跳过打包成 `.vsix`，直接将最新编译产物与资源原子拷贝至开发机本地宿主目录，并自动修补扩展注册表；
- `-Install`：打包后自动调用 `code --install-extension` 与 `cursor --install-extension` 执行本地全量安装。

### 2. 双端热同步与扩展注册表自愈机制
当使用 `-HotSync` 时，脚本自动定位宿主目录：
- VS Code：`$env:USERPROFILE\.vscode\extensions`
- Cursor：`$env:USERPROFILE\.cursor\extensions`

若宿主环境存在历史旧版本的卸载残留，`extensions.json` 注册表可能发生孤儿引用导致加载失效。脚本内建 `Repair-ExtensionRegistry` 机制，在热同步前自动清洗失效条目，确保本地秒级生效。

---

## 三、 语义化版本递增与 CHANGELOG 维护 (`version-bump.sh`)

版本演进受 `scripts/sh/version-bump.sh` 刚性管束，严禁手动修改 `package.json` 中的版本字段。

### 1. 执行模式
```bash
# 语义化递增（patch / minor / major）
bash scripts/sh/version-bump.sh workspace-timing patch

# 试运行预览（不修改文件）
bash scripts/sh/version-bump.sh workspace-timing minor --dry-run
```

### 2. Keep-a-Changelog 自动化迁移
脚本执行版本递增时，自动校验并迁移 `CHANGELOG.md`：
1. 校验必须存在 `## [Unreleased]` 区块且内容非空；
2. 自动将 `[Unreleased]` 中的修改内容封存至新版本标题 `## [vX.Y.Z] - YYYY-MM-DD`；
3. 在顶部重新开辟空白的 `## [Unreleased]` 区块供下一轮开发使用。

---

## 四、 发布打标与流水线闭环 (`release-tag.sh` / `release.sh`)

正式发布必须通过 `scripts/sh/release-tag.sh` 实施全流程编排：

```bash
# 标准发布指令
bash scripts/sh/release-tag.sh workspace-timing patch --message "v0.5.1 — 优化存储崩溃安全与双语字典"

# 本地演练（创建提交与 Tag 但不推送到远端）
bash scripts/sh/release-tag.sh workspace-timing patch --message "v0.5.1 — 标题" --no-push
```

### 严格前置门禁：
1. **工作区干净树守卫**：暂存区与工作区必须无未提交改动；
2. **打包资产健全性 (`check-display-assets.sh`)**：
   - 必须包含 `images/icon.png`（128x128 像素标准图标）；
   - 必须包含 `images/banner.png`（发布展示横幅）；
   - `README.md` 与 `CHANGELOG.md` 必须存在且排版合规；
3. **自动化发布触发**：推送附带 `vX.Y.Z` 前缀的 Git Tag 后，自动触发 `.github/workflows/release.yml` 执行远端构建与 GitHub Release 产物上传。

---

## 五、 关联模板与深度指引

- [package-release-runbook.md](templates/package-release-runbook.md)：端到端发布实操检查清单；
- [extension-registry-repair.md](references/extension-registry-repair.md)：本地扩展注册表冲突自愈原理。
