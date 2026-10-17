# DSH 工作区治理模式族（Agent Preset Family）

> 本目录是四个 DSH 模式（Agent Preset）与自研 Path Jail 守卫插件的**仓库内单源真源**。
> 真源是一个 **DSH bundle 包**（`bundle/`），经
> [sync-presets.js](sync-presets.js) 逐字节镜像到安装源目录，再经 DSH 的
> Plugin Manager 安装生效。二者必须字节等价。

## 一、 模式族总表

| 模式 id | UI 名称 | order | 姿态 | 工具面差异 | Path Jail |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `wg-construct` | 治理·施工 | 10 | construct | 读写 fs + 编辑器组 + 终端 + 计划模式 + 委派 | `write`，授权四大根 |
| `wg-refactor` | 治理·重构 | 11 | refactor | 读写 fs + 编辑器组，**终端物理裁除** | `write`，授权三项目根 |
| `wg-review` | 治理·审查 | 12 | review | 只读 fs，**编辑器组与终端裁除** | `read` |
| `wg-explore` | 治理·探索 | 13 | explore | 只读 fs，**编辑器组、终端、计划模式、委派裁除** | `read` |

四个模式覆盖 [AGENTS.md](../../../AGENTS.md) 公理 6 的五种姿态：`guardian` 由
`wg-refactor` 的写姿态承载（守护面需调度门禁工具链，只读姿态无法执行脚本），
不单设第五个高度同构的模式。

**关键澄清**：审查与探索姿态的写权限防线是 **Path Jail 守卫**，不是工具缺失。
`write` / `edit` 仍在工具目录中，但被守卫在执行前拒绝。以「删工具」代替守卫会
使模型无法区分「工具不存在」与「路径越界」，并把姿态差异退化为装配差异。

## 二、 目录结构与装载机制

```
.agents/dsh/
├── README.md                     # 本文件
├── sync-presets.js               # 单源 → 安装源的同构镜像与校验
├── bundle/                       # 单源 bundle 包（DSH 装载的真源）
│   ├── package.json              # name/version + dsh.bundle.patch 声明
│   ├── cordis.patch.yml          # 四个 preset 声明行（config.plugins 为模式装配）
│   └── guard-plugin.js           # Path Jail 守卫的唯一物理实现
└── plan/                         # 冻结的四阶段方案细则（04 第七节并入原前置查证）
```

装载链路（旧版的 `$DSH_HOME/.agent-presets/<id>/` 目录格式**已被 DSH 废弃**，
DSH 官方技能原文为 “Nothing reads that directory any more.”，故本目录不再产出该格式）：

1. `bundle/package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`；
2. `cordis.patch.yml` 用 `- insert:` 插入四个 `preset-wg-*` 声明行，每行的
   `config` 携带 `id` / `name` / `description` / `order` / `plugins`；
3. `plugins` 数组的 `name` **只能写已安装包名、`cordis:group` 或包内子路径**。
   相对路径与包根导出之外的写法会以 `never started` 告终（已实测证否），
   故守卫行写作 `'@local/dsh-workspace-governance'`（包根导出）。

## 三、 部署、安装与同构校验

```bash
# 单源 → 安装源镜像（$DSH_PROFILE_DIR/.dsh-plugin-download/<包名>）
node .agents/dsh/sync-presets.js --deploy

# 同构校验（零差异退出码 0；缺失或漂移逐条打印并退出码 1）
node .agents/dsh/sync-presets.js --check-only
```

安装与重放由 DSH 的 Plugin Manager 负责（不得用 shell 复现）：

- 首次安装：`plugin_manager install_bundle`，target 为 `bundle/` 目录；
- 补丁更新后重放：`plugin_manager set_bundle` 先 `enabled: false` 再 `enabled: true`；
  对**已安装**的 bundle 重复 `install_bundle` 会返回 `ambiguous-install`，不可用于重放。

**两份副本的角色（如实区分）**：安装后 `$DSH_PROFILE_DIR/node_modules/@local/dsh-workspace-governance`
是指向本仓库 `bundle/` 的符号链接（实测 Target 为 `..\..\..\..\..\..\..\CODE_game-development\vscode-extensions\.agents\dsh\bundle`）；
`.dsh-plugin-download/<包名>/` 则是 `install_bundle` 的安装源快照，`--check-only`
比对的是它。宿主运行时究竟从哪一侧解析模块**未做运行态取证**——两侧保持字节等价，
因此无论走哪条路径读到的都是同一份实现。若只手工改了仓库内文件而漏跑 `--deploy`，
`--check-only` 会立刻报漂移——这正是它存在的价值，而非「已部署」的证明。

**生效边界（实测结论，必须如实告知使用者）：**
DSH 对预设插件模块的 **JavaScript 代际在同一进程内不变**。已安装包被替换后，
运行中的 Host 仍执行旧代际模块——实测中更换文件名（强制新 ESM URL）与整包
remove + reinstall 两种手段都无法让新代码在运行态生效，拒绝文案始终来自旧模块。
官方技能对此有明文：「replacing an installed package requires restart to load a
fresh JavaScript module generation」。
因此**修改 `guard-plugin.js` 或 `cordis.patch.yml` 后必须重启 DSH**，重启后由
新建会话 Hero 的 Agent-preset 控件选择模式。已存在的会话保留其创建时的模式。

## 四、 Path Jail 语义

守卫通过 `ctx.tools.guard(...)` 注册为**单调守卫**，在工具执行前同步判定，
返回字符串即拒绝（该字符串成为模型可见的拒绝原因），返回 `undefined` 即放行。
路径一律**按工作区相对路径归一化**（反斜杠转正斜杠、剥离 `./`、前导 `/`、盘符
前缀，解析 `.`/`..`），因此绝对路径写入不会被误判为工作区目标。

**姿态按调用方解析（关键设计）**：四个声明行共用同一份物理实现，策略只在
`guard-plugin.js` 的 `POLICY_TABLE` 登记一份。守卫在每次调用时用
`agentPresets.composedPreset(execution.agent.ctx)` 取出调用方的模式身份，再到该表取
姿态，因此判定与「由哪个挂载实例处理这次调用」「挂载顺序」「注册域归属」全部无关；
未登记预设放行（不影响非 `wg-*` 会话）。

> 纠错留痕：早期版本曾把「`wg-construct` 的授权写入被读姿态拒绝」误诊为
> 「四个声明行共享进程级守卫注册表、按注册域区分的姿态互相泄漏」。该结论**已作废**：
> 真正原因是 `writePostureReason` 缺失姿态卫语句（见第六节修复记录），与作用域无关。
> 按调用方解析并非为了绕开泄漏，而是为了让策略保留单一真源、避免四份配置各自漂移。

守卫行另带 `config.preset` 作为**模式身份标签**：它只在 `agentPresets` 注册表不可用
的降级路径上充当姿态兜底，正常判定一律以调用方实时身份为准。标签不表达任何授权面，
改它不会放宽或收紧任何路径；策略变更只改 `POLICY_TABLE`。

判定次序：

1. 工具名命中 `deniedTools` → 拒绝；
2. `mode: read` 且工具属于写类（`write` / `edit` / `str_replace_editor` /
   `notebook_edit`）→ 拒绝；
3. 目标路径命中 `denyRoots` → 拒绝（**deny 优先于 allow**）；
4. `allowRoots` 为空 → 放行；否则须命中其一，未命中即拒绝。

各模式授权面（工作区相对根）：

| 模式 | allowRoots | denyRoots |
| :--- | :--- | :--- |
| `wg-construct` | `workspace-timing`, `auto-refactor`, `WebGames`, `.agents` | `scripts`, `archive`, `.git` |
| `wg-refactor` | `workspace-timing`, `auto-refactor`, `WebGames` | `scripts`, `archive`, `.git` |
| `wg-review` / `wg-explore` | 空（read 姿态遍历全库） | 空 |

**健壮性契约**：策略表按姿态预编译（根列表归一化一次，`deniedTools` 预建
`Set`），调用路径保持无 I/O、无异步；守卫自身异常降级为**放行**并
`logger.warn` 只告警一次，绝不因守卫缺陷阻断整个会话；`agentPresets` 注册表
不可用时告警一次，并退化为按声明行 `config.preset` 标签取证（标签也缺失才放行）。
降级是可用性选择而非安全默认。

`deniedTools` 在当前四个策略里均为**空集**：它是守卫的预留能力面（按工具名整类
禁用），未启用即不产生任何判定分支。保留而不删除，是为了让「禁用某类工具」与
「限制路径」能在同一张表里表达；启用前必须先在验证矩阵补一条对应样本。

## 五、 刻意省略与已知边界

- **脚本化工作流**：四个模式均不声明 `@deepseek-ai/dsh-workflow-ptc` 与
  `@deepseek-ai/dsh-tool-workflow`。实测在 bundle 声明的预设作用域内
  `workflowEngine` 无法被提供（`waiting for workflowEngine`），保留会使整个
  预设拒绝装配。需要脚本化编排时改用 shipped `standard` 预设。
- **子专员委派保留**：`tool-subagent`（spawn/fork）、`tool-subagent-control` 与
  `list-agents` 正常装配，是治理要求的委派能力。
- **宿主级工具可见**：profile 安装的其他 bundle（Agent Teams、任务看板）的工具
  会出现在预设会话中，属宿主组合的正常行为，非本模式族的工具面。
- **模型同构**：四个模式均不声明 `modelSelectionSettings`，使子专员严格继承主
  会话模型配置（AGENTS.md 公理 6）。
- **治理面写入由主会话承担**：`wg-construct` 的授权根只到三大受控项目与 `.agents`，
  刻意不含工作区根 `AGENTS.md`、`docs/`、`.github/`、`scripts/`、`archive/`。
  理由是最小权限：治理总规、门禁脚本与 CI 拓扑属于「可改写自身规则」的高危面，
  不应交给受限执行者。红线 1 要求重命名时做全仓五维引用闭环，若引用点落在上述
  路径，该部分由**主会话（非 `wg-*` 模式）**执行；`denyRoots` 里的 `scripts`、
  `archive` 同理（含 `scripts/common/rule-catalog.json` 元治理）。
- **重构模式的自检外置**：`wg-refactor` 保留 `tool-bash` / `tool-pwsh` 声明行但
  `disabled: true`，故重构专员**不能自行跑构建与测试**，只能声明验证命令，由主
  Agent 执行。这是比「SubAgent 交割前自主闭环三重验证」更严的落地：专员无法用
  自选单测证明完成，「测试通过非达标」从提示词纪律升级为物理不可伪造；主 Agent 的
  四重交叉复审仍是唯一放行通道。
- **两种只读模式的能力差异（有意，非遗漏）**：`wg-review` 保留委派与 `tool-todo`
  （支持对抗性复审与任务清单），但无 `present`——审查结论以文本交付；`wg-explore`
  最精简，无委派、无 `tool-goal` / `tool-todo` / `present`（探索只需读取与检索）。
  需要写交付卡片的场景改用 `wg-construct`。

## 六、 验证矩阵与实测结果

| 编号 | 验证项 | 动作 | 结果 |
| :--- | :--- | :--- | :--- |
| V1 | 同构校验 | `node .agents/dsh/sync-presets.js --check-only` | ✅ 3 份 bundle 文件字节等价 |
| V2 | 双轨体积与 ELOC 预算 | `node scripts/common/evaluate-eloc-budget.js …` | ✅ 206 ELOC / 257 LOC，密度 80.2% |
| V2b | AST 局部切片复杂度 | `node scripts/common/validate-staged-slice.js …` | ✅ CC ≤ 15 / Depth ≤ 4 / Noise ≤ 4.0 |
| V3 | 模式装配实测 | Host 以 `mode: wg-explore` / `wg-review` / `wg-construct` 开真实会话 | ✅ 会话头 `agentPreset` 与卡一致，三个模式均成功装配 |
| V4 | 姿态裁剪实测 | 审查会话工具目录核对 | ✅ `pwsh` / `bash` 均不存在（终端行裁剪生效） |
| V5 | 装配失败诊断闭环 | 逐条消除 `never started` / `waiting for workflowEngine` / `PlanModeConfig` 诊断 | ✅ 四条声明行全部 `fiberPhase: active` |
| V6 | 守卫拦截实测 | 审查模式会话内发起 `write` | ✅ 返回 `… runs the read posture` 并保持目标文件未被触碰 |
| V7 | 守卫降级 | 守卫内部异常路径 | ✅ fail-open 且仅告警一次（代码路径，未构造运行态异常） |
| V8 | 物理卫生 | 交付面 9 份文件逐一核对 LF 与字节数 | ✅ 零 CRLF、零 BOM、零 0 字节 |
| V9 | 全工作区统一审查 | `pwsh -File scripts/ps1/audit-all.ps1` | ⚠️ 综合 99.34（A+）；唯一未通过项为 `scratch/` 内被 gitignore 的临时草稿文件（见下） |
| V10 | 守卫判定离线矩阵 | 伪造 ctx 直调 `apply`，四调用方 × 授权/越权/禁用根/读类样本 | ✅ 全部判定分支与设计一致 |
| V11 | 写姿态运行态复核 | `mode: wg-construct` 会话内三次写入 | ⏳ 待一次 DSH 重启后执行（宿主模块解析映射不可变） |

**守卫判定缺陷与修复记录（离线矩阵已闭环）**：`writePostureReason` 曾缺失姿态
卫语句（只要工具属写类即无条件返回读姿态拒绝），使写姿态模式的全部写入被误判为
读姿态拒绝。离线单元测试对四个调用方逐一复现后，已补入
`if (policy.mode !== MODE_READ) return undefined` 并回归全矩阵：`wg-construct`
授权根放行、`denyRoots` 拒绝、越权根拒绝；`wg-refactor` 项目根放行、`.agents`
拒绝；`wg-review` / `wg-explore` 写类一律读姿态拒绝；未登记预设放行；读姿态不拦
读类工具。该缺陷此前曾被误诊为「跨预设守卫作用域泄漏」——宿主侧每个预设定义
`const key = {}` 生成独一无二的作用域键，跨预设污染不可能发生。

**模块代际装载边界（实测，三重证否）**：同一 Host 进程内更换插件模块代际无效。
三条路径逐一证否：①整包 `remove_bundle` 后重装 `install_bundle`；②`set_bundle`
关闭再开启；③更换 `exports` 指向的文件名以取得全新 ESM URL。三者之后运行态
仍执行旧代际代码（同一取证会话得到与改动前**逐字相同**的拒绝行为），根因是宿主在
启动时构建**不可变的运行时模块解析映射**，进程内不会重新解析。故守卫逻辑变更的
作业流程为：改 `guard-plugin.js` → `--deploy` → 重启 DSH → 以 `mode: wg-*` 的
取证会话复核。拒绝文案不含任何版本、代际或施工批次代号（红线 4），判定代际只能
依赖行为差异，不依赖文案里的标记。

**待复核对项**：V11 是唯一的运行态未闭环项。当前运行态仍执行修复前的守卫代际，
故 `wg-construct` / `wg-refactor` 的授权写入会被旧代码按读姿态拒绝；重启 DSH 后
同一取证会话应得「授权根放行、`scripts/` 拒绝、`docs/` 拒绝」三行结果。其余 V1–V10
结论不受该代际问题影响（离线矩阵直接调用磁盘上的现行实现）。

V9 结论（提交 `c711798` 时点的全量审查）：综合健康分 99.34（A+），技术债 5536 项，
五项基石得分 物理卫生 99.5 / 单源规则目录 100.0（468 规则）/ auto-refactor 99.09 /
workspace-timing 98.1 / WebGames 100.0。唯一未通过项是
`node scripts/common/validate-physical-hygiene.js` 的 `HYG-TRL-001`（POSIX 单 EOF
换行）：受检 3327 个文件中命中 9 处，全部位于 **`scratch/`** ——该目录被
`.gitignore:91` 整体忽略、`git ls-files scratch` 为 0 项，属本机临时草稿，不在本
改动的交付面内，故未代为修改（红线 11：不得触碰授权面之外的他人文件）。
早前记录的 `.vscode/workspace-timing.journal` 零字节违规在该时点已不复存在
（该运行期日志已增长到 262972 字节），由它连带触发的 auto-refactor
`validate-no-empty-scripts` 失败亦随之消失。与本改动直接相关的检查在该次审查中
均为 PASS：「24 对同构脚本全部合规」「All 25 skills (90 markdown documents)
verified successfully with plugin parity」。

## 七、 防漂移纪律

| 漂移类型 | 阻断手段 |
| :--- | :--- |
| 单源与安装源字节不等 | `--check-only` 逐字节比对，非 `identical` 即失败 |
| 四模式守卫逻辑分叉 | `guard-plugin.js` 单份物理实现 + `POLICY_TABLE` 单源策略表 |
| 策略「改了不生效」 | 策略只在 `POLICY_TABLE` 定义；声明行的 `config.preset` 仅是身份标签，不承载策略 |
| 声明行标签与策略表不一致 | 标签只在注册表不可用时兜底；正常判定以调用方实时身份为准，标签写错不会放宽任何路径 |
| 模式 id 与既有模式撞名 | 统一 `wg-` 前缀，与存量 `liangshen` 命名空间正交 |
| 死资产冒充真源 | 已删除被 `cordis.patch.yml` 取代的旧目录格式产物；`.agent-presets/` 下的同名旧目录已清理 |
| 文档与运行时不符 | 本 README 的技能数、文件数、验证结论均按实测值登记 |
| 守卫判定逻辑回归 | 离线单元测试矩阵（四个调用方 × 授权/越权/禁用根/读类样本）覆盖全部判定分支 |

## 八、 版本受控边界与本地专属面

**仓库受版本控制的一侧**（`git ls-files` 可核验）：`.agents/dsh/**`、
`.agents/skills/**`、`.agents/subagents/**` 与工作区根 `AGENTS.md`。

**本地专属、不入库的一侧**：`.gitignore` 第 27 行忽略 `.agents/plugins/`，
`git ls-files .agents/plugins` 返回 0 项。该目录内的登记与镜像只存在于本机
文件系统，不随克隆分发，也不构成真源。

**当前实测计数**：工作区技能 `SKILL.md` 共 **25** 份（`.agents/skills/` 与
`.agents/plugins/workspace-governance/skills/` 两处镜像各 25 份）；
`workspace-governance` 插件内专员文档 **23** 份；该插件文件总数 **134** 份；
规则总数**不在本文硬编码**，唯一真源是 `scripts/common/rule-catalog.json` 的
`totalRules` 字段（该文件由规则生成器自动重写，硬编码必然漂移）。
