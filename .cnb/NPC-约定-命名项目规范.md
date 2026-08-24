# NPC 约定 · 分册六：命名约定与项目规范

> 由 `.cnb/NPC-约定索引.md`（铁律 + 指针地图）索引。开工、创建文件/分支/PR、写代码时加载本分册。
> 与索引铁律冲突时，以索引为准。
> **读取范围**：必读区 §1 命名约定；选读区 §2 项目规范 / §3 违规处理（需要时）。禁止通读全文。

---

## 1. 命名约定（全体系统一 · 打勾检查）

### 1.1 NPC 与文档命名

| 对象 | 命名规则 | 示例 | 检查项 |
|------|---------|------|--------|
| NPC 角色名 | `协作员·<领域>` / `路线图规划者` | 协作员·构建 | `[ ]` 与 settings.yml 完全一致 |
| 约定分册 | `NPC-约定-<主题>.md` | NPC-约定-协作流程.md | `[ ]` 以 `NPC-` 前缀 |
| 意图 ID | `意图 #<编号>` | 意图 #5 | `[ ]` 递增不重复 |
| 大点 ID | `M<n>` | M1 | `[ ]` 每意图内递增 |
| TODO 表 ID | `TB-<大点ID>-<领域>` | TB-M1-B | `[ ]` B=构建/T=测试/R=审查 |
| 任务 ID | `T<大点ID>-<领域><序号>` | T1-B3 | `[ ]` 依赖可追溯 |
| 需求 ID | `R<n>` | R7 | `[ ]` 全局递增不重复 |

### 1.2 代码与 Git 命名

```
☐ [ ] 分支：<type>/<scope>-<简述>，如 feat/timing-export、fix/storage-journal
☐ [ ] 提交信息：<type>(<scope>): <简述>，如 fix(cache): 修复环形缓冲区覆写
☐ [ ] type 取值：feat / fix / refactor / docs / test / chore / style
☐ [ ] 文件名：kebab-case（连字符小写），如 time-aggregator.ts
☐ [ ] 类名：PascalCase（大驼峰），如 TimeAggregator
☐ [ ] 函数/变量：camelCase（小驼峰），如 getWeeklyReport
☐ [ ] 常量：UPPER_SNAKE_CASE，如 MAX_RING_BUFFER_CAPACITY
☐ [ ] PR 标题：<type>(<scope>): <简述>（与提交信息一致）
☐ [ ] Issue/PR 内引用：意图 #<ID> / 需求 R<ID> / 大点 M<ID> 必须可追溯
```

### 1.3 评论与命令命名（引导式命令）

```
☐ [ ] 领取：【领取】<单元ID> + <领域> + <计划用时>
☐ [ ] 交接：【交接】<单元ID> + <产物路径> + <接口契约> + 【唤醒】@<下游>
☐ [ ] 唤醒：【唤醒】@<NPC>：<交接物/结论> + <请你执行的部分>
☐ [ ] 冲突：【冲突上报】+【冲突方】+【冲突点】+【建议方案】+【状态】
☐ [ ] 讨论：【约定讨论】<主题>：现状 + 问题 + 建议修改
☐ [ ] 输出：【执行清单】逐项 [x]/[ ] 回显
```

---

## 2. 项目规范（本仓库 workspace-timing）

### 2.1 技术栈与结构

```
☐ [ ] 语言：TypeScript（strict 模式）
☐ [ ] 构建：npm run compile（tsc -p ./）
☐ [ ] 质量：npm run lint（eslint）
☐ [ ] 分层架构：domain → cache → persistence → application → presentation
☐ [ ] 目录职责：
       src/domain/      纯领域模型（无 VS Code 依赖）
       src/cache/       缓存层（10 秒异步刷盘）
       src/persistence/ 持久化（Journal + JSON + GlobalState）
       src/application/ 应用业务逻辑
       src/presentation/表现层（Dashboard + StatusBar + Toast）
```

### 2.2 代码规范（打勾检查单）

```
☐ [ ] strict 模式：无隐式 any、无未使用变量
☐ [ ] 领域层不 import vscode（保持纯净可测）
☐ [ ] 错误处理：核心路径 try/catch + 日志，不吞异常
☐ [ ] 存储：RingBuffer(1024) → Journal(NDJSON) → FullSave(JSON) 三级写入
☐ [ ] 崩溃安全：Journal 先写后删，保证数据可恢复
☐ [ ] 国际化：文案走 i18n（zh-CN / en），不硬编码
☐ [ ] 类型导出：跨层类型从 domain 统一导出
☐ [ ] 改动最小化：只改意图相关的文件，不做无关重构
```

### 2.3 门禁（见门禁治理分册第 1 章）

```
☐ [ ] npm install → compile → lint → diff 全绿才可宣称完成
```

### 2.4 提交与 PR 规范

```
☐ [ ] 一次提交只做一件事（可独立回滚）
☐ [ ] 提交信息含意图引用：feat(timing): 实现周报导出（意图 #5）
☐ [ ] PR 描述含：改动摘要 + 门禁结果 + 两圈收敛结论 + 关联意图/需求 ID
☐ [ ] 不提交产物文件（out/ 由构建产生，不入库）
☐ [ ] 不提交 node_modules / .vscode 临时文件
```

---

## 3. 违规处理

- 命名/规范违规 → 审查阶段发现即定点修正（`[ ]` 改为 `[x]` 需真实修正后勾选）。
- 多次违规同一项 → 在 Issue 评论提出【约定讨论】补充细化规则。
- 项目规范冲突 → 以 `.cnb/NPC-约定-命名项目规范.md` 为准；与约定索引冲突时以索引铁律为准。
