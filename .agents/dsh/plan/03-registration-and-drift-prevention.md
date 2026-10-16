> **实施后修正（以 bundle 事实为准）**：本细则成文于旧目录格式时期，其中 `$DSH_HOME/.agent-presets/<id>/` 目录、`preset.yml` 与 `agent.cordis.yml` 双文件、`shared/jail.mjs` 分片镜像等描述**已作废**。现行真源为 `bundle/` 下的 `package.json`、`cordis.patch.yml`、`host-plugin.js` 三件；装载机制、生效边界（模块代际需重启 DSH）与验证结论见 [../README.md](../README.md)。细则的约束意图（工具裁剪矩阵、守卫判定次序、可观测性、防漂移）仍然有效。
# 阶段三细则：配置对齐、单源登记与防漂移

> 本文件为「工作区治理模式族」落地细则的第三阶段，解决「模式族落地后与既有治理资产断链」的问题。
> 上游依据：`AGENTS.md` §一「技能集结构与同构治理」「通用 SubAgent 泛化调度」两行路由、§四红线 5 与红线 11。

---

## 一、必须对齐的三处既有资产

| 资产 | 现状 | 断链后果 | 本阶段动作 |
| :--- | :--- | :--- | :--- |
| `.agents/plugins/workspace-governance/plugin.json` | 声明 name / displayName / version / logo / suggestedPrompts，未提及模式 | 用户在 DSH 中看不到模式族与治理套件的隶属关系 | 增补模式族条目，保持既有字段与 logo 引用不动 |
| `.agents/plugins/workspace-governance/README.md` | 95 行，声称打包 12 技能 / 5 agents / MCP config | 文档与 DSH 实际可加载物不一致（DSH bundles 只认 npm 包） | 补一节说明「哪些资产在 DSH 中真正生效、哪些是 Antigravity 侧资产」 |
| `.agents/subagents/subagent-catalog.json` | 30 条 preset（archetype × posture），`model: "inherit"` | 30 条 catalog 与 DSH 4 模式无对应关系，公理 6 无执行体 | 建立「模式 × 姿态」调用约定映射，不改动既有 30 条条目字段 |

**关键立场**：DSH 的 `plugin_manager` / bundles 只接受 npm 包，`.agents/plugins/*` 在当前机制下**不被 DSH 加载**。因此文档必须诚实区分「DSH 运行时资产」与「工作区治理文档资产」，禁止在 README 中暗示插件已被 DSH 装载。

## 二、模式 × 姿态调用约定

公理 6 要求依据 `(Archetype ⊗ Posture)` 合成专员。落地后的调用路径为：

```
主 Agent（wg-construct）→ 选定 archetype（6 选 1）
                        → 选定 posture（5 选 1）
                        → 若为 review / explore：改挂 wg-review / wg-explore 模式
                           （物理剥夺写权限，替代不存在的 enable_write_tools: false）
                        → 通过 dsh-tool-subagent 派发，模型继承主会话（inherit）
```

约定表落点：`.agents/dsh/README.md`，与 `subagent-catalog.json` 的 archetype / posture 词表**同名同序**，避免第三套词表。

## 三、防漂移机制

| 漂移类型 | 检测手段 | 阻断点 |
| :--- | :--- | :--- |
| 单源与 DSH 镜像不一致 | `node .agents/dsh/sync-presets.js --check-only` | 字节不等即非零退出 |
| `jail.mjs` 四份副本分叉 | 只保留 `shared/` 单份，由同步脚本复制 | 物理上不存在第二份源 |
| 模式 id 与内建 preset 撞名 | `wg-` 前缀 + 阶段四挂载实测确认 | 挂载失败即暴露 |
| 文档声称与运行时不符 | README 按「DSH 运行时 / 文档资产」二分陈述 | 阶段四逐条核对 |

## 四、登记内容清单

- `plugin.json`：新增模式族条目（4 个 id 与 UI 名称），**不修改** version、logo、suggestedPrompts；
- `README.md`：新增「DSH Agent Preset 模式族」一节，含四模式表、单源路径、投放与校验命令、姿态裁剪说明；
- `.agents/dsh/README.md`：模式族总览、模式 × 姿态调用约定、`jail.mjs` 配置说明。

## 五、验收标准

- [ ] `plugin.json` 为合法 JSON 且原有字段逐字节保留；
- [ ] README 明确区分「DSH 运行时生效」与「工作区文档资产」，无夸大表述（遵守 §四红线 9）；
- [ ] 模式 × 姿态约定表与 `subagent-catalog.json` 的 archetype / posture 词表逐项同名；
- [ ] `--check-only` 与阶段四挂载实测在最终交付前各跑一次且全绿。

## 六、本阶段不做

不重构 `.agents/plugins/` 目录结构；不改动 15 份专员 md 与 30 条 catalog 条目；不新增第三套姿态词表。
