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
│   └── host-plugin.js            # Path Jail 守卫的唯一物理实现
└── plan/                         # 冻结的四阶段方案细则与前置查证
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

**生效边界（实测结论，必须如实告知使用者）：**
DSH 对预设插件模块的 **JavaScript 代际在同一进程内不变**。已安装包被替换后，
运行中的 Host 仍执行旧代际模块——实测中更换文件名（强制新 ESM URL）与整包
remove + reinstall 两种手段都无法让新代码在运行态生效，拒绝文案始终来自旧模块。
官方技能对此有明文：「replacing an installed package requires restart to load a
fresh JavaScript module generation」。
因此**修改 `host-plugin.js` 或 `cordis.patch.yml` 后必须重启 DSH**，重启后由
新建会话 Hero 的 Agent-preset 控件选择模式。已存在的会话保留其创建时的模式。

## 四、 Path Jail 语义

守卫通过 `ctx.tools.guard(...)` 注册为**单调守卫**，在工具执行前同步判定，
返回字符串即拒绝（该字符串成为模型可见的拒绝原因），返回 `undefined` 即放行。
路径一律**按工作区相对路径归一化**（反斜杠转正斜杠、剥离 `./`、前导 `/`、盘符
前缀，解析 `.`/`..`），因此绝对路径写入不会被误判为工作区目标。

**姿态按调用方解析（关键设计）**：DSH 为每个 bundle 补丁代际建立**一个共享
作用域**，四个 preset 的挂载都落在该作用域下，因而每个 `wg-*` 会话都会继承
**全部四个守卫实例**；单调守卫「先到先拒」，任何固定配置的守卫都会把其他模式
误判。故守卫不读自身 `config`，而在每次调用时用
`agentPresets.composedPreset(execution.agent.ctx)` 取出调用方的模式身份，再到
`host-plugin.js` 的 `POLICY_TABLE` 单源策略表取姿态。未登记预设放行（不影响
非 `wg-*` 会话）。**守卫行刻意不带 `config:` 块**，避免出现「改了不生效」的漂移陷阱。

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
不可用时告警一次并按放行处理。降级是可用性选择而非安全默认。

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

## 六、 验证矩阵与实测结果

| 编号 | 验证项 | 动作 | 结果 |
| :--- | :--- | :--- | :--- |
| V1 | 同构校验 | `node .agents/dsh/sync-presets.js --check-only` | ✅ 3 份 bundle 文件字节等价 |
| V2 | 双轨体积与 ELOC 预算 | `node scripts/common/evaluate-eloc-budget.js …` | ✅ 200 ELOC / 251 LOC，密度 79.7% |
| V2b | AST 局部切片复杂度 | `node scripts/common/validate-staged-slice.js …` | ✅ CC ≤ 15 / Depth ≤ 4 / Noise ≤ 4.0 |
| V3 | 模式装配实测 | Host 以 `mode: wg-explore` / `wg-review` / `wg-construct` 开真实会话 | ✅ 会话头 `agentPreset` 与卡一致，三个模式均成功装配 |
| V4 | 姿态裁剪实测 | 审查会话工具目录核对 | ✅ `pwsh` / `bash` 均不存在（终端行裁剪生效） |
| V5 | 装配失败诊断闭环 | 逐条消除 `never started` / `waiting for workflowEngine` / `PlanModeConfig` 诊断 | ✅ 四条声明行全部 `fiberPhase: active` |
| V6 | 守卫拦截实测 | 审查模式会话内发起 `write` | ✅ 返回 `… runs the read posture` 并保持目标文件未被触碰 |
| V7 | 守卫降级 | 守卫内部异常路径 | ✅ fail-open 且仅告警一次（代码路径，未构造运行态异常） |
| V8 | 物理卫生 | 交付面 10 份文件逐一核对 LF 与字节数 | ✅ 零 CRLF、零 0 字节 |
| V9 | 全工作区统一审查 | `pwsh -File scripts/ps1/audit-all.ps1` | ⚠️ 仅剩与本改动无关的既有失败项（见下） |

**写入姿态的运行态实证尚未闭环**：按调用方解析姿态的守卫代际需要一次 DSH 重启
才能装载，重启前 `wg-construct` 的授权路径写入仍会被旧代际守卫按读姿态拒绝。
重启后应复跑两点取证：授权根内写入放行、`scripts/` 越界写入被拒。

V9 结论：审查中枢报出的失败项为既有问题，与本改动无关 ——
`.vscode/workspace-timing.journal`（0 字节运行期日志）、`auto-refactor` 套件
`validate-no-empty-scripts`（由上述同一 0 字节文件触发）与 `workspace-timing`
的既有失败。同一次审查中与本改动相关的检查全部通过：「24 对同构脚本全部合规」
「All 24 skills (84 markdown documents) verified successfully with plugin parity」。
根因须单独立项修复，不在本改动内夹带。

## 七、 防漂移纪律

| 漂移类型 | 阻断手段 |
| :--- | :--- |
| 单源与安装源字节不等 | `--check-only` 逐字节比对，非 `identical` 即失败 |
| 四模式守卫逻辑分叉 | `host-plugin.js` 单份物理实现 + `POLICY_TABLE` 单源策略表 |
| 策略「改了不生效」 | 守卫行不带 `config:`，策略只在 `POLICY_TABLE` 定义 |
| 模式 id 与既有模式撞名 | 统一 `wg-` 前缀，与存量 `liangshen` 命名空间正交 |
| 死资产冒充真源 | 已删除被 `cordis.patch.yml` 取代的旧目录格式产物；`.agent-presets/` 下的同名旧目录已清理 |
| 文档与运行时不符 | 本 README 的技能数、文件数、验证结论均按实测值登记 |

## 八、 版本受控边界与本地专属面

**仓库受版本控制的一侧**（`git ls-files` 可核验）：`.agents/dsh/**`、
`.agents/skills/**`、`.agents/subagents/**` 与工作区根 `AGENTS.md`。

**本地专属、不入库的一侧**：`.gitignore` 第 27 行忽略 `.agents/plugins/`，
`git ls-files .agents/plugins` 返回 0 项。该目录内的登记与镜像只存在于本机
文件系统，不随克隆分发，也不构成真源。

**当前实测计数**：工作区技能 `SKILL.md` 共 **24** 份（`.agents/skills/` 与
`.agents/plugins/workspace-governance/skills/` 两处镜像各 24 份）；
`workspace-governance` 插件内专员文档 **23** 份；该插件文件总数 **134** 份；
规则目录 `scripts/common/rule-catalog.json` 收录 **428** 条规则。
