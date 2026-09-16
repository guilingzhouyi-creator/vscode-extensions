# 📂 scripts/sh — 自动化脚本集（Shell）

> 仓库自动化配套脚本（gate/release 系列），可手动执行或接入 CI。
> 归属 `scripts/sh/`（仓库级脚本库 · Shell 语言域），分类矩阵见 [`../README.md`](../README.md)。

---

# 1️⃣ auto-label.sh — 自动分类打标签程序

仓库 Issue/PR 创建或内容变更时，自动分析内容判定问题类型并打标签。
标签体系见仓库 labels（type/priority/status/module 维度）。

## 一、功能

| 触发事件 | 场景 | 说明 |
|----------|------|------|
| `issue.open` | Issue 创建 | 自动分类并打标签 |
| `issue.update` | Issue 内容变更 | 自动**去旧加新**重新分类打标签 |
| `pull_request` | PR 创建/更新 | 自动分类并打标签 |

## 二、工作流程

1. 读取流水线注入的环境变量。
2. 规则引擎关键词匹配，判定**主类型** `type/*`（必选）。
3. 附带判定：`scope/*`、`priority/*`、`module/*`、必要时 `status/triage`。
4. 新增场景幂等追加打标签；`issue.update` 去旧加新全量覆盖。
5. 输出【打标签结论】+【唤醒提示】。

## 三、规则顺序

```
bug → security → feature → performance → enhancement → refactor → test → docs → question → epic → chore(兜底)
```

---

# 2️⃣ pr-gate.sh — PR 统一前置门禁程序（冲突检测 + Diff 初筛 + 幂等防卡死）

> **目的**：解决"自动监听 PR、判断代码冲突、审查 Diff 质量"的自动化 NPC 程序**卡死**问题。
> 作为 `pull_request` 事件的第一道**确定性中枢**，在拉起任何 NPC 之前先做：幂等去重、冲突检测、
> Diff 质量初筛、冲突分级派单。**避免 4 个 NPC 同时拉起后互相等待、重复修复、级联无限触发**。

## 一、解决的"卡死"根因

| 根因 | pr-gate 对策 |
|------|-------------|
| **多重触发互相等待**：一个 PR 出现，构建/测试/审查/规划者 4 个 NPC 被同时拉起，各自 userPrompt 要求"等/复核他人结论" → 并行拉起 + 串行依赖 = 死锁 | 先跑 pr-gate 输出【门禁结论】，各 NPC 读结论后按冲突分级分工，**只让本轮主导者介入** |
| **修复即再次触发的无限循环**：任何执行体定点修复 push 后再次触发 pull_request，又拉起 4 个 NPC → 级联无限触发 | **幂等去重**：同一 head commit 已审查（`status/gate-ok` 标签 / 本地缓存）则直接跳过 |
| **缺少统一前置判断**：冲突分级（C1/C2/C3）与 diff 质量全靠各 NPC 自行解读 | pr-gate 统一检测冲突 + 初筛质量，输出结构化结论供各 NPC 复用 |

## 二、工作流程

1. **幂等去重**：检查该 PR 的 head commit 是否已审查过（`status/gate-ok` 标签 + 本地缓存双保险）→ 已审查则跳过（防卡死）。
2. **冲突检测**：`git merge --no-commit` 预演目标分支 → 判定冲突等级。
3. **冲突分级**：
   - `C0` 无冲突
   - `C1` 可自动化解（简单文件冲突，构建/测试定点化解）
   - `C2` 需审查判断（逻辑互斥/方案冲突，审查主审+规划者）
   - `C3` 高危（数据迁移/核心逻辑/依赖，强制人工+CodeBuddy 复核，禁止自动合入）
4. **Diff 质量初筛**：统计变更规模（文件数/增删行），扫描硬编码/TODO/console.log/大重构信号。
5. **分级派单**：输出【唤醒建议】——按 C0/C1/C2/C3 只唤醒本轮主导者，避免 4 个 NPC 并行互相等待。
6. **幂等落盘**：写 head commit 缓存 + 打 `status/gate-ok` 标签（防重复触发）。

## 三、配套流水线接入

CI 的 `pull_request` 事件中，`pr-gate.sh` 建议置于 `auto-label.sh` 之后、拉起任何审查之前执行；
后续审查流程可先读 pr-gate【门禁结论】→ 幂等跳过 → 按分级分工。

## 四、环境变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `CNB_PULL_REQUEST` | 流水线 | 是否 PR 场景（非 PR 直接跳过） |
| `CNB_PULL_REQUEST_IID` | 流水线 | PR 编号 |
| `CNB_DEFAULT_BRANCH` | 流水线 | 目标分支（用于冲突预演与 diff 对比） |
| `CNB_COMMIT` | 流水线 | head commit（用于幂等去重） |
| `CNB_REPO_SLUG` | 流水线 | 组织/仓库 |

---

# 3️⃣ release.sh — 打标后发布自动化骨架（R2 · 意图 #17 M2）

> **目的**：在「打标 + PR 合入门禁全绿」后，触发并执行发布流程。承接 workspace-timing 现有发布路径，作为发布自动化的统一骨架。

## 一、功能

| 功能 | 说明 |
|------|------|
| **触发判断** | 仅在 PR 合入门禁全绿后触发（与 pr-gate.sh / pull_request 联动） |
| **幂等去重** | 同版本不重复发布（tag 已存在则跳过） |
| **失败重试** | post-release 失败自动重试 N 次 |
| **超时兑底** | 分步 + 总超时，超时按升级链（执行体→审查→规划→管理员）上移 |

## 二、配套联动

- **auto-label.sh v2**：输出【打标签结论】+【发布触发】判断，据此决定是否串联 release.sh
- **pr-gate.sh**：输出【门禁结论】并打 status/gate-ok（门禁全绿标志）
- **流水线接入**：可手动执行或接入 CI（pull_request.merged / tag_push 事件）

## 三、环境变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `CNB_REPO_SLUG` | 流水线 | 组织/仓库（必填） |
| `CNB_EVENT` | 流水线 | 事件名（发布仅在 pull_request.merged 等合入门禁全绿后触发） |
| `CNB_PULL_REQUEST_IID` | 流水线 | PR 编号（用于门禁全绿校验） |
| `CNB_DEFAULT_BRANCH` | 流水线 | 目标分支 |
| `RELEASE_MODULE` | 可选 | 指定发布模块/版本；缺省自动从 package.json 读取 |

# 4️⃣ test-release.sh — release.sh 异常兜底用例（T2-T1 · 意图 #17 M2）

> **目的**：为发布自动化 release.sh 补齐**异常兜底**最小可运行单测，覆盖三条兜底链：
> ① 幂等去重（同版本不重复发布，R16）② 失败重试（post-release 失败自动重试 N 次）
> ③ 超时升级链（单步超时重试 + 总超时升级执行体→审查→规划→管理员）。

## 一、实现方式

不依赖真实 CNB 平台，通过注入**假 cnb CLI（stub）**到 PATH，按场景控制
`get-release-by-tag` / `post-release` 的返回码，观察 release.sh 的输出与退出码是否符合兜底预期。
无外部依赖，任意 bash 可跑。

## 二、运行

```bash
bash scripts/sh/test-release.sh
# 退出码 0 = 全部用例通过；非 0 = 存在失败用例
```

## 三、用例覆盖

| 用例组 | 覆盖场景 | 断言数 |
|--------|---------|-------|
| A 幂等去重 | 标签已存在→跳过；关闭幂等→仍发布 | 4 |
| B 失败重试 | 多次失败→升级失败；首败后成功→重试成功 | 8 |
| C 超时升级链 | 单步超时→重试；总超时→升级 | 6 |

---

# 5️⃣ auto-merge-gate.sh — PR 自动化合入安全门禁（配合平台原生 git:auto-merge）

> **目的**：在平台 `pull_request.mergeable` 事件（PR 满足「无冲突 + 评审通过 + 保护分支」）触发时，
> 作为**自动化合入前的最后一道确定性安全门禁**，判定该 PR 是否允许平台自动合入，
> 实现「安全的全自动合入」——把平台原生 `git:auto-merge` 能力与仓库门禁治理 §4.8 的冲突准入衔接起来。

## 一、解决的痛点

PR 合入由专职「合入员」NPC 决策（铁律 R21：`pull_request` Stage 4 合入门禁 + `pull_request.mergeable` 复核）。
平台原生 `git:auto-merge` 可在 PR mergeable 时直接合入，但**裸用会绕过仓库冲突分级**：
C2（需审查判断）/C3（高危）禁止自动合入。本脚本在 auto-merge 前插入确定性判定，安全放行 C0。

## 二、工作流程（退出码语义）

1. **就绪判定**：确认已过前置门禁（`status/gate-ok` 标签 / pr-gate 缓存），未过则禁止合入（退出非 0）。
2. **否决标签检查**：存在 `status/merge-blocked`（合入员 NPC 或人工打标否决）→ 禁止自动合入（退出非 0）。
3. **冲突检测**：git merge 预演目标分支 → 分级 C0-C3（复用 pr-gate 规则）。
4. **准入判定**：仅 C0 无冲突 → `exit 0` 放行；C1/C2/C3 或 **UNKNOWN**（目标分支缺失 / 无 git 仓库 / 预演回退异常，无法确定性判定）→ `exit 非 0` 保守禁止，退回人工/审查。

> **fail-safe 原则**：作为「最后一道安全门禁」，凡无法确定性确证无冲突的情况一律保守拒绝，**绝不降级放行**。
> （`pull_request.mergeable` 事件虽由平台保证 mergeable，但门禁自身必须可确证无冲突才放行，杜绝裸放行绕过冲突分级。）

> 流水线中本脚本先于 `git:auto-merge` 执行：门禁通过（exit 0）→ 平台自动合入；
> 门禁失败（exit 非 0）→ 后续 `git:auto-merge` 被跳过，PR 保持未合入等待人工。

## 三、配套流水线接入

CI 的 `pull_request.mergeable` 事件可编排为：
`auto-merge-gate.sh`（Stage 0 确定性门禁）→ 人工复核（Stage 1 决策层，可打 `status/merge-blocked` 否决）→ `merge-blocked 否决复查`（Stage 2 兜底）→ `git:auto-merge`（Stage 3，仅全链通过时执行，squash 合并 + 删源分支）。

## 四、环境变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `CNB_PULL_REQUEST` | 流水线 | 是否 PR 场景（非 PR 禁止合入） |
| `CNB_PULL_REQUEST_IID` | 流水线 | PR 编号 |
| `CNB_DEFAULT_BRANCH` | 流水线 | 目标分支（用于冲突预演） |
| `CNB_COMMIT` | 流水线 | head commit（幂等就绪判定） |
| `CNB_REPO_SLUG` | 流水线 | 组织/仓库 |

---

# 6️⃣ version-bump.sh — 语义化版本递增 + CHANGELOG 段落迁移（本地发布工具链）

> **目的**：为扩展发布提供**严格门禁**的版本递增工具，产出与 `.github/workflows/release.yml`
> 自动发布门禁完全兼容的提交信息前缀（`vX.Y.Z`），杜绝手改版本号的漂移与回退。

## 一、严格契约

| 门禁 | 规则 | 失败语义 |
|------|------|---------|
| 扩展身份 | 仅接受声明 `engines.vscode` 的目录（与 CI 发现逻辑同源） | 拒绝（exit 1） |
| 干净工作树 | 发布前工作树必须干净，防止漏打包 | 拒绝（exit 1） |
| 版本单调 | 新版本必须**严格大于**现版本（含显式版本路径） | 拒绝（exit 1） |
| CHANGELOG | keep-a-changelog：`[Unreleased]` 内容整体迁入新版本段落，`[Unreleased]` 置空保留 | 无 Unreleased 段则报错（exit 1） |

## 二、用法

```bash
bash scripts/sh/version-bump.sh <扩展目录> <major|minor|patch>          # 语义递增
bash scripts/sh/version-bump.sh <扩展目录> X.Y.Z                        # 显式版本（须大于现版本）
bash scripts/sh/version-bump.sh <扩展目录> patch --dry-run              # 只打印计划，不落盘
bash scripts/sh/version-bump.sh <扩展目录> patch --root <fixture>       # 夹具自检（跳过 git 门禁）
```

## 三、配套

- 提交信息必须以 `vX.Y.Z` 开头（可带 conventional-commit 前缀），release.yml 分支自动发布门禁据此识别；
- CI hygiene 作业内置夹具自检（递增/迁移/回退拦截/非法模式/非扩展拒绝 5 项），防行为漂移。

---

# 7️⃣ release-tag.sh — 本地发布闭环（bump → 构建 → 打包 → 提交 → Tag → 推送）

> **目的**：把「版本递增 → 构建验证 → 打包 → 资产校验 → 提交 → 打 Tag → 推送」串成
> 一条可复现的本地闭环，产物与 `release.yml` 完全同构；构建验证全部通过后才允许
> 提交与打 Tag——失败不留半成品、不留死 Tag。

## 一、严格契约（比 CI 流水线更严，全流程本地可复现）

1. 干净树门禁 + 版本单调 + 扩展身份（同 version-bump.sh）
2. `npm ci`（与 CI 同依赖树）+ `compile` + `vsce package` 先于提交
3. 展示资产 pre/post 双阶段校验（icon 与 README 图片必须真实打进 vsix）
4. 提交信息形如 `vX.Y.Z — 标题 | 英文副标题`，且与产物版本严格一致（自产合规提交）
5. 提交仅含 `package.json` + `CHANGELOG.md` 两个文件（发布提交最小化）
6. Tag `<扩展名>-vX.Y.Z` 已存在 → 拒绝（幂等防重复，与 release.yml 同源）
7. 推送先分支后 Tag；`--no-push` 全部本地留痕

## 二、用法

```bash
bash scripts/sh/release-tag.sh workspace-timing patch \
  --message "v0.5.0 — 标题 | English subtitle"
bash scripts/sh/release-tag.sh workspace-timing patch \
  --message "v0.5.0 — 标题 | English subtitle" --no-push    # 本地留痕
bash scripts/sh/release-tag.sh workspace-timing patch \
  --message "v0.5.0 — 标题 | English subtitle" --dry-run    # 只打印计划
```

## 三、配套

- Tag 推送后 `release.yml` 的 Tag 触发路径自动补建 GitHub Release（跳过提交信息门控）；
- 产物 `dist/<扩展名>/<扩展名>-<版本>.vsix` + `SHA256SUMS.txt` 与 CI 布局同构。

---

# 变更日志

| 时间 | 操作者 | 变更摘要 |
|------|--------|---------|
| 2026-09-13 | 工程整改 | 脚本库完备性与性能审查治理：① 修复 release-tag.sh dry-run 的 --no-push 提示恒显缺陷；release-tag 构建步骤补 lockfile 新旧判定触发 npm ci（与 package.sh 同规）② 新增 gate-common.sh 冲突分级单源规则库，pr-gate.sh / auto-merge-gate.sh 统一接入（两侧高危模式漂移治理，非高危多文件冲突统一收紧为 C2）③ pr-gate.sh 收敛为单次 `git diff --numstat` + 全量 diff 单次落盘三信号复用 + 标签清单单次拉取复用；硬编码扫描正则改变量传参（去 \x27 可移植性隐患）④ auto-label.sh 关键词匹配改 Bash4 内建小写化（消除约 140 次 tr 子进程）⑤ version-bump.sh 未知旗标显式报错（防拼写错误静默吞掉）⑥ check-display-assets.sh post 模式 zip 清单单次解包复用 ⑦ 修正 2026-08-21 变更日志中「release.sh 附件上传」的不实登记（该实现从未入库，见下行批注） |
| 2026-09-09 | 工程整改 | 新增 version-bump.sh（语义递增 + CHANGELOG 迁移，三门禁）与 release-tag.sh（本地发布闭环，与 release.yml 同规）；修复 package.sh/package.ps1 语言分域重构后的根路径失效（P1）；修复 check-display-assets.sh 的 icon 校验静默禁用（P2，require 缺 ./ 前缀）；ci.yml 增补 hygiene 作业永久看守三类回归 |
| 2026-08-21 | CodeBuddy | 建立 auto-label.sh（5 维度规则引擎，幂等打标签） |
| 2026-08-21 | CodeBuddy | auto-label.sh v2：支持 issue.update 去旧加新；新增 security/epic 类型；容错重试 + 唤醒提示 |
| 2026-08-21 | CodeBuddy | 新增 pr-gate.sh：PR 统一前置门禁（冲突检测 + Diff 初筛 + 幂等去重 + 分级派单），解决自动监听 PR 卡死问题 |
| 2026-08-21 | CodeBuddy | 新增 release.sh：打标后发布自动化骨架（触发判断 + 幂等去重 + 失败重试 + 超时兑底）；auto-label.sh 增加发布触发联动（R2） |
| 2026-08-21 | 协作员·测试 | 新增 test-release.sh：release.sh 异常兜底用例（幂等去重/失败重试/超时升级链，16 断言） |
| 2026-08-21 | CodeBuddy | 新增 auto-merge-gate.sh：PR 自动化合入安全门禁（gate-ok 就绪判定 + 冲突分级 C0-C3 准入），配合平台原生 git:auto-merge 实现「安全的全自动合入」 |
| 2026-08-21 | CodeBuddy | auto-merge-gate.sh fail-safe 加固：目标分支缺失 / 无 git 仓库 / 预演回退异常 → 判 UNKNOWN 保守禁止合入（原降级放行 C0）；移除 git reset --hard 破坏性兑底，仅用 merge --abort 回退 |
| 2026-08-21 | CodeBuddy | 建立专职「合入员」自动化合入系统：pull_request Stage 4 合入门禁与 pull_request.merged 后处理移交合入员；pull_request.mergeable 增加合入员复核 + merge-blocked 否决复查；auto-merge-gate.sh 增加 status/merge-blocked 否决标签检查 |
| 2026-08-21 | CodeBuddy | 自动化增强：git:auto-merge 增加 allowAssigneeApprovedMerge（避免有 assignee 时自动合入被跳过）；新增 $ push 事件「主分支构建验证」（合入后防线）；pr-gate.sh 增加合入状态读取（merge-ready/merge-blocked）+ 陈旧否决识别（提示合入员复核，不自动清除人工否决） |
| 2026-08-21 | CodeBuddy | 自动化进阶：① failStages 失败升级链（门禁失败自动打 status/pending-fix、移除 merge-ready）② 合入后状态回收（git:pr-update 打 status/done、清 pending-fix/merge-ready/merge-blocked）③ 全流水线 timeout（NPC 30m / 脚本 5-10m / 发布 10m）④ 新增 tag_push 发布闭环 ⑤ main 分支 crontab 每周一定时巡视 |
| 2026-08-21 | CodeBuddy | 发布工具链规划登记：version-bump.sh / release-tag.sh 首次写入变更日志（⚠️ 当日未实际入库，2026-09-09 由工程整改补建落地，见顶部行）；release.sh 增强 Release 附件上传（.vsix 两段式 upload-url→PUT→confirmation，失败仅告警）（⚠️ 附件上传实现实际未随当日提交入库，当前 release.sh 仅有 post-release 占位——2026-09-13 核实修正；如需附件上传须重新立项）；dist 产物不入库 |
| 2026-08-21 | CodeBuddy | 覆盖率门禁接入：workspace-timing 用 c8 替代 nyc（Node22 兼容），test:coverage 生成 lcov.info（当前行覆盖率 64.26%）；CI 质量门禁后接 testing:coverage（breakIfNoCoverage=false 先上报，待数据积累后收紧红线） |
