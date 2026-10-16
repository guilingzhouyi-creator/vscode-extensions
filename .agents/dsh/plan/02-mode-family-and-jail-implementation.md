> **实施后修正（以 bundle 事实为准）**：本细则成文于旧目录格式时期，其中 `$DSH_HOME/.agent-presets/<id>/` 目录、`preset.yml` 与 `agent.cordis.yml` 双文件、`shared/jail.mjs` 分片镜像等描述**已作废**。现行真源为 `bundle/` 下的 `package.json`、`cordis.patch.yml`、`host-plugin.js` 三件；装载机制、生效边界（模块代际需重启 DSH）与验证结论见 [../README.md](../README.md)。细则的约束意图（工具裁剪矩阵、守卫判定次序、可观测性、防漂移）仍然有效。
# 阶段二细则：模式族与 Path Jail 守卫编码细则

> 本文件为「工作区治理模式族」落地细则的第二阶段，定义四个模式的工具集裁剪矩阵与 `jail.mjs` 的实现契约。
> 上游依据：阶段一契约、`AGENTS.md` §一公理 2 三轨预算、§二公理 6、§四红线 11。
> 本阶段产出可执行代码，但**须在阶段五悬置项查证完毕后开工**。

---

## 一、工具裁剪矩阵（物理裁剪，非提示词约定）

### 1.1 保留（四模式共有）

`read`、`glob`、`grep`、`read_image`、`compress`、`decompress`、`search_context`、`acp_status`、`acp_cache`、`todo_write`、`ask_user_question`、`get_goal`/`create_goal`/`update_goal`、`cordis_inspect_list`/`cordis_inspect_query`、`web_search`/`web_fetch`、`code_review_preview`/`code_review_execute`、全部 `mcp__rea__*`。

### 1.2 可变（按姿态）

| 工具行 | construct | refactor | review | explore |
| :--- | :-: | :-: | :-: | :-: |
| 写工具（`write` / `edit` / `str-replace`） | 挂载 | 挂载 | **禁用** | **禁用** |
| 终端（`dsh-tool-pwsh` / `dsh-terminal` / `dsh-tool-jobs`） | 挂载 | 挂载 | **禁用** | **禁用** |
| 委派（`dsh-tool-subagent` ×2 + `subagent-control`） | 挂载 | 挂载 | 禁用 | 禁用 |
| 计划模式（`dsh-plan-mode`） | 挂载 | 挂载 | 禁用 | 禁用 |
| 任务板（`task_board_*`） | 挂载 | 挂载 | 只读三件 | 禁用 |
| `present` | 挂载 | 挂载 | 挂载 | 禁用 |
| Agent Teams（`spawn_teammate` 系） | 挂载 | 禁用 | 禁用 | 禁用 |

**审查/探索姿态的实现方式**：使用 `disabled: !!js <表达式>` 在行级禁用写工具行，**绝不使用 `danger-full-access` 权限档替代**——权限档是会话级粗粒度，无法表达"可读全库但不可写任何文件"。

### 1.3 `wg-refactor` 裁掉终端的理由

重构姿态的核心风险是"改完就跑测试自证"，从而绕开 AGENTS.md §五 SOP 第 3 步的主 Agent 独立交叉复审。裁掉终端后，重构专员只能**声明**验证命令，由主 Agent 执行 —— 把「测试通过非达标」防线从提示词约束升级为物理约束。

## 二、`jail.mjs` 实现契约

### 2.1 模块结构（照抄 `liangshen/tool-bootstrap.mjs` 的可用写法）

```js
export const name = 'wg-path-jail'
export const inject = []          // 空 inject + 行序靠前 + 监听器 { prepend: true }
export function apply(ctx, config) { /* 校验配置 → 注册守卫 */ }
```

### 2.2 配置契约（由 `agent.cordis.yml` 第 ④ 段注入）

| 键 | 类型 | 说明 |
| :--- | :--- | :--- |
| `mode` | `'write' \| 'read'` | write 默认放行+黑名单校验；read 默认拒绝 |
| `allowRoots` | string[] | 授权写入根（工作区相对路径，禁止绝对路径与盘符——遵守红线 1） |
| `denyRoots` | string[] | 禁止触碰根（默认含 `auto-refactor/`、`WebGames/`、`scripts/`、`archive/`） |
| `deniedTools` | string[] | 姿态裁剪兜底名单（与 ⑤ 段行级裁剪互为双保险） |

### 2.3 校验流程（伪代码级细则）

1. 从工具调用入参提取目标路径参数（`file_path` / `path` / `paths[]`）；
2. 路径规范化并解析为绝对路径（`path.resolve`）；
3. **拒绝**任何已解析到工作区根之外的路径（越界即拒，含 `..` 逃逸）；
4. `mode: read` → 直接拒绝所有写类工具调用；
5. `mode: write` → 命中 `denyRoots` 拒绝，命中 `allowRoots` 放行，两者皆不命中默认拒绝（白名单优先）；
6. 拒绝时返回结构化原因，包含**被拒绝的绝对路径**与命中的规则名（便于主 Agent 定位）。

### 2.4 健壮性纪律（强制）

- 配置结构非法 → mount 期抛 `TypeError`（可见可修，不允许静默降级）；
- 守卫自身抛异常 → **降级为放行** 并 `ctx.logger.warn` 一次，绝不 brick 会话（照抄参照实现的容错姿态）；
- 不得在校验路径上做 I/O（不做 `fs.existsSync` 之类探测），纯字符串与路径解析判定，保证确定性。

## 三、四份 `agent.cordis.yml` 的差异点

除 ⑤ 段裁剪表达式与 ④ 段 config 外，其余完全相同：

| 模式 | ④ 段 config | ⑤ 段禁用的行 |
| :--- | :--- | :--- |
| `wg-construct` | `mode: write`，`allowRoots` 依作业面传入 | 无 |
| `wg-refactor` | `mode: write`，`allowRoots` 同上 | 终端三行 |
| `wg-review` | `mode: read` | 写工具三行、终端三行、委派三行、计划模式、Agent Teams |
| `wg-explore` | `mode: read` | 同 review，另禁任务板与 `present` |

## 四、同步脚本 `sync-presets.js`

| 能力 | 要求 |
| :--- | :--- |
| 投放 | 单源 `.agents/dsh/presets/wg-*/` → `$DSH_HOME/.agent-presets/wg-*/`；`shared/jail.mjs` 复制进每个目标目录 |
| 校验 | `--check-only` 逐文件字节比对，任一不等即非零退出并列出差异文件 |
| 安全 | 只写目标 preset 目录，不做递归删除；不触碰 `liangshen` 及其余 preset |
| 卫生 | 生成的 `.js` 严格 LF；无 0 字节文件；脚本自身满足 CC ≤ 15 |

## 五、验收标准

- [ ] 四份 `agent.cordis.yml` 通过阶段四的挂载实测；
- [ ] review / explore 会话内 `write` / `edit` / `pwsh` **物理不可见**（不是调用报错）；
- [ ] `jail.mjs` 越界写入被拒且返回可定位的拒绝原因；
- [ ] 守卫异常时降级放行且仅 warn 一次；
- [ ] 全部新增 `.mjs` / `.js` 通过 `node scripts/common/evaluate-eloc-budget.js`（CC ≤ 15、Depth ≤ 4、Noise ≤ 4.0、ELOC ≤ 900）。

## 六、本阶段不做

不改三大项目源码；不引入新 npm 依赖；不修改 `cordis.patch.yml` 已有条目；不整塞 persona 文本。
