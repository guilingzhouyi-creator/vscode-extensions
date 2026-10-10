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
1. **打包扩展产物**：执行 `.vsix` 本地打包（发布前置验证或交付离线安装包）；
2. **本地调试与热同步**：开发阶段需要将最新构建产物即时无缝同步至本机 VS Code 或 Cursor 扩展目录；
3. **版本演进与日志迁移**：功能交付后递增扩展版本号并封存 `CHANGELOG.md`；
4. **正式发布打标**：触发 GitHub Actions CI/CD 流水线由自动化代理（CI Agent）执行全流程构建与 Release 交付。

---

## 二、 本地打包与双端热同步工程规范 (`package.ps1` / `package.sh`)

打包脚本提供 PowerShell（`package.ps1`）与 Bash（`package.sh`）同构双实现，产物统一定位输出至 `dist/<ext>/`。

### 1. 核心参数与行为语义
- **`-Name <ext>`**：指定目标扩展目录（默认 `workspace-timing`）；
- **`-Keep <N>`**：产物自动清理保留数（默认保留最新 5 个历史版本，依据文件修改时间自动修剪陈旧产物，防止磁盘膨胀）；
- **`-SkipBuild`**：跳过 TypeScript 增量编译（仅用于源码已编译时的极速重新打包）；
- **`-HotSync`**：**核心开发与调试特性**。跳过打包成 `.vsix` 的压缩过程，直接将最新编译产物与静态资源原子同步至开发机本地宿主扩展目录，并在同步前自动执行注册表自愈；
- **`-Install`**：打包后自动调用 `code --install-extension` 与 `cursor --install-extension` 执行本地全量安装。

### 2. 双端热同步机制
当启用 `-HotSync` 时，脚本自动定位本机宿主扩展目录：
- **VS Code**：`$env:USERPROFILE\.vscode\extensions`
- **Cursor**：`$env:USERPROFILE\.cursor\extensions`

直接在目标目录建立 `<publisher>.<extension-name>-<version>` 目录树并同步产物，绕过打包、校验与扩展解包全流程，实现毫秒级即时生效。

### 3. 扩展注册表自愈机制 (`Repair-ExtensionRegistry`)
在频繁的本地覆盖与目录重命名过程中，编辑器的 `extensions.json` 极易残留失效指针（幽灵条目 / Ghost Entries），导致以下典型异常：
1. 编辑器认为扩展已安装但无法加载对应功能；
2. 状态栏视图或自定义命令面板丢失；
3. 扩展清单解析错误（Manifest load error）。

`-HotSync` 在执行产物覆盖前，自动触发 `Repair-ExtensionRegistry`：
- 读取并解析各宿主环境的 `extensions.json`；
- 探测条目对应的 `relativeLocation` 物理路径有效性；
- 剔除指向已删除物理目录的失效条目；
- 紧凑无 BOM UTF-8 写回注册表文件，确保编辑器重载后精准加载最新扩展。

---

## 三、 语义化版本递增与 CHANGELOG 维护 (`version-bump.sh`)

版本演进受 `scripts/sh/version-bump.sh` 刚性管束，严禁手动修改 `package.json` 中的版本号。

### 1. 执行模式
```bash
# 语义化递增（patch / minor / major）
bash scripts/sh/version-bump.sh workspace-timing patch

# 试运行预览（干运行不修改磁盘文件）
bash scripts/sh/version-bump.sh workspace-timing minor --dry-run
```

### 2. Keep-a-Changelog 自动化迁移与用户日志防污染契约
脚本执行版本递增时，自动校验并迁移 `CHANGELOG.md`：
1. 校验必须存在 `## [Unreleased]` 区块且内容包含有效面向用户的质性事实；
2. **产品更新日志防工程污染铁律**：`CHANGELOG.md` 是面向宿主最终用户的发布窗口，**绝对严禁**出现内部工程重构黑话（如消融跳板、AST切片局部复杂度、双向包络收敛、SubAgent装配、153套测试全通过等内部治理术语）；技术升级必须转换为面向用户体验的表述（如“优化后台数据持久化可靠性”、“降低扩展运行期内存占用”）；
3. **README 产品发布页铁律**：扩展顶层 `README.md` 严格定位为商用级产品展示页，严禁平铺开发路线图、施工批次或内部架构细节；
4. 自动将 `[Unreleased]` 中的修改内容封存至新版本标题 `## [vX.Y.Z] - YYYY-MM-DD`；
5. 在顶部重新开辟空白的 `## [Unreleased]` 区块供下一轮开发周期使用。

---

## 四、 发布打标与流水线闭环 (`release-tag.sh`)

正式发布必须通过 `scripts/sh/release-tag.sh` 实施全流程编排：

```bash
# 标准发布指令
bash scripts/sh/release-tag.sh workspace-timing patch --message "v0.5.1 — 优化存储崩溃安全与双语字典"

# 本地演练（创建提交与 Tag 但不推送到远端）
bash scripts/sh/release-tag.sh workspace-timing patch --message "v0.5.1 — 标题" --no-push
```

### 严格前置门禁：
1. **工作区干净树守卫**：工作区与暂存区必须处于干净状态（`git status -s` 输出为空）；
2. **打包资产健全性 (`check-display-assets.sh`)**：
   - 必须包含 `images/icon.png`（128x128 像素标准图标）；
   - 必须包含 `images/banner.png`（发布展示横幅）；
   - `README.md` 与 `CHANGELOG.md` 必须存在且排版合规，绝无工程重构黑话泄漏；
3. **全仓零高危技术债务防线**：全工作区 High/Critical 技术债务历史性归零（0 项），发布前必须确认 0 项债务反弹；
4. **自动化发布流水线触发**：推送附带 `vX.Y.Z` 前缀的 Git Tag 后，自动触发 `.github/workflows/release.yml`，由自动化代理（CI Agent）在隔离容器中完成远端构建与 GitHub Release 产物发布。

---

## 五、 本地验证指令与断言标准

在打包或准备发布前，可执行以下命令完成前置自检：

```powershell
# 1. 验证静态打包展示资产健全性
bash scripts/sh/check-display-assets.sh

# 2. 演练本地干运行版本递增
bash scripts/sh/version-bump.sh workspace-timing patch --dry-run
```

**质性断言标准**：
- 产物目录结构完整，无失效幽灵注册表指针；
- 打包展示资产（128x128 图标与横幅）齐全合规；
- README 与 CHANGELOG 严格面向用户价值，无内部工程黑话与施工代号泄漏；
- 全仓 High/Critical 技术债务保持 0 项刚性基线，工作树干净且流水线前置校验无未决异常。

---

## 六、 关联模板与深度指引

- [package-release-runbook.md](templates/package-release-runbook.md)：端到端发布实操检查清单；
- [extension-registry-repair.md](references/extension-registry-repair.md)：本地扩展注册表冲突自愈原理。
