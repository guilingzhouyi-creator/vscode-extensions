> **实施后修正（以 bundle 事实为准）**：本细则成文于旧目录格式时期，其中 `$DSH_HOME/.agent-presets/<id>/` 目录、`preset.yml` 与 `agent.cordis.yml` 双文件、`shared/jail.mjs` 分片镜像等描述**已作废**。现行真源为 `bundle/` 下的 `package.json`、`cordis.patch.yml`、`host-plugin.js` 三件；装载机制、生效边界（模块代际需重启 DSH）与验证结论见 [../README.md](../README.md)。细则的约束意图（工具裁剪矩阵、守卫判定次序、可观测性、防漂移）仍然有效。
# 阶段四细则：验证矩阵与门禁预审

> 本文件为「工作区治理模式族」落地细则的第四阶段，定义交付前必须全绿的可复跑验证矩阵。
> 上游依据：`AGENTS.md` §五 SOP 第 3 步四重递进防线、第 4 步全量回归；§四红线 6 与红线 12。

---

## 一、验证矩阵（离线、可复跑、逐条给命令）

| 序 | 验证项 | 命令 | 通过判据 |
| :-: | :--- | :--- | :--- |
| V1 | 同构校验 | `node .agents/dsh/sync-presets.js --check-only` | 退出码 0，无差异文件输出 |
| V2 | 复杂度预算 | `node scripts/common/evaluate-eloc-budget.js` | 新增 `.js`/`.mjs` 全部在 CC ≤ 15 / Depth ≤ 4 / Noise ≤ 4.0 / ELOC ≤ 900 包络内 |
| V3 | 挂载实测 | 挂载 4 个 preset，读取 `agentPresets.list()` | 4 个 id 均可见，session 可成功组合，无 realm 冲突 |
| V4 | 裁剪实测（review） | `wg-review` 会话内调用 `write` / `edit` / `pwsh` | 工具**物理不存在**（不是调用报错） |
| V5 | 裁剪实测（explore） | `wg-explore` 会话内检查工具清单 | 写工具、终端、委派、任务板全部不存在 |
| V6 | Jail 拦截实测 | 在 `wg-construct` 会话内对 `auto-refactor/` 下文件发起 `write` | 被拒，且返回原因含被拒绝对路径与命中规则名 |
| V7 | Jail 降级实测 | 构造守卫内部异常（临时注入） | 降级放行 + 仅一条 `warn`，会话未中断 |
| V8 | 卫生检查 | 全仓新增文件检查换行与体积 | `.md`/`.json`/`.yml`/`.mjs` 严格 LF；零 0 字节文件 |
| V9 | 全量审查 | `pwsh -File scripts/ps1/audit-all.ps1` | 5 大支柱 100% 绿色通行 |

## 二、执行顺序纪律

1. **V1/V2/V8 可在编码期随时跑**，属快反馈；
2. **V3–V7 依赖 DSH 运行时**，须在投放后执行；其中 V7 会临时注入缺陷，**执行完必须立即还原并复跑 V6**，防止带缺陷交付；
3. **V9 是最终门禁**，仅在全部前置项通过后执行；
4. 任一验证项失败即视为阶段未完成，禁止以「测试通过非达标」口径降格处理（§二公理 6）。

## 三、主 Agent 独立交叉复审（四重防线映射）

| 防线 | 本方案的对应动作 |
| :--- | :--- |
| ① 沙箱与越界审计 | 核验本仓改动是否严格限于 `.agents/dsh/`、`.agents/plugins/workspace-governance/` 两处；确认未触碰三大项目源码 |
| ② 对抗性架构审计 | 逐份复查 `jail.mjs` 的控制流是否平铺（卫语句提前返回）、`CC ≤ 15`、守卫异常是否真降级、是否存在假逻辑空分支 |
| ③ 独立构建与静态核查 | 主 Agent 亲自执行 V1/V2/V9，不采信子 Agent 汇报 |
| ④ 本地门禁预审 | `pwsh -File scripts/ps1/pre-commit-gate.ps1` + `pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg-file>` |

## 四、提交纪律（若本方案最终提交）

- `[Project: governance]`（本改动属治理面，不归三大受控项目）；
- 提交信息不得出现施工批次与敏捷代号（`p[0-9]+` / `phase[0-9]+` / `W1-W9` / `Pass 1..6`）；
- `[Verification]` 须写输入输出质性断言，严禁「退出码 0」式流水账或测试计数；
- 提及的规则 ID 必须在 `scripts/common/rule-catalog.json` 中真实登记，未登记则**不写规则 ID**；
- 分批原子提交：① 单源与守卫实现 ② 同步脚本 ③ 登记与文档 ④ 验证产物。

## 五、验收标准

- [ ] V1–V9 逐项留痕（命令 + 判据 + 结果），无跳项；
- [ ] V7 的临时缺陷已完全还原，且还原后复跑 V6 通过；
- [ ] 四重防线审计记录成文并附于交付说明；
- [ ] 全量审查 5 大支柱 100% 绿色。

## 六、本阶段不做

不使用 `--no-verify`；不跳过任何门禁；不为通过验证而放宽既有阈值（§四红线 2）。
