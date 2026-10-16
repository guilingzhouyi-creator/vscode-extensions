> **实施后修正（以 bundle 事实为准）**：本细则成文于旧目录格式时期，其中 `$DSH_HOME/.agent-presets/<id>/` 目录、`preset.yml` 与 `agent.cordis.yml` 双文件、`shared/jail.mjs` 分片镜像等描述**已作废**。现行真源为 `bundle/` 下的 `package.json`、`cordis.patch.yml`、`host-plugin.js` 三件；装载机制、生效边界（模块代际需重启 DSH）与验证结论见 [../README.md](../README.md)。细则的约束意图（工具裁剪矩阵、守卫判定次序、可观测性、防漂移）仍然有效。
# 阶段五细则：施工前定点查证（Spike）

> 本文件为「工作区治理模式族」落地细则的第五阶段，收口三项**不可推测、必须实测查证**的悬置项。
> 纪律：本阶段未完成前，禁止进入阶段二编码施工。任何以「合理推测」填补悬置项的做法，等同于虚构技术事实（§四红线 9 精神）。

---

## 一、悬置项 S1：`tools.guard` 的回调契约

| 项 | 内容 |
| :--- | :--- |
| 为什么要查 | `jail.mjs` 的全部技术可行性建立在 `tools.guard(guard: ToolGuard)` 的入参与返回语义之上；契约不明则无法写出正确实现 |
| 已知 | 工具注册表 Service `tools` 提供 `register`、`restrict(filter: ToolRestriction)`、`guard(guard: ToolGuard)`、`get(name, scope?)`、`schemas(scope?)`、`execute` |
| 未知 | guard 回调的形参（是否含工具名、入参对象、scope）、返回值语义（布尔？结构化拒绝对象？抛异常？）、是否支持异步 |
| 查证手段 | 读 `dsh-tool-fs` 与 `dsh-agent-presets` 的实现或生成的 `.d.ts` 类型声明；必要时读 `liangshen/tool-bootstrap.mjs` 是否已有变通实现可参照 |
| 通过判据 | 能写出一个最小 `guard` 注册并观察到拦截行为；若契约不支持路径级校验，则**必须回到用户重议方案**，不得改用提示词约束冒充物理约束 |

## 二、悬置项 S2：DSH 是否支持工作区内 preset 发现

| 项 | 内容 |
| :--- | :--- |
| 为什么要查 | 决定「单源 → 镜像」同步脚本是否必要，以及镜像目录能否改为工作区内相对路径（可规避红线 1 的绝对路径禁令） |
| 已知 | 本机唯一 preset 真源为 `$DSH_HOME/.agent-presets/`；`agentPresets.register(definition)` 支持运行时注册 |
| 未知 | 是否存在工作区级 `.agent-presets/` 发现路径、或 `agentPresets.register` 能否由工作区插件在启动时调用 |
| 查证手段 | 查 `agentPresets` 服务的发现实现；在试验目录投放一个最小 preset 验证是否被 `list()` 拾取 |
| 通过判据 | 明确回答「必须镜像到 DSH_HOME」或「支持工作区内发现」；**若支持运行时 `register`**，优先改用注册方式（工作区内零绝对路径写入） |

## 三、悬置项 S3：`.agents/skills` 的清单真源

| 项 | 内容 |
| :--- | :--- |
| 为什么要查 | 阶段三的 README 登记必须与技能集真源一致，否则文档再次与运行时不符 |
| 已知 | 存在 `scripts/common/validate-skills.js`、`scripts/common/sync-skills.js`；插件 README 声称 12 技能；`AGENTS.md` 路由矩阵列出的技能数多于 12 |
| 未知 | 技能物理四件套结构定义、根目录与 `.agents/plugins/.../skills/` 的 100% 字节等价关系、当前实际技能总数 |
| 查证手段 | 运行 `node scripts/common/validate-skills.js`；比对两处技能目录清单 |
| 通过判据 | 得出真实技能总数与物理结构定义，README 按实测数字书写（禁止沿用旧文档的 12 这一数字而不核实） |

## 四、执行顺序与产出

1. S1 优先（阻断编码）→ S2 次之（阻断同步脚本设计）→ S3 最后（只阻断文档）；
2. 每项产出：**查证命令 + 观察到的原始证据 + 结论**，写入阶段四验证矩阵的留痕记录；
3. 任一项结论与阶段一/二契约冲突 → 停止施工，带着证据回到用户处重议范围。

## 五、验收标准

- [ ] S1 契约明确到可写出可运行的最小守卫样例；
- [ ] S2 结论明确，且已据此定稿同步脚本的必要性与目标路径；
- [ ] S3 技能总数与结构与校验脚本输出一致；
- [ ] 三项均无「推测性结论」残留。

## 六、本阶段不做

不在查证结果明朗前创建任何 `.yml` / `.mjs` 实体；不为赶进度跳过 S1；不把「参照实现里出现过」当作契约证据（参照实现只证明写法可用，不证明接口语义）。
