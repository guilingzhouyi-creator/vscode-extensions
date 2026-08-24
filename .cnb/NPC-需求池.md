# NPC 需求池（需求收集与统计）

> 配套文档：`.cnb/NPC-约定索引.md`（铁律 + 指针地图）、`.cnb/NPC-约定-规划调度.md`（收集/阈值/级联启动）。
> **DRI（主维护责任人）：路线图规划者**。
> 本文件记录仓库管理员与提问者在 Issue 中提出的功能需求/问题。
> 更新时机：规划者每次被提及（收集到新需求）即更新；达到阈值时更新路线图并级联启动协作 NPC；
> 每轮收官后随文档健康巡检一并核对。

---

## 维护规则（摘要）

1. 每条需求必须记录：编号 / 提出者 / 来源 Issue / 提出时间 / 需求描述 / 优先级 / 状态
2. 去重：规划者收到需求先与已有条目比对，重复则合并并标注关联编号
3. 状态取值：已记录 / 已确认 / 已排入路线图 / 已实现 / 已关闭
4. 达到启动阈值（≥3 条已确认 或 管理员明确指示）→ 规划者更新路线图并 @ 级联启动三个协作 NPC

---

## 需求池记录

<!--
新增需求时，复制以下模板并填写：

### 需求 R<n>：<一句话描述>
- 提出者：<仓库管理员 / 提问者>
- 来源：Issue #<编号>
- 提出时间：<YYYY-MM-DD>
- 描述：<详细需求>
- 优先级：P0(紧急) / P1(重要) / P2(一般) / P3(将来)
- 依赖：<关联需求编号 或 ->
- 状态：已记录 / 已确认 / 已排入路线图 / 已实现 / 已关闭
- 统计标签：<所属聚类，如：性能 / 可用性 / 存储 / 新功能>
-->

### 需求 R1：实现「多工作区对比」视图（v0.2.0 收尾）
- 提出者：归零-真渡（cnb.ccfkireyBTA）
- 来源：Issue #11
- 提出时间：2026-08-21
- 描述：在 Dashboard 中实现多工作区时长**对比视图**（对比图表/可视化），复用 `GlobalAggregator` 已提供的 `workspaceList / workspaceCount / globalTotalMs` 数据；当前仅文本列表（`renderWorkspaceList`），缺对比可视化
- 优先级：P1（重要，v0.2.0 收尾项）
- 依赖：-
- 状态：已实现（PR #12 已合入，main ea32713）
- 统计标签：新功能 / 可视化

### 需求 R2：打标发布自动化（基于原有实现的改造升级）
- 提出者：归零-真渡（cnb.ccfkireyBTA）
- 来源：Issue #17
- 提出时间：2026-08-21
- 描述：基于已有打标签自动化（auto-label.sh v2）的改造升级，推进**发布自动化**，完善外围脚手架系统。
  规划要点（DRI 规划者）：① 发布触发入口（auto-label.sh 打标后串联【发布触发】判断）；② 发布联动（构建产物/release notes/打 tag/推送 release，承接 workspace-timing 现有发布路径）；③ 异常兜底（失败重试 + 幂等去重 + 超时升级链）；④ 与 pr-gate.sh / pull_request 门禁联动（发布仅在 PR 合入门禁全绿后触发）
- 优先级：P1（重要，意图 #17 M2 核心推进项）
- 依赖：R3（已完成，pr-gate.sh 前置门禁脚手架）
- 状态：已实现（意图 #17 M2，构建域 PR #20 + 测试域 PR #21 + 审查域 T2-R1 完成；2 项 L2 缺口由归零-真渡「继续推进」裁决后，PR #25 已合入——pull_request.merged 接入 release.sh + CNB_EVENT 已核实，发布自动化闭环完成）
- 统计标签：自动化 / 基础设施 / 发布

### 需求 R3：外围脚手架系统完善——落地 `pr-gate.sh` PR 前置门禁（冲突检测 + Diff 质量审查 + 防卡死）
- 提出者：归零-真渡（cnb.ccfkireyBTA）
- 来源：Issue #13（遗留挂起项）+ Issue #17（规划推进）
- 提出时间：2026-08-21
- 描述：管理员在 Issue #13 末评论要求「自动监听 PR 出现，判断代码冲突以及审查 Diff 质量问题的自动化 NPC 程序需要进一步完善，不能卡死」。该任务当时由 CodeBuddy 标记为进行中（编写 pr-gate.sh）但**脚本从未落盘**，且 Issue #13 关闭时未承接，成为**遗留挂起项**。门禁治理分册 §4.8 已定义冲突检测/审查规则，但缺少**自动化脚本实现**。本需求为落地该缺口：统一 PR 前置门禁程序（冲突检测→Diff 质量→幂等去重防卡死），并接入 `.cnb.yml` 的 pull_request 事件。
- 优先级：P1（重要，外围脚手架完善核心推进项）
- 依赖：-（基于门禁治理 §4.8 已有规则设计）
- 状态：已实现（PR #19 已合入，main a170664/2ecd4f8，意图 #17 M1）
- 统计标签：脚手架 / CI / 自动化

### 需求 R4：PR 自动化合入（平台原生 git:auto-merge + 安全门禁）
- 提出者：归零-真渡（cnb.ccfkireyBTA）
- 来源：Issue #22
- 提出时间：2026-08-21
- 描述：在现有 PR 门禁自动化基础上，解决「PR 自动化合入」缺口——目前 PR 合入仍由「路线图规划者」NPC 在 `pull_request` 事件中手动执行。本需求引入平台原生 `git:auto-merge` 内置任务（`pull_request.mergeable` 事件：无冲突 + 评审通过 + 保护分支），并新增 auto-merge-gate.sh 安全门禁（gate-ok 就绪判定 + 冲突分级 C0-C3 准入），实现「安全的全自动合入」：仅 C0 无冲突且已过前置门禁的 PR 由平台自动 squash 合入 + 删源分支；C1/C2/C3 强制退回人工/审查（门禁治理 §4.8），杜绝裸用 auto-merge 绕过冲突分级。
- 优先级：P1（重要，完善 PR 门禁自动化闭环）
- 依赖：R3（已完成，pr-gate.sh 前置门禁 + gate-ok 幂等标签）
- 状态：已实现（PR #23 已合入，main 7780e47，auto-merge-gate.sh + pull_request.mergeable 安全门禁落地；fail-safe 加固 PR #24 已合入，main c38ae60，UNKNOWN 保守禁止合入；深化增强 PR #30 已合入，main 89400cc——专职「合入员」NPC 决策层落地，合入门禁移交合入员，新铁律 R21；后防线修复 PR #31 已合入，main 526d2bc——push 事件「主分支构建验证」脚本显式 set +e 关闭 errexit，消除 runner set -e 下误报 error，合入后防线告警不阻断语义落地；自动化进阶 PR #32 已合入，main 4af1873——状态标签流转/失败升级链/超时策略/tag_push 发布闭环/crontab 定时巡视；覆盖率门禁 PR #34 已合入，main 3bfa1fc——c8 替代 nyc（Node22 兼容），test:coverage 生成 lcov.info（行覆盖率 64.26%），.cnb.yml 接入 testing:coverage 上报（breakIfNoCoverage=false 先观察后收紧））
- 统计标签：自动化 / CI / 脚手架

### 需求 R5：修复内存泄漏与配置失效问题（性能优化）
- 提出者：归零-真渡（cnb.ccfkireyBTA）
- 来源：Issue #26
- 提出时间：2026-08-21
- 描述：在使用过程中出现内存泄漏/性能问题，需审查并完整修复。协作员·审查修复内容：① maxSessions 配置未生效（SessionManager 硬编码 1000，改为从配置传入）；② journalEnabled 配置未生效（Scheduler 无条件写 RingBuffer/journal，改为按配置控制）；③ deactivate() 未 await orchestrator.stop()（改为 async 确保数据完整落盘）；④ DashboardPanel._messageHandler 静态引用未清除（deactivate 时清理）；⑤ onTick 每秒调用 getDashboardData()（面板刷新节流为每 5 秒）；⑥ vscode.Uri.joinPath(uri,'..') 不解析路径段（改用 path.dirname 正确获取父目录）
- 优先级：P1（重要，性能/稳定性）
- 依赖：-
- 状态：已实现（PR #28 已合入，main 7fcdf66；Issue #26 已关闭 completed）
- 统计标签：性能 / 稳定性

### 需求 R6：完善周报和日报系统（日报明细/周报多周趋势/文字摘要/Markdown 报告导出）
- 提出者：归零-真渡（cnb.ccfkireyBTA）
- 来源：Issue #27
- 提出时间：2026-08-21
- 描述：完善 workspace-timing 周报/日报能力（现状已有 todayMs/dailyStats/last7Days/weekTotalMs/GlobalAggregator 底座）。协作员·构建评估「可实现，基础已具备」。实现内容：① 日报明细视图（今日会话列表 + 按小时分布 + 活跃时段）；② 周报多周趋势（近 4 周按周聚合对比）；③ 周报文字摘要（总时长/日均/活跃天数/最活跃日期/会话数）；④ Markdown 报告导出（ReportExporter）。技术落点：TimeAggregator 新增 dailyDetail/weeklyTrend/weeklySummary，新增 ReportExporter，DashboardPanel 新增摘要卡片/趋势条/明细列表/导出按钮。
- 优先级：P1（重要，协作员·构建评估可行）
- 依赖：-（复用 sessions 会话历史底座）
- 状态：已实现（PR #29 已合入，merge f9b3ec3；Issue #27 已关闭 completed；门禁全绿 compile/lint/test:unit 10 passing；审查 3 项 info 级非阻塞建议留待后续优化）
- 统计标签：新功能 / 报表 / 可视化

---

## 统计视图（规划者每次处理后更新）

| 聚类 | 需求数 | 已确认 | 已排入路线图 | 已实现 | 备注 |
|------|--------|--------|--------------|--------|------|
| 新功能/可视化 | 1 | 1 | 1 | 1 | R1 已实现（PR #12） |
| 自动化/基础设施/发布 | 1 | 1 | 1 | 1 | R2 已实现（意图 #17 M2，PR #20/#21/#25 已合入） |
| 脚手架/CI/自动化 | 2 | 2 | 2 | 2 | R3 已实现（PR #19 合入）；R4 已实现（PR #23 + fail-safe PR #24 + 深化增强 PR #30 + 后防线修复 PR #31 + 自动化进阶 PR #32 + 覆盖率门禁 PR #34 合入） |
| 性能/稳定性 | 1 | 1 | 1 | 1 | R5 已实现（PR #28 合入，main 7fcdf66，Issue #26 已关闭） |
| 新功能/报表/可视化 | 1 | 1 | 1 | 1 | R6 已实现（PR #29 合入，merge f9b3ec3，Issue #27 已关闭） |

**当前启动判定**：R3 已实现（PR #19 合入，意图 #17 M1 完成）。R2 已实现（意图 #17 M2：构建域 PR #20 + 测试域 PR #21 + 审查域 T2-R1 完成，L2 缺口 PR #25 已合入，发布自动化闭环完成）。R4（PR 自动化合入，Issue #22）已实现（PR #23 + fail-safe PR #24 合入 + 深化增强 PR #30 合入员系统合入 + 后防线修复 PR #31 合入 + 自动化进阶 PR #32 合入 + 覆盖率门禁 PR #34 合入）。R5（内存泄漏/配置失效，Issue #26）已实现（PR #28 合入，main 7fcdf66，Issue #26 已关闭）。R6（周报日报系统，Issue #27）已实现（PR #29 合入，merge f9b3ec3，Issue #27 已关闭）。全部需求（R1-R6）均已实现，下一批候选需求待收集。
**路线图演化方向建议**：R1-R6 全部已实现（R1 多工作区对比 / R2 打标发布自动化 / R3 pr-gate.sh 前置门禁 / R4 PR 自动化合入 / R5 内存泄漏与配置失效修复 / R6 周报日报系统）。意图 #17（M1+M2+M2 延伸）已全部合入闭环。下一候选：M3（下一插件选题评估，M2 完成后评估）。

---

## 变更日志（追加式）

| 时间 | 操作者 | 变更摘要 |
|------|--------|---------|
| 2026-08-21 | 路线图规划者 | 写入需求 R1（多工作区对比），已排入意图 #11 M1 |
| 2026-08-21 | CodeBuddy | 需求 R1 已实现（PR #12 合入 main ea32713），v0.2.0 收尾完成，状态→已实现 |
| 2026-08-21 | 路线图规划者 | 写入需求 R2（打标发布自动化，Issue #17），状态→已记录，待深入了解细化 |
| 2026-08-21 | 路线图规划者 | Issue #17 深入了解：识别 #13 遗留挂起项（pr-gate.sh 未落盘），新增需求 R3（外围脚手架完善）；R2 依赖更新为 R3 |
| 2026-08-21 | 路线图规划者 | 需求 R3 已实现（PR #19 合入 main a170664 + api_trigger role 修复 2ecd4f8，意图 #17 M1 pr-gate.sh 落地） |
| 2026-08-21 | 路线图规划者 | 需求 R2 细化并排入意图 #17 M2（归零-真渡「继续后续你的路线图」授权推进）；规划发布触发/发布联动/异常兜底/门禁联动四要点；状态 →已排入路线图（进行中） |
| 2026-08-21 | 路线图规划者 | 需求 R2 构建域已合入（PR #20，main 62078d7）：release.sh 发布自动化骨架 + auto-label.sh 打标发布联动落地；待测试域（TB-M2-T）与审查域（TB-M2-R）执行后 R2 才可标记「已实现」 |
| 2026-08-21 | 路线图规划者 | 需求 R2 测试域已合入（PR #21，main cb47f27）：test-release.sh 异常兜底用例 + TimerEngine 单测落地；构建+测试域已合入，待审查域（TB-M2-R T2-R1）执行后方可标记「已实现」 |
| 2026-08-21 | CodeBuddy | Issue #22 交办「PR 自动化合入」→ 新增需求 R4（平台原生 git:auto-merge + auto-merge-gate.sh 安全门禁）；构建域落地（pull_request.mergeable 事件 + 冲突分级准入），状态→已排入路线图，待审查域复核 |
| 2026-08-21 | 路线图规划者 | 需求 R4 已实现（PR #23 已合入，main 7780e47）：auto-merge-gate.sh + pull_request.mergeable 安全门禁落地，安全的全自动合入闭环；Issue #22 已解决，状态→已实现 |
| 2026-08-21 | 路线图规划者 | 需求 R4 fail-safe 加固合入（PR #24，main c38ae60）：auto-merge-gate.sh 无法确定性判定冲突等级时保守禁止合入（目标分支缺失/无 git 仓库/预演回退异常 → UNKNOWN），移除 git reset --hard 破坏性兑底；R4 保持已实现 |
| 2026-08-21 | 合入员 | 需求 R4 深化增强合入（PR #30，main 89400cc）：专职「合入员」NPC 决策层落地——settings.yml 新增合入员角色、新铁律 R21、合入门禁移交合入员（Stage 4）、pull_request.mergeable 增加合入员复核 + merge-blocked 否决复查、pull_request.merged 后处理 → 合入员；平台 git:auto-merge 执行层对接；R4 保持已实现 |
| 2026-08-21 | 路线图规划者 | 需求 R2 L2 缺口裁决：归零-真渡「继续推进」→ 补齐缺口①（pull_request.merged 接入 release.sh）+ 核实缺口②（CNB_EVENT 平台内置变量确认无需修改）→ 创建 PR #25 |
| 2026-08-21 | 路线图规划者 | 需求 R2 已实现（PR #25 已合入，main 4071516）：pull_request.merged 接入 release.sh 发布自动化闭环完成；CNB_EVENT 平台内置变量已核实；R2 状态→已实现 |
| 2026-08-21 | 路线图规划者 | 写入需求 R5（内存泄漏/配置失效，Issue #26，PR #28 已合入 main 7fcdf66）；R5 状态→已实现；Issue #26 已关闭（completed）；演化方向建议同步（PR #28 待合入标注移除） |
| 2026-08-21 | 合入员 | 需求 R4 深化后防线修复合入（PR #31，main 526d2bc）：push 事件「主分支构建验证」脚本显式 set +e 关闭 errexit（runner 默认 set -e 使 cd/npm 失败即终止 → 误报 error），分支判断改命令式 [ cond ] || exit，npm install || true 兜底——合入后防线「失败仅告警不阻断」语义落地；R4 保持已实现 |
| 2026-08-21 | 合入员 | 需求 R4 自动化进阶合入（PR #32，main 4af1873，feat/ci-automation-v2）：状态标签流转（pending-fix/merge-ready/merge-blocked/done 全自动状态机）+ 全流水线 timeout（防无限等待）+ tag_push 发布闭环 + crontab 定时巡视（R19/R20）；R4 深化继续递进，保持已实现 |
| 2026-08-21 | 合入员 | 需求 R4 覆盖率门禁接入合入（PR #34，main 3bfa1fc，feat/coverage-gate）：c8 替代 nyc（Node22 兼容）、test:coverage 生成 lcov.info（行覆盖率 64.26%）、.cnb.yml 接入 testing:coverage 上报（breakIfNoCoverage=false 先观察后收紧）、.gitignore 排除 coverage/、RUNBOOK/scripts README 同步；R4 深化继续递进，保持已实现 |
