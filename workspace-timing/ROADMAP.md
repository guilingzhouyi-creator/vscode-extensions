# 路线图 / Roadmap

> Workspace Timing (VSCode 扩展) 功能演进路线图。性能与健壮性工作已在 0.3.2–0.3.7 完成，下一步聚焦功能扩展。
> Workspace Timing (VSCode extension) feature roadmap. Perf & robustness work landed in 0.3.2–0.3.7; next phase is feature growth.

## 优先级说明 / Priority tiers

- **P0** — 填缺口 / 防回归（基础件，本轮列为计划但未实现）
- **P1** — 本轮选定实现（高性价比新功能）
- **P2** — 暂不计划（按 2026-08-12 决定不做）

---

## P0 — 计划内（未在本轮实现）/ Planned, not in this cycle

| 项 | 说明 | 状态 |
|----|------|------|
| 效率与每日活跃历史持久化 | `dailyActiveSeconds`/`dailyIdleMs` 当前为内存态、重启归零（README 已知限制）。持久化后周报/效率可反映历史 | 计划中 |
| 聚合核心单元测试 | `package.json` 已接 mocha（`npm test`），但 `src` 下无 `*.test.ts`。保护频繁改动的 `TimeAggregator`/`TimerEngine`/`SessionManager` | 计划中 |

---

## P1 — 本轮选定（已全部实现于 0.3.8）/ Selected for this cycle — Done in 0.3.8

| 项 | 说明 | 依赖 |
|----|------|------|
| **P1-1 活动时间线 / 热力图** | 基于已采集的每日时长（`finishedSessionsByDate` 全量分桶）渲染近 12 周 GitHub 式热力图；零新增采集成本 | 无（复用现有 sessions[]） |
| **P1-2 月报 + 更多导出** | 周报导出泛化为「周期报告」（周/月）；新增 JSON 全文导出；新增「定时自动导出」（配置化间隔 + 目标路径 + 格式） | 无 |
| **P1-3 周目标 + 连续打卡** | 在每日目标之外新增「每周目标」；追踪连续达标天数（streak），达标时桌面通知 | 无（复用每日目标判定） |

实现状态：
- P1-1 活动时间线 / 热力图 — ✅ 已实现（0.3.8）
- P1-2 月报 + JSON + 定时导出 — ✅ 已实现（0.3.8）
- P1-3 周目标 + streak — ✅ 已实现（0.3.8）

---

## P2 — 暂不计划 / Deferred (not planned, per 2026-08-12)

| 项 | 说明 | 备注 |
|----|------|------|
| 长周期趋势图（近 30/90 天） | 与 P0 持久化协同，P0 未做前价值有限 | 搁置 |
| 番茄钟 / 休息提醒 | 基于聚焦/闲置检测延伸 | 搁置 |
| 跨工作区洞察 | 「耗时最多项目」、时间占比 | 搁置 |
| 更广的活跃检测 | 鼠标/真·afk（需权衡当前「非键盘记录器」定位） | 搁置（隐私敏感） |

---

## 里程碑 / Milestones

- `0.3.2–0.3.7` — 性能与健壮性：聚合 O(n²) 修复、journal 增量、缓存、调度器、周报体系、性能微优化与防重入守卫
- `0.3.8+` — P1 功能批次（热力图 / 月报+JSON+定时导出 / 周目标+streak）
- 后续 — 视反馈决定是否启动 P0 或重新评估 P2

分支：`fix/perf-robustness-review`（功能批次仍在此分支演进，按仓库整版本提交规范）
