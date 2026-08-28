# 🏷️ 标签体系 | Label System

> 本仓库的**统一标签体系**文档：定义标签分类、命名规范与自动打标签规则。
> 配套自动化程序：`scripts/sh/auto-label.sh`（Issue/PR 创建时自动定位类型并打标签）。
> **DRI（主维护责任人）：路线图规划者**（按 `.cnb/NPC-约定索引.md` 指针加载）。

---

## 一、设计原则

1. **多维分类**：用「维度前缀 + 值」命名，标签可多维叠加、互不冲突，筛选灵活。
2. **机器可读**：命名使用小写英文 + 短横线 `-`，便于自动化程序精确匹配与去重。
3. **人性化展示**：页面展示时保留可读名，如 `type/bug`（🐛 缺陷）。
4. **幂等**：同一 Issue/PR 不重复打同一标签（脚本自动去重）。
5. **单主类型**：每个 Issue/PR **必有一个 `type/*` 主类型**，其余维度可选叠加。

---

## 二、标签维度总览

| 维度前缀 | 含义 | 是否必选 | 示例 |
|----------|------|:---:|------|
| `type/`    | 问题/需求类型（自动定位核心） | ✅ 必选 | `type/bug` |
| `priority/`| 优先级 | ⭕ 可选 | `priority/high` |
| `status/`  | 处理状态 | ⭕ 可选 | `status/todo` |
| `module/`  | 涉及模块 | ⭕ 可选 | `module/workspace-timing` |
| `scope/`   | 适用范围（Issue / PR） | ⭕ 可选 | `scope/issue` |

---

## 三、标签明细

### 3.1 类型 type/（定位问题类型的核心维度）

> 自动化程序依据标题/描述关键词自动命中下表，命中即打对应标签。

| 标签 | 名称 | 含义 | 命中关键词（规则示例） |
|------|------|------|------------------------|
| `type/bug` | 🐛 缺陷 | 功能异常、崩溃、报错 | `bug`、`异常`、`崩溃`、`报错`、`error`、`fail`、`crash`、`不工作`、`无法`、`失效` |
| `type/security` | 🔒 安全 | 安全漏洞 / 越权 / 注入 | `security`、`安全`、`漏洞`、`vuln`、`注入`、`越权`、`权限绕过`、`xss`、`csrf`、`认证`、`加密` |
| `type/feature` | ✨ 新功能 | 全新能力 / 需求 | `feature`、`新功能`、`需求`、`新增`、`支持`、`实现` |
| `type/enhancement` | 🚀 增强 | 对既有功能的改进 | `enhance`、`优化`、`改进`、`提升`、`增强`、`improve` |
| `type/docs` | 📄 文档 | README / 文档 / 注释 | `docs`、`文档`、`readme`、`说明`、`文档`、`document` |
| `type/refactor` | ♻️ 重构 | 不改变行为的结构调整 | `refactor`、`重构`、`重写`、`清理`、`cleanup` |
| `type/performance` | ⚡ 性能 | 性能优化 / 卡顿 | `性能`、`卡顿`、`性能优化`、`performance`、`慢`、`内存` |
| `type/test` | 🧪 测试 | 测试相关 | `test`、`测试`、`用例`、`单测`、`lint` |
| `type/question` | ❓ 疑问 | 提问 / 咨询 | `?`、`怎么`、`如何`、`请教`、`为什么`、`question` |
| `type/epic` | 🗺️ 大型需求 | 里程碑 / 总体目标 / 多阶段 | `epic`、`里程碑`、`总体`、`roadmap`、`大点`、`多阶段`、`系列` |
| `type/chore` | 🔧 杂务 | 构建 / CI / 依赖 / 工程 | `ci`、`构建`、`流水线`、`依赖`、`chore`、`脚手架` |

> **兜底规则**：以上关键词均未命中时，默认打 `type/chore` 并附 `status/triage`（待人工确认）。

### 3.2 优先级 priority/

| 标签 | 含义 |
|------|------|
| `priority/urgent` | 🔴 紧急：阻塞 / 生产事故，立即处理 |
| `priority/high` | 🟠 高：重要且紧急 |
| `priority/medium` | 🟡 中：默认 |
| `priority/low` | 🟢 低：可延后 |

### 3.3 状态 status/

| 标签 | 含义 |
|------|------|
| `status/triage` | 🏷️ 待人工确认（自动分类兜底时使用） |
| `status/todo` | 📋 待处理 |
| `status/in-progress` | 🔄 处理中 |
| `status/blocked` | ⛔ 阻塞中 |
| `status/done` | ✅ 已完成 |
| `status/invalid` | 🚫 无效 / 非本仓库范围 |
| `status/merge-ready` | ✅ 可自动合入（「合入员」判定门禁全绿 + C0 准入后打标，放行平台 `git:auto-merge`） |
| `status/merge-blocked` | 🛑 合入否决（「合入员」发现阻断项 / 人工否决时打标；存在即阻断自动合入，须人工解除） |
| `status/pending-fix` | 🔧 待修改（门禁任一失败时由 failStages 自动打标；修复后合入员复核，合入后自动清除） |

### 3.4 模块 module/

| 标签 | 含义 |
|------|------|
| `module/workspace-timing` | 工作区时长追踪插件 |
| `module/ci` | 云原生构建 / 流水线 |
| `module/npc` | NPC 协作体系 / 约定文档 |
| `module/docs` | 仓库文档 / README |

### 3.5 范围 scope/

| 标签 | 含义 |
|------|------|
| `scope/issue` | Issue 适用 |
| `scope/pr` | PR 适用 |

---

## 四、自动打标签流程

```
Issue 创建 / 内容变更 / PR 创建·更新
    │
    ▼
自动触发 .cnb.yml 中 issue.open / issue.update / pull_request 事件
    │
    ▼
执行 scripts/sh/auto-label.sh（v2 增强版）
    │
    ├─ 1. 读取 CNB_ISSUE_TITLE / CNB_ISSUE_DESCRIPTION
    ├─ 2. 规则引擎关键词匹配 → 判定 type/*（主类型，必选）
    ├─ 3. 附带维度判定：priority / status / module / scope
    ├─ 4. 内容变更（issue.update）→ 先查当前标签，保留人工打的非类型标签，
    │     再与本次新标签合并后全量覆盖（put-issue-labels）去旧加新
    └─ 5. 新增场景（issue.open / pull_request）→ 调用 CNB API（post-*-labels）幂等追加
    │
    ▼
输出【打标签结论】+【唤醒提示】（供规划者确定性通道接管巡视）
```

---

## 五、使用说明

- **人工打标签**：可在页面手动添加/移除任意维度标签。
- **自动化**：Issue 创建、PR 创建/更新时自动执行分类脚本（见 `.cnb.yml` 配置）。
- **规则扩展**：新增关键词 / 标签时，修改 `scripts/sh/auto-label.sh` 中的映射表即可，无需改流水线。
- **版本记录**：本文件与脚本同步维护，变更需在 `scripts/sh/README.md` 变更日志登记。

---

## 六、变更日志

| 时间 | 操作者 | 变更摘要 |
|------|--------|---------|
| 2026-08-21 | CodeBuddy | 建立统一标签体系（5 维度 / 30+ 标签），配套自动分类脚本与流水线接入 |
| 2026-08-21 | CodeBuddy | v2 增强：新增 `type/security`、`type/epic` 类型；脚本支持 issue.update 去旧加新重分类；修正易误判关键词 |
| 2026-08-21 | CodeBuddy | 新增 `status/merge-ready`（合入员放行）与 `status/merge-blocked`（合入否决）标签，配套专职「合入员」NPC 自动合入系统 |
| 2026-08-21 | CodeBuddy | 新增 `status/pending-fix`（门禁失败自动打标）标签，配套 failStages 失败升级链与合入后状态回收 |
