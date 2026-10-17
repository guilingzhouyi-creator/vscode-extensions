> **实施后修正（以 bundle 事实为准）**：本细则成文于旧目录格式时期，其中 `$DSH_HOME/.agent-presets/<id>/` 目录、`preset.yml` 与 `agent.cordis.yml` 双文件、`shared/jail.mjs` 分片镜像等描述**已作废**。现行真源为 `bundle/` 下的 `package.json`、`cordis.patch.yml`、`guard-plugin.js` 三件；装载机制、生效边界（模块代际需重启 DSH）与验证结论见 [../README.md](../README.md)。细则的约束意图（工具裁剪矩阵、守卫判定次序、可观测性、防漂移）仍然有效。
# 阶段一细则：Preset 契约与仓库内单源蓝图

> 本文件为「工作区治理模式族」落地细则的第一阶段，定义 Agent Preset 的物理契约、单源目录结构与命名规范。
> 上游依据：`AGENTS.md` §二公理 6、§五 SOP 第 2 步；`.agents/subagents/subagent-catalog.json`（archetypes 6 × postures 5）。
> 本阶段不产出可执行代码，仅冻结契约；契约冻结后方可进入阶段二。

---

## 一、阶段目标

1. 冻结 DSH Agent Preset 的物理目录契约与四模式命名；
2. 冻结 `.agents/dsh/presets/` 单源目录结构，确立「仓库内单源 → DSH_HOME 镜像」的防漂移模型；
3. 冻结 `preset.yml` 字段集与 `agent.cordis.yml` 的五行骨架次序。

## 二、真源事实（本机实测，非推测）

| 事实 | 证据 |
| :--- | :--- |
| 模式物理真源为 `$DSH_HOME/.agent-presets/<preset-id>/` | `DSH_HOME=$HOME/.dsh` |
| 每个 preset 目录含 `preset.yml` 与 `agent.cordis.yml` | 本机唯一参照 `$DSH_HOME/.agent-presets/liangshen/` |
| `preset.yml` 仅承载 `name` / `description` / `order` | `liangshen/preset.yml`：`name: 梁神模式`、`order: 5` |
| `agent.cordis.yml` 为插件叠加层，每行 `- id: <row>` + `name: <插件名>` | `liangshen/agent.cordis.yml`（21553 字节 / 410 行） |
| 预设可携带私有 Cordis 插件 `*.mjs` | `liangshen/tool-bootstrap.mjs`(14702)、`custom-bash.mjs`(12642)、`instruction-hint.mjs`(7766) 等 5 份 |
| 工作区内不存在任何 preset | 工作区 glob `**/{preset.yml,agent.cordis.yml,*.cordis.yml}` 零命中 |
| 权限档（read-only / workspace-write / danger-full-access）与模式为两套独立体系 | `@deepseek-ai/dsh-permission-presets` 独立 bundle |

**结论**：模式是**原子叠加层**，不是提示词模板；工具裁剪必须在 `agent.cordis.yml` 行级完成，权限档不参与姿态表达。

## 三、命名契约

| preset-id | UI 名称 | 姿态 | 命名理由 |
| :--- | :--- | :--- | :--- |
| `wg-construct` | 治理·施工 | construct | `wg` = workspace-governance，前缀防与内建 preset 撞名；与 `.agents/subagents` 的 posture 词表同名，零语义偏移 |
| `wg-refactor` | 治理·重构 | refactor | 同上 |
| `wg-review` | 治理·审查 | review | 同上 |
| `wg-explore` | 治理·探索 | explore | 同上 |

`order` 取值 10 / 11 / 12 / 13：紧随 `liangshen`（order 5）之后成组排列，不抢占其他项位次。

**弃用项**：不采用 `construct` 裸名（与内建词表撞名风险）、不采用中文 id（路径与跨平台壳层风险）。

## 四、单源目录契约（仓库内唯一真源）

```
.agents/dsh/
├── presets/
│   ├── wg-construct/{preset.yml, agent.cordis.yml}
│   ├── wg-refactor/{preset.yml, agent.cordis.yml}
│   ├── wg-review/{preset.yml, agent.cordis.yml}
│   ├── wg-explore/{preset.yml, agent.cordis.yml}
│   ├── shared/jail.mjs            # 四模式共用单份路径守卫实现
│   └── plan/0{1..5}-*.md          # 本方案细则
├── sync-presets.js                # 单源 → DSH_HOME 同构投放（含 --check-only）
└── README.md                      # 模式族总览与投放说明
```

**关键设计决策**：`jail.mjs` **只保留一份**置于 `shared/`，投放时由同步脚本复制进四个 preset 目录（DSH 只认 preset 目录内的私有插件）。若四份各自维护，必然漂移——这是唯一源原则的直接落地。

## 五、`preset.yml` 字段契约

| 字段 | 类型 | 必填 | 约束 |
| :--- | :--- | :--- | :--- |
| `name` | string | 是 | `治理·<姿态>`，中文可读，与 UI 下拉项一致 |
| `description` | string | 是 | 单句，须写明「工具裁剪到什么程度 + 适用作业面」，供 UI 提示 |
| `order` | number | 是 | 10/11/12/13，不可重复 |

不引入未在参照实现中出现过的字段（零虚构）。

## 六、`agent.cordis.yml` 五行骨架契约（次序固定）

| 段序 | 段名 | 内容 | 备注 |
| :--- | :--- | :--- | :--- |
| ① | 提示词段 | 注入 `AGENTS.md` 公理的**可执行子集**（三轨预算、一票否决中与本姿态相关的红线、交割自检命令） | 不整塞 persona |
| ② | 技能段 | 技能根行指向 `.agents/skills` | 复用既有 12 技能，零复制 |
| ③ | 委派段 | `dsh-tool-subagent`（`provider: spawn` 与 `fork`）+ `dsh-tool-subagent-control` | **仅 construct / refactor 挂载** |
| ④ | 守卫段 | `./jail.mjs` 路径守卫行，`config` 传 `mode` 与白/黑名单 | 四模式均挂载，参数不同 |
| ⑤ | 裁剪段 | 写类工具行的 `disabled: !!js <表达式>` 姿态裁剪 | review / explore 物理剥夺写权限 |

**硬约束**：所有对外发布服务的行必须置于带 `isolate:` 的 group 内，否则会发布到 root realm 与其他 preset 冲突（helper 在 mount 时拒绝）。

## 七、验收标准

- [ ] 四模式 id、`order`、UI 名称三张表冻结且无冲突；
- [ ] 单源目录结构与合约文件边界（哪些文件属单源、哪些属生成物）逐条明确；
- [ ] `preset.yml` 字段集与 `agent.cordis.yml` 五段次序形成可校验清单；
- [ ] 已识别必须在阶段二前定点查证的悬置项（见 [04 附录七](04-verification-matrix.md)），且未以推测填补。

## 八、本阶段不做

不写任何 `.mjs` 或 `.yml` 实体文件；不进入编码施工；不改动 `.agents/` 下任何既有文件。
