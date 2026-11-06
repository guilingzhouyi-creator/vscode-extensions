# Workspace Governance & Engineering Suite (`workspace-governance`)

全工作区一体化治理、多智能体协同与研发工程套件。将工作区内离散的 <!-- METRICS:BEGIN skill-count -->**24 项**<!-- METRICS:END skill-count -->、治理规则、<!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count --> SubAgent 专员文档、四模式 DSH 治理模式族以及 MCP 工具整合为单一生命周期可控的插件包（Plugin Bundle）。

> **资产归属说明（诚实边界）**：本目录是**工作区文档与资产套件**，不是 DSH 运行时
> 插件。DSH 的插件装载只认 npm 包（profile `package.json` 的 `dsh.profile.bundles`），
> `.agents/plugins/**` 不参与 DSH 启动装配。本套件中唯一具备 DSH 运行时效力的是
> §5 的模式族，且其运行时真源是 `$DSH_HOME/.agent-presets/<preset-id>/`。

---

## 插件架构总览

```
.agents/plugins/workspace-governance/
├── plugin.json                 # 插件元数据与启动建议清单
├── README.md                   # 插件使用与架构文档
├── mcp_config.json             # 命名空间隔离的 MCP 外部服务配置
├── assets/
│   └── logo.svg                # 矢量品牌徽标 (128x128)
├── rules/
│   └── AGENTS.md               # 工作区治理总规与指针查询总枢 (SSOT)
├── agents/                     # 预设专属 SubAgent 专员（共 27 份 .md，下表为节选）
│   ├── workspace-guardian.md   # 全仓六大支柱统一审查与单源规则总看守
│   ├── infra-guardian.md       # 跨平台工程脚本与预提交双层门禁守卫
│   ├── wt-construct.md         # workspace-timing 特性研发专员
│   ├── ar-construct.md         # auto-refactor CLI/算子研发专员
│   ├── wg-construct.md         # WebGames 游戏系统研发专员
│   └── fg-construct.md         # fractal-git 存储内核研发专员
└── skills/                     # 24 项内聚研发技能全集（下表为节选）
    ├── auto-refactor-dev/      # auto-refactor 引擎与算子研发
    ├── batch-commit/           # Git 拓扑分批原子提交与风格审查
    ├── complexity-budget/      # 双轨体积、AST 复杂度与 JSDoc 预算
    ├── defensive-security-and-taint-safety/ # 污点防御与破坏操作守卫
    ├── docs-archive-governance/# 蓝图与历史全宗元数据治理
    ├── facade-discipline/      # 门面实质承载与跳板文件消融
    ├── fractal-git-dev/        # fractal-git 10 大内核子系统与 Plumbing 协议
    ├── gate-governance/        # 跨平台自动化门禁与环境隔离
    ├── release-package-workflow/# 扩展打包、热同步自愈与发布流
    ├── rule-catalog-governance/# 单源规则字典与元治理
    ├── skill-governance/       # 技能四件套架构与同构同步治理
    ├── state-concurrency-and-crash-recovery/# 原子状态事务与崩溃自愈
    ├── subagent-orchestration/ # 四重防线与 (Archetype × Posture) 编排
    ├── webgames-workflow/      # Godot 引擎配置驱动与四阶段方案流
    └── workspace-timing-dev/   # VS Code 扩展五层解耦与双语字典
```

> 本节计数以实测为准（`.agents/skills/` 与 `.agents/plugins/workspace-governance/skills/`
> 两处镜像各 <!-- METRICS:BEGIN skill-count -->**24 项**<!-- METRICS:END skill-count --> `SKILL.md`，由 `validate-skills.js` 的同构配对校验覆盖）。
> DSH 治理模式族的单源位于 [`../../dsh/bundle/`](../../dsh/bundle/)（`package.json` 声明装载入口、
> `cordis.patch.yml` 承载声明行、`guard-plugin.js` 是守卫实现、`jail-policy.json` 是策略单源），不在本目录内。

---

## 包含的核心组件

### 1. 规则集 (`rules/AGENTS.md`)
当插件处于启用状态时自动激活：
- **快速作业路由中枢**：按任务意图与作业场景即时检索权威真源（SSOT）指针；
- **刚性公理约束**：零空文件、LF/CRLF 换行规范、AST 圈复杂度 $\text{CC}\le 15$、嵌套深度 $\text{Depth}\le 4$、双轨体积 $\text{ELOC}\le 900 / \text{LOC}\le 1400$；
- **12 项一票否决红线**：路径与引用、规则防刷分、交付完整性、零黑话代号、SubAgent 四重防线、全仓零高危技术债刚性基线等。

### 2. 研发技能全集 (`skills/`)
- **`subagent-orchestration`**：通用 SubAgent 泛化调度，四重立体防线，Path Jail 物理禁区与模型同构锁定；
- **`skill-governance`**：技能工程化物理四件套结构、JIT 渐进披露与双目录同构等价治理；
- **`complexity-budget`**：代码复杂度与体积控制三轨预算治理；
- **`gate-governance`**：自动化门禁脚本工程化与跨平台隔离守卫；
- **`batch-commit`**：Git 规范化提交、分批审查与黑话禁用拦截；
- **`rule-catalog-governance`**：单源规则目录的 SSOT 字典校验与防漂移（规则数以 `scripts/common/rule-catalog.json` 的 `totalRules` 为真源）；
- **`facade-discipline`**：单行空包跳板文件消融与门面不可变冻结；
- **`release-package-workflow`**：产物自动轮转、SemVer 干净树与打包热同步；
- **`docs-archive-governance`**：顶层蓝图、交付物归档与历史全宗治理；
- **`workspace-timing-dev`**：`workspace-timing/` 扩展专有研发规范；
- **`auto-refactor-dev`**：`auto-refactor/` 静态分析引擎专有研发规范；
- **`webgames-workflow`**：`WebGames/` Godot 引擎四阶段方案与配置驱动；
- **`fractal-git-dev`**：`fractal-git/` 10 大内核子系统分层与 Plumbing 二进制协议规范；
- **`defensive-security-and-taint-safety`**：污点数据流隔离与破坏操作前置守卫；
- **`state-concurrency-and-crash-recovery`**：原子状态跃迁、重入锁与崩溃恢复。

### 3. 预设专员 Agent (`agents/`)
共 <!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count -->专员文档，按 (Archetype × Posture) 正交命名；下列为领域原型入口：
- **`workspace-guardian`**：全仓审查（`audit-all.ps1`）、规则一致性核验与物理卫生看守；
- **`infra-guardian`**：门禁脚本（`pre-commit-gate.ps1`）、子进程目录隔离巡检；
- **`wt-construct`**：`workspace-timing/` 业务特性增量构建专员；
- **`ar-construct`**：`auto-refactor/` 新分析器与原生算子研发专员；
- **`wg-construct`**：`WebGames/` 游戏逻辑与配置驱动编码专员；
- **`fg-construct`**：`fractal-git/` Crate 拓扑演进与 Rust 内核增量构建专员。

### 4. 外部工具服务 (`mcp_config.json`)
提供前缀隔离的 MCP 服务：
- `context7`：高效文档与上下文检索服务；
- `github`：GitHub 仓库交互与协作工具。

### 5. DSH 治理模式族 (Agent Preset Family)
在工作区内把 AGENTS.md 的治理公理从**提示词层**下沉到**运行时层**：四个 DSH 模式
共享同一份 Path Jail 单调守卫，守卫按调用方 Agent 的预设身份解析姿态，写权限与终端
可用性由模式装配物理决定，而非依赖模型自觉。

| 模式 id | UI 名称 | order | 姿态 | 终端 | Path Jail |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `wg-construct` | 治理·施工 | 10 | construct | 有（平台判别） | `mode: write`，授权 `workspace-timing` / `auto-refactor` / `WebGames` / `.agents` |
| `wg-refactor` | 治理·重构 | 11 | refactor | 物理裁除 | `mode: write`，授权三大受控项目 |
| `wg-review` | 治理·审查 | 12 | review | 物理裁除 | `mode: read`（写类工具一律拒绝） |
| `wg-explore` | 治理·探索 | 13 | explore | 物理裁除 | `mode: read`，另裁委派与计划模式 |

- **单源真源**：[`.agents/dsh/bundle/`](../../dsh/bundle/)（DSH bundle 包：`package.json` 声明装载入口、`cordis.patch.yml` 承载四个 `preset-wg-*` 声明行、`guard-plugin.js` 是唯一的 Path Jail 实现），另有 [sync-presets.js](../../dsh/sync-presets.js) 与五份冻结方案细则；
- **安装源**：`$DSH_PROFILE_DIR/.dsh-plugin-download/@local/dsh-workspace-governance/`，由同步脚本逐字节镜像；
- **同构校验**：`node .agents/dsh/sync-presets.js --check-only`（逐字节比对，零差异才退出码 0）；
- **姿态解析**：守卫不读自身配置，而在每次调用时用
  `agentPresets.composedPreset(agent.ctx)` 取出调用方的模式身份，再到
  `POLICY_TABLE` 单源策略表取姿态 —— 因为一个补丁代际只建立一个共享作用域，
  四个预设的守卫会被每个 `wg-*` 会话共同继承，固定配置必然互相误判；
- **禁用写权限的方式**：以 **行级 `disabled` 裁剪工具行**实现终端与编辑器面的差异，
  **不**用权限档替代 —— 权限档是会话级粗粒度开关，无法表达「可读全库、不可写任何
  文件」这一审查姿态必需语义；写权限则由守卫的 `read` 姿态在执行前拒绝；
- **生效前置**：DSH 对预设插件模块的 JavaScript 代际在同一进程内不变，替换已安装
  包后需**一次 DSH 重启**才会装载新代际；首次安装后新模式即出现在新建会话 Hero 的
  模式选择器中。详见 [`.agents/dsh/README.md`](../../dsh/README.md)。

> 模式与专员的分工：模式管**工具面与路径边界**（运行时硬约束），专员文档管
> **领域契约与验收清单**（提示词层）。两者经名称前缀对齐（`wg-`/`wt-`/`ar-`/`infra-`），
> 不互相替代。

---

## 插件生命周期管理

### 启用与禁用
在 Antigravity 插件管理页面，或者通过语言服务/配置文件控制：
- 启用插件时，插件内的全部 <!-- METRICS:BEGIN skill-count -->**24 项**<!-- METRICS:END skill-count -->、AGENTS.md 规则、MCP 工具与 <!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count -->专员文档同时激活；
- 禁用插件时，整个功能包作为一个整体彻底下线，不留残留影响。

> 上述「启用/禁用」只作用于本工作区文档套件；DSH 模式族的装载与启停由
> `$DSH_HOME/.agent-presets/` 与 DSH 启动过程决定，与本开关无关。

### 常用验证与自测命令
```powershell
# 执行全工作区六大支柱统一审查
pwsh -File scripts/ps1/audit-all.ps1 -Fast

# 验证单源规则目录一致性
node scripts/common/generate-rule-catalog.js

# 预提交双层门禁预审
pwsh -File scripts/ps1/pre-commit-gate.ps1

# DSH 治理模式族同构校验（零差异才通过）
node .agents/dsh/sync-presets.js --check-only
```
