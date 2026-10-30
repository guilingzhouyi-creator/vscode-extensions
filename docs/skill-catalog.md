# 研发技能调用说明书

> 本文件由 `scripts/common/render-skill-catalog.js` 依 `scripts/common/skill-registry.json` 渲染生成，禁止手改；
> 运行 `node scripts/common/render-skill-catalog.js --check` 校验漂移。

本说明书回答三个问题：技能靠什么被激活、调用一个技能意味着什么、调用一个领域技能会联动哪些技能。

## 一、激活机制：技能如何被选中

每个技能的 frontmatter description 是 Agent 侧唯一可见的索引面：Agent 只依据这一行判断是否加载该技能，
命中之后才读取 SKILL.md 正文，正文里的 references 再按需 JIT 读取。因此描述的写法直接决定激活命中率。

描述行统一形如 `【触发：/分隔的触发词】调用含义`，硬约束如下：

- **触发词 6~9 个**，每个同类跨技能复用不超过 3 次，避免所有技能抢同一个词。
- **三类语义覆盖**：意图词（写/重构/排错/提交…）、症状词（崩溃/卡顿/漂移…）、技术标识（CAS、RingBuffer、ELOC、taxis…）；
  单个技能至少覆盖三类中的两类，校验器会拒绝只堆技术名词或只堆口语词的描述。
- **调用含义回答“何时必须使用、看守什么”**，而不是复述技能名；用户据此就能知道调用它意味着什么。
- **描述与联动块都是生成产物**：改 `scripts/common/skill-registry.json` 后重新渲染，手改会被校验器判红并还原。

联动语义由领域（domain）定义，分三种关系：

- **前置**：链上排在当前技能之前的一项，通常是领域入口或上游约束；
- **接续**：链上的下一项，完成当前职责后必须交棒的对象；
- **并行支援**：与当前技能共同服务多个领域的伙伴技能，按共同领域数排序取前 4 项。

加载一个领域入口技能后，按它的「联动技能」块依次注入前置、接续与并行支援，就能覆盖该领域的完整作业闭环。

## 二、三层拓扑

全工作区 `24 项研发技能` 按职责分为三层：

| 层 | 定位 | 技能 |
| :--- | :--- | :--- |
| **Layer 1** 通用工程与算法突破层 | 跨项目复用的工程工艺、复杂度预算、证伪、调试与度量方法论；不绑定具体子项目，任何作业按需注入。 | [`algorithmic-operator-engineering`](../.agents/skills/algorithmic-operator-engineering/SKILL.md)、[`coding-craft`](../.agents/skills/coding-craft/SKILL.md)、[`complexity-budget`](../.agents/skills/complexity-budget/SKILL.md)、[`constraint-driven-development`](../.agents/skills/constraint-driven-development/SKILL.md)、[`debugging-and-error-recovery`](../.agents/skills/debugging-and-error-recovery/SKILL.md)、[`defensive-security-and-taint-safety`](../.agents/skills/defensive-security-and-taint-safety/SKILL.md)、[`facade-discipline`](../.agents/skills/facade-discipline/SKILL.md)、[`interaction-design-physics`](../.agents/skills/interaction-design-physics/SKILL.md)、[`spec-driven-development`](../.agents/skills/spec-driven-development/SKILL.md)、[`state-concurrency-and-crash-recovery`](../.agents/skills/state-concurrency-and-crash-recovery/SKILL.md)、[`telemetry-statistical-modeling`](../.agents/skills/telemetry-statistical-modeling/SKILL.md) |
| **Layer 2** 工作区统一治理底座 | 提交、门禁、技能、规则、文档、发版、子代理与测试的统一底座；所有子项目共享同一套铁律与验证命令。 | [`batch-commit`](../.agents/skills/batch-commit/SKILL.md)、[`docs-archive-governance`](../.agents/skills/docs-archive-governance/SKILL.md)、[`gate-governance`](../.agents/skills/gate-governance/SKILL.md)、[`release-package-workflow`](../.agents/skills/release-package-workflow/SKILL.md)、[`rule-catalog-governance`](../.agents/skills/rule-catalog-governance/SKILL.md)、[`skill-governance`](../.agents/skills/skill-governance/SKILL.md)、[`subagent-orchestration`](../.agents/skills/subagent-orchestration/SKILL.md)、[`test-benchmark-engineering`](../.agents/skills/test-benchmark-engineering/SKILL.md) |
| **Layer 3** 子项目领域适配器 | 把通用底座落到具体子项目（auto-refactor、workspace-timing、WebGames、fractal-git、Rust）的专属契约与红线。 | [`auto-refactor-dev`](../.agents/skills/auto-refactor-dev/SKILL.md)、[`fractal-git-dev`](../.agents/skills/fractal-git-dev/SKILL.md)、[`rust-engineering`](../.agents/skills/rust-engineering/SKILL.md)、[`webgames-workflow`](../.agents/skills/webgames-workflow/SKILL.md)、[`workspace-timing-dev`](../.agents/skills/workspace-timing-dev/SKILL.md) |

## 三、领域联动：调用一个技能会带出哪些技能

### 分形版本控制内核（`fractal-git / Taxis`）

- **领域链**：`fractal-git-dev` → `rust-engineering` → `state-concurrency-and-crash-recovery` → `algorithmic-operator-engineering` → `test-benchmark-engineering`
- **领域支援**：`spec-driven-development`、`coding-craft`、`complexity-budget`、`facade-discipline`、`defensive-security-and-taint-safety`、`debugging-and-error-recovery`、`constraint-driven-development`
- **对应 SubAgent 原型**：`git-kernel`

| 我遇到的场景 | 联动技能 |
| :--- | :--- |
| 新增或修改 taxis 子命令 | `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering` |
| taxis 输出与 git 逐字节不一致 | `fractal-git-dev` + `debugging-and-error-recovery` + `algorithmic-operator-engineering` |
| 索引树并发写入或崩溃恢复 | `fractal-git-dev` + `state-concurrency-and-crash-recovery` + `defensive-security-and-taint-safety` |
| 精简模块导出面与消除空门面 | `fractal-git-dev` + `facade-discipline` + `rust-engineering` |

### 自动重构内核（`auto-refactor Rust 与 TypeScript 双轨`）

- **领域链**：`auto-refactor-dev` → `rust-engineering` → `algorithmic-operator-engineering` → `telemetry-statistical-modeling` → `test-benchmark-engineering`
- **领域支援**：`spec-driven-development`、`coding-craft`、`complexity-budget`、`facade-discipline`、`debugging-and-error-recovery`、`constraint-driven-development`、`rule-catalog-governance`、`state-concurrency-and-crash-recovery`
- **对应 SubAgent 原型**：`cli-engine`

| 我遇到的场景 | 联动技能 |
| :--- | :--- |
| 新增分析器或规则 | `auto-refactor-dev` + `rule-catalog-governance` + `test-benchmark-engineering` |
| Rust 与 TypeScript 输出字节不等价 | `auto-refactor-dev` + `rust-engineering` + `debugging-and-error-recovery` |
| 评分口径被注水或刷分 | `telemetry-statistical-modeling` + `constraint-driven-development` + `auto-refactor-dev` |
| 消融纯转发跳板与参数收敛 | `auto-refactor-dev` + `facade-discipline` + `complexity-budget` |

### VS Code 扩展与计时视图（`workspace-timing`）

- **领域链**：`workspace-timing-dev` → `state-concurrency-and-crash-recovery` → `interaction-design-physics` → `test-benchmark-engineering` → `release-package-workflow`
- **领域支援**：`spec-driven-development`、`coding-craft`、`complexity-budget`、`facade-discipline`、`debugging-and-error-recovery`、`defensive-security-and-taint-safety`、`constraint-driven-development`、`algorithmic-operator-engineering`、`gate-governance`
- **对应 SubAgent 原型**：`vs-extension`

| 我遇到的场景 | 联动技能 |
| :--- | :--- |
| 计时视图卡顿或丢帧 | `workspace-timing-dev` + `interaction-design-physics` + `algorithmic-operator-engineering` |
| 进程被杀后缓冲区数据丢失 | `workspace-timing-dev` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering` |
| 打包 vsix 并热同步 | `release-package-workflow` + `workspace-timing-dev` + `gate-governance` |
| 扩展多形参函数与门面收敛 | `workspace-timing-dev` + `facade-discipline` + `coding-craft` |

### 游戏引擎与 Godot 视图（`WebGames`）

- **领域链**：`webgames-workflow` → `algorithmic-operator-engineering` → `interaction-design-physics` → `test-benchmark-engineering`
- **领域支援**：`spec-driven-development`、`coding-craft`、`complexity-budget`、`state-concurrency-and-crash-recovery`、`debugging-and-error-recovery`、`constraint-driven-development`
- **对应 SubAgent 原型**：`game-engine`

| 我遇到的场景 | 联动技能 |
| :--- | :--- |
| 新玩法先出四阶段方案 | `spec-driven-development` + `webgames-workflow` + `test-benchmark-engineering` |
| 热路径循环里出现对象分配 | `webgames-workflow` + `algorithmic-operator-engineering` + `complexity-budget` |
| 配置字段与视图快照不一致 | `webgames-workflow` + `debugging-and-error-recovery` + `coding-craft` |
| 卡拉尔界面动效与感知幂律渐隐 | `webgames-workflow` + `interaction-design-physics` + `test-benchmark-engineering` |

### 门禁与命令面基础设施（`scripts / pre-commit / CI`）

- **领域链**：`gate-governance` → `defensive-security-and-taint-safety` → `coding-craft` → `test-benchmark-engineering` → `release-package-workflow`
- **领域支援**：`constraint-driven-development`、`debugging-and-error-recovery`、`docs-archive-governance`、`rule-catalog-governance`
- **对应 SubAgent 原型**：`infra-tool`

| 我遇到的场景 | 联动技能 |
| :--- | :--- |
| 新增门禁步骤并登记语义标识 | `gate-governance` + `rule-catalog-governance` + `test-benchmark-engineering` |
| pwsh 与 bash 门禁语义漂移 | `gate-governance` + `coding-craft` + `debugging-and-error-recovery` |
| 破坏性删除或路径穿越 | `defensive-security-and-taint-safety` + `gate-governance` + `coding-craft` |

### 技能与规则元治理（`.agents / rule-catalog`）

- **领域链**：`skill-governance` → `rule-catalog-governance` → `docs-archive-governance` → `batch-commit`
- **领域支援**：`coding-craft`、`complexity-budget`、`gate-governance`、`subagent-orchestration`、`constraint-driven-development`
- **对应 SubAgent 原型**：`skill-governance`

| 我遇到的场景 | 联动技能 |
| :--- | :--- |
| 新增技能或改技能描述 | `skill-governance` + `docs-archive-governance` + `batch-commit` |
| 新增规则标识并闭合登记 | `rule-catalog-governance` + `skill-governance` + `gate-governance` |
| 技能描述命中率低或调用含义不清 | `skill-governance` + `subagent-orchestration` + `coding-craft` |
| 多智能体任务装配与沙箱隔离 | `subagent-orchestration` + `skill-governance` + `gate-governance` |

### 工作区元治理与并行交付（`并行会话 / 提交 / 归档 / 发版`）

- **领域链**：`batch-commit` → `constraint-driven-development` → `docs-archive-governance` → `release-package-workflow`
- **领域支援**：`subagent-orchestration`、`rule-catalog-governance`、`coding-craft`、`complexity-budget`、`test-benchmark-engineering`、`debugging-and-error-recovery`、`gate-governance`
- **对应 SubAgent 原型**：`workspace-meta`

| 我遇到的场景 | 联动技能 |
| :--- | :--- |
| 并行会话改动混杂需要精准暂存 | `batch-commit` + `subagent-orchestration` + `constraint-driven-development` |
| 提交信息被门禁拦下 | `batch-commit` + `rule-catalog-governance` + `gate-governance` |
| 发版日志与版本号对齐 | `release-package-workflow` + `docs-archive-governance` + `batch-commit` |

## 四、技能调用卡片

### algorithmic-operator-engineering

- **调用含义**：为算法与高频算子确立从数据表示到单趟融合的降维路径，并用差分基准与微基准证明收益真实存在。
- **描述行**：`【触发：算子/热路径/吞吐优化/降维/SoA/LUT/基准等价/卡顿】当涉及算法瓶颈、吞吐优化、高频循环热路径或数据表示反转(SoA)时触发。执行五步降维协议与100%差分等价基准验证。`
- **所属层**：通用工程与算法突破层
- **联动定位**：分形版本控制内核（链上第 4 步）；自动重构内核（链上第 3 步）；游戏引擎与 Godot 视图（链上第 2 步）；VS Code 扩展与计时视图（领域支援）
- **前置**：`state-concurrency-and-crash-recovery`、`rust-engineering`、`webgames-workflow`
- **接续**：`test-benchmark-engineering`、`telemetry-statistical-modeling`、`interaction-design-physics`
- **并行支援**：`coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 这个算子跑到百万级输入就卡住了，能降阶吗？
- 别只改循环，把对象图反转成 TypedArray 试试。
- 优化完要跑差分基准证明字节级等价，不许拍脑袋。

**验证命令**：

- `node auto-refactor/scripts/bench-hot-paths.js`
- `cd auto-refactor && npm run build && npm test`
- `node scripts/common/evaluate-eloc-budget.js`

### coding-craft

- **调用含义**：在任何代码落笔时提供命名、失败语义、类型穷尽与依赖方向的工艺判据，守住函数级质量底线。
- **描述行**：`【触发：写代码/重构/命名/错误处理/类型设计/SSOT/空捕获】编写、生成或审查任何代码时必须遵循。坚持命名即契约、显式失败语义、类型穷尽、最小接口暴露与单向依赖，对接 516 条 SSOT 规则。`
- **所属层**：通用工程与算法突破层
- **联动定位**：门禁与命令面基础设施（链上第 3 步）；分形版本控制内核（领域支援）；自动重构内核（领域支援）；VS Code 扩展与计时视图（领域支援）；游戏引擎与 Godot 视图（领域支援）；技能与规则元治理（领域支援）；工作区元治理与并行交付（领域支援）
- **前置**：`defensive-security-and-taint-safety`
- **接续**：`test-benchmark-engineering`
- **并行支援**：`constraint-driven-development`、`complexity-budget`、`debugging-and-error-recovery`、`algorithmic-operator-engineering`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 我要新增一个导出函数，先确定命名和失败语义。
- 这个 catch 是空的，还有一堆 as any，按判据重写。
- 审查这段代码：导出面是不是过大了？

**验证命令**：

- `node scripts/common/validate-skills.js && node scripts/common/validate-family-contract.js`
- `node scripts/common/validate-rule-id-closure.js && node scripts/common/validate-docs-consistency.js`
- `node scripts/common/evaluate-eloc-budget.js && node scripts/common/validate-code-density.js --all`

### complexity-budget

- **调用含义**：在编码与重构中量化控制流复杂度、文件体积与注释密度，把超限模块压回刚性预算内。
- **描述行**：`【触发：重构/拆分文件/CC/Depth/ELOC/LOC/JSDoc/注水】重构大文件、优化认知复杂度(CC<=15)、缩减嵌套深度(Depth<=4)或检查体积包络(ELOC<=900)时触发。落实六字段 JSDoc 契约与循环零堆分配。`
- **所属层**：通用工程与算法突破层
- **联动定位**：分形版本控制内核（领域支援）；自动重构内核（领域支援）；VS Code 扩展与计时视图（领域支援）；游戏引擎与 Godot 视图（领域支援）；技能与规则元治理（领域支援）；工作区元治理与并行交付（领域支援）
- **前置**：—（通用方法论横向支援）
- **接续**：—（按需横向注入）
- **并行支援**：`coding-craft`、`constraint-driven-development`、`debugging-and-error-recovery`、`test-benchmark-engineering`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 这个文件 1200 行了，帮我拆到 ELOC 900 以内。
- 这个函数 CC 21、嵌套 5 层，改成卫语句提前返回。
- 循环里 new 了对象，按零瞬态堆分配改掉。

**验证命令**：

- `node scripts/common/evaluate-eloc-budget.js`
- `node auto-refactor/scripts/validate-comment-governance.js`
- `pwsh -File scripts/ps1/pre-commit-gate.ps1`
- `node scripts/common/validate-code-density.js --all`

### constraint-driven-development

- **调用含义**：在交割前用机器化底线与五步怀疑循环证伪改动，阻止阈值下调、测试弱化与半成品交付。
- **描述行**：`【触发：交割/验收/证伪/Doubt/阈值下调/测试弱化/半成品】完成特性交付、声称修复完成或合入前对抗性证伪时必须触发。落实 Floor Guard 刚性底线与单调棘轮，主动推翻边界假设与脆弱实现。`
- **所属层**：通用工程与算法突破层
- **联动定位**：工作区元治理与并行交付（链上第 2 步）；分形版本控制内核（领域支援）；自动重构内核（领域支援）；VS Code 扩展与计时视图（领域支援）；游戏引擎与 Godot 视图（领域支援）；门禁与命令面基础设施（领域支援）；技能与规则元治理（领域支援）
- **前置**：`batch-commit`
- **接续**：`docs-archive-governance`
- **并行支援**：`coding-craft`、`complexity-budget`、`debugging-and-error-recovery`、`test-benchmark-engineering`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 我准备声称修完了，交割前按五步怀疑循环证伪一遍。
- 能不能先把 baseline 阈值下调让门禁过？
- 这次改动语义量不到 15%，会被判刷分熔断吗？

**验证命令**：

- `pwsh -File scripts/ps1/audit-all.ps1`

### debugging-and-error-recovery

- **调用含义**：在故障现场建立可复现 SSCCE 并最小修复，以两次受挫即停纪律避免盲目试错扩大战线。
- **描述行**：`【触发：排错/报错/崩溃/单测失败/SSCCE/复现/假说/故障】遇到任何故障、测试报错或异常行为时必须使用。严格遵循观察-假说-SSCCE隔离-最小修复五步法，坚决贯彻两次受挫即停原则，严禁盲目猜修。`
- **所属层**：通用工程与算法突破层
- **联动定位**：分形版本控制内核（领域支援）；自动重构内核（领域支援）；VS Code 扩展与计时视图（领域支援）；游戏引擎与 Godot 视图（领域支援）；门禁与命令面基础设施（领域支援）；工作区元治理与并行交付（领域支援）
- **前置**：—（通用方法论横向支援）
- **接续**：—（按需横向注入）
- **并行支援**：`coding-craft`、`constraint-driven-development`、`test-benchmark-engineering`、`complexity-budget`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 单测突然红了，报错堆栈在附件里，帮我定位。
- 这个问题已经修了两次还红，按两次即停先停手。
- 先别改生产代码，给我一个 30 行内 SSCCE 复现。

**验证命令**：

- `cd auto-refactor && npm test`

### defensive-security-and-taint-safety

- **调用含义**：在破坏性操作与外部输入暴露前执行污点证明，封锁递归删除、变量遮蔽与注入类风险。
- **描述行**：`【触发：删除文件/rm/注入/污点追踪/变量遮蔽/路径穿越/清理目录】执行破坏性文件操作、清理目录、暴露端点或处理外部输入时触发。落实递归删除三步污点守卫(GUARD-DESTR-001)与只读自动变量防篡改。`
- **所属层**：通用工程与算法突破层
- **联动定位**：门禁与命令面基础设施（链上第 2 步）；分形版本控制内核（领域支援）；VS Code 扩展与计时视图（领域支援）
- **前置**：`gate-governance`
- **接续**：`coding-craft`
- **并行支援**：`constraint-driven-development`、`debugging-and-error-recovery`、`test-benchmark-engineering`、`algorithmic-operator-engineering`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 帮我把 build 目录整个递归删掉再重建。
- 这个 rm -rf 的变量是外面传进来的，安全吗？
- 脚本里 $HOME 被赋值了，会在真机上报错吗？

**验证命令**：

- `node scripts/common/validate-destructive-ops.js`
- `node .agents/skills/defensive-security-and-taint-safety/templates/safe-sandbox-cleanup.js`
- `node scripts/common/validate-shell-parity.js`

### facade-discipline

- **调用含义**：在重构模块导出面时消融透传跳板并判定门面承载，确保精简后行为与契约 100% 等价。
- **描述行**：`【触发：门面/跳板/透传/ARCH-ABS/参数收敛/消融/空壳膨胀】消融<=3行纯转发跳板(ARCH-ABS-001)、压缩多形参对象(SIM-ARGS-001)或重构模块导出面时触发。确保门面具备实质承载(ARCH-FAC-001)与不可变冻结。`
- **所属层**：通用工程与算法突破层
- **联动定位**：分形版本控制内核（领域支援）；自动重构内核（领域支援）；VS Code 扩展与计时视图（领域支援）
- **前置**：—（通用方法论横向支援）
- **接续**：—（按需横向注入）
- **并行支援**：`algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 这个 index.ts 只有三行 export，能直接内联吗？
- 这个门面 ELOC 只有 8，是不是空壳透传？
- 把五个位置参数压成一个只读参数对象。

**验证命令**：

- `node auto-refactor/scripts/validate-facade-governance.js`
- `node scripts/common/evaluate-eloc-budget.js`
- `node scripts/common/validate-code-density.js`

### interaction-design-physics

- **调用含义**：在编写界面与动效时把明度、边框、弹簧与 IME 约束落成参数化实现，消除套娃与重排抖动。
- **描述行**：`【触发：界面/调样式/CSS/边框/暗色模式/输入法/抖动/套娃】编写或调整前端界面、Webview 与动效时触发。落实语义明度阶梯、单闭合边框、二阶阻尼物理模型、感知幂律渐隐及 IME 输入法互锁守卫。`
- **所属层**：通用工程与算法突破层
- **联动定位**：VS Code 扩展与计时视图（链上第 3 步）；游戏引擎与 Godot 视图（链上第 3 步）
- **前置**：`state-concurrency-and-crash-recovery`、`algorithmic-operator-engineering`
- **接续**：`test-benchmark-engineering`
- **并行支援**：`coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 这个暗色模式弹窗白边太刺眼了，按语义明度改。
- 输入法还在组词就把消息发出去了，加互锁。
- 按钮内胶囊边框套了两层，按单闭合边框消掉。

**验证命令**：

- `pwsh -File scripts/ps1/audit-all.ps1`

### spec-driven-development

- **调用含义**：在编码前用单点质询把模糊需求收敛为能力拓扑与接口契约规格，避免返工与 X-Y 错解。
- **描述行**：`【触发：需求澄清/质询/能力拓扑/规格书/X-Y/返工】遇到模糊需求、重大架构重构或开发新特性前触发。通过每次一问消除歧义与 X-Y 问题，先确立能力拓扑图与接口契约规格，再行动手编码。`
- **所属层**：通用工程与算法突破层
- **联动定位**：分形版本控制内核（领域支援）；自动重构内核（领域支援）；VS Code 扩展与计时视图（领域支援）；游戏引擎与 Godot 视图（领域支援）
- **前置**：—（通用方法论横向支援）
- **接续**：—（按需横向注入）
- **并行支援**：`algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 需求就一句话，先别写码，帮我反向问清楚。
- 这个重构会动持久化格式，先出规格书再动手。
- 确认一下这是不是 X-Y 问题，我真正要的是 X。

**验证命令**：

- `pwsh -File scripts/ps1/audit-all.ps1`

### state-concurrency-and-crash-recovery

- **调用含义**：在设计并发、状态机与落盘路径时落实对称释放、原子替换与幂等回放，杜绝泄漏与半写。
- **描述行**：`【触发：并发/状态机/排障/泄漏/原子落盘/幂等/崩溃恢复/Journal】涉及并发调度、句柄生命周期对称释放(PRF-LEAK-001)、异步派发器排空或崩溃恢复幂等性设计时触发。杜绝孤儿句柄与悬挂协程。`
- **所属层**：通用工程与算法突破层
- **联动定位**：分形版本控制内核（链上第 3 步）；VS Code 扩展与计时视图（链上第 2 步）；自动重构内核（领域支援）；游戏引擎与 Godot 视图（领域支援）
- **前置**：`rust-engineering`、`workspace-timing-dev`
- **接续**：`algorithmic-operator-engineering`、`interaction-design-physics`
- **并行支援**：`coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 扩展退出后定时器还在跑，帮我对称释放。
- 写配置直接覆盖出过 0 字节文件，改成原子落盘。
- Journal 回放会不会重复累加？需要幂等键。

**验证命令**：

- `cd workspace-timing && npm run test:fast`
- `cd auto-refactor && node scripts/gate-self.js`
- `node scripts/common/validate-skills.js`

### telemetry-statistical-modeling

- **调用含义**：为评分器与度量算法确立无信息先验与客观统计口径，并用反刷分熔断识别虚假收益。
- **描述行**：`【触发：评分/度量/跑分/统计模型/贝叶斯/CAI/注水/反刷分】开发评分器、重构度量算法或反刷分时触发。落实从 0 纯客观统计、Jeffreys Beta(0.5,0.5) 共轭后验估计与 BLOCK_GAMING_DETECTED 虚假重构熔断。`
- **所属层**：通用工程与算法突破层
- **联动定位**：自动重构内核（链上第 4 步）
- **前置**：`algorithmic-operator-engineering`
- **接续**：`test-benchmark-engineering`
- **并行支援**：`coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**典型情形**：

- 新评分器能不能乘个 1.2 系数把分拉高？
- 样本只有 8 个，置信区间别写死 ±5%。
- 这次重构语义量低，会被判定为刷分吗？

**验证命令**：

- `node auto-refactor/scripts/validate-autonomy-scorer.js && node auto-refactor/scripts/validate-project-neutrality.js`

### batch-commit

- **调用含义**：回答『这批改动如何拆成可独立回滚的提交』，产出分批清单与门禁预审结论。
- **描述行**：`【触发：提交/分批/暂存/commit/git/预审/禁词/原子提交】当准备提交代码、分批原子提交或审查 git commit 信息时必须使用。按 6 层拓扑拆解提交，拦截 6 类黑话禁词，执行离线门禁预审与原子提交闭环。`
- **所属层**：工作区统一治理底座
- **联动定位**：工作区元治理与并行交付（领域入口）；技能与规则元治理（链上第 4 步）
- **前置**：`docs-archive-governance`
- **接续**：`constraint-driven-development`
- **并行支援**：`coding-craft`、`complexity-budget`、`gate-governance`、`rule-catalog-governance`
- **协作专员**：原型 `workspace-meta`：`workspace-review`、`workspace-refactor`、`workspace-guardian`

**典型情形**：

- 用户说『这些改动一起提交吧』但涉及 20 个文件
- 提交信息被 commit-msg-gate 拦下
- 需要为底层重构拆出可回滚的提交点

**验证命令**：

- `pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg-file>`
- `pwsh -File scripts/ps1/pre-commit-gate.ps1`
- `pwsh -File scripts/ps1/audit-all.ps1`

### docs-archive-governance

- **调用含义**：回答『这份文档该归到哪、相对链接是否还活』，产出归档元数据与文档门禁结论。
- **描述行**：`【触发：文档归档/蓝图/架构演进/README/归档清单/死链/案卷封存】编写、修改顶层架构蓝图、交付物归档、案卷封存或全宗技术档案时触发。维护 agent-native-system-blueprint 与纯正面向用户标准。`
- **所属层**：工作区统一治理底座
- **联动定位**：技能与规则元治理（链上第 3 步）；工作区元治理与并行交付（链上第 3 步）；门禁与命令面基础设施（领域支援）
- **前置**：`rule-catalog-governance`、`constraint-driven-development`
- **接续**：`batch-commit`、`release-package-workflow`
- **并行支援**：`coding-craft`、`gate-governance`、`complexity-budget`、`debugging-and-error-recovery`
- **协作专员**：原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`

**典型情形**：

- 用户要更新顶层架构蓝图文档
- 交付物结项后需要归档到归档目录
- README 里出现死链或盘符绝对路径

**验证命令**：

- `bash scripts/sh/check-display-assets.sh`
- `pwsh -File WebGames/scripts/ps1/audit-docs.ps1`
- `node auto-refactor/scripts/validate-docs.js`

### gate-governance

- **调用含义**：回答『这条门禁该在哪一层拦、脚本如何跨平台可靠执行』，产出双层门禁与脚本契约。
- **描述行**：`【触发：门禁/全仓审查/提交门禁/脚本编写/跨平台/pwsh/bash/子进程】编写修改门禁脚本、运行全仓审查或处理跨平台脚本兼容时触发。落实 Tier 1 本地左移流式判定、工作目录隔离契约与零黑话规范。`
- **所属层**：工作区统一治理底座
- **联动定位**：门禁与命令面基础设施（领域入口）；VS Code 扩展与计时视图（领域支援）；技能与规则元治理（领域支援）；工作区元治理与并行交付（领域支援）
- **前置**：—（领域入口）
- **接续**：`defensive-security-and-taint-safety`
- **并行支援**：`coding-craft`、`constraint-driven-development`、`complexity-budget`、`debugging-and-error-recovery`
- **协作专员**：原型 `infra-tool`：`infra-construct`、`infra-review`、`infra-refactor`、`infra-explore`、`infra-guardian`

**典型情形**：

- 新增的 validate 脚本没接入全仓审查
- pwsh 与 bash 下脚本行为不一致
- 门禁脚本子进程写到了错误工作目录

**验证命令**：

- `pwsh -File scripts/ps1/pre-commit-gate.ps1`
- `node scripts/common/generate-rule-catalog.js --check-only`
- `node scripts/common/validate-skills.js`
- `node scripts/common/evaluate-eloc-budget.js`

### release-package-workflow

- **调用含义**：回答『这次发版打哪个包、版本与日志怎么对齐』，产出 vsix 产物与发版闭环。
- **描述行**：`【触发：打包/发布/vsix/HotSync/版本号/发版日志/热同步】打包 VS Code 扩展、执行 -HotSync 热同步或编写 Keep-a-Changelog 发版日志时触发。确保产物自动轮转与用户文档零工程黑话。`
- **所属层**：工作区统一治理底座
- **联动定位**：VS Code 扩展与计时视图（链上第 5 步）；门禁与命令面基础设施（链上第 5 步）；工作区元治理与并行交付（链上第 4 步）
- **前置**：`test-benchmark-engineering`、`docs-archive-governance`
- **接续**：—（链路末端）
- **并行支援**：`coding-craft`、`constraint-driven-development`、`debugging-and-error-recovery`、`gate-governance`
- **协作专员**：原型 `vs-extension`：`wt-construct`、`wt-review`、`wt-refactor`、`wt-explore`

**典型情形**：

- 用户说『打包一个新 vsix 并装到 Cursor』
- 准备发版但发版日志还停在旧版本
- 热同步后扩展注册表没自愈

**验证命令**：

- `bash scripts/sh/check-display-assets.sh`
- `bash scripts/sh/version-bump.sh workspace-timing patch --dry-run`
- `pwsh -File scripts/ps1/package.ps1 -HotSync`

### rule-catalog-governance

- **调用含义**：回答『这个规则 ID 是否已登记、会不会被判漂移』，产出 SSOT 元数据与闭包校验结果。
- **描述行**：`【触发：新增规则/修改规则/SSOT/规则目录/规则登记/规则漂移/命名拓扑】增删改规则 ID、治理跨项目规则元数据或维护单源规则目录时触发。看守 3-3-3 命名拓扑与 RCFG-RULE-DRIFT 防虚构闭包。`
- **所属层**：工作区统一治理底座
- **联动定位**：技能与规则元治理（链上第 2 步）；自动重构内核（领域支援）；门禁与命令面基础设施（领域支援）；工作区元治理与并行交付（领域支援）
- **前置**：`skill-governance`
- **接续**：`docs-archive-governance`
- **并行支援**：`coding-craft`、`constraint-driven-development`、`complexity-budget`、`debugging-and-error-recovery`
- **协作专员**：原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`

**典型情形**：

- 新分析器先写了规则 ID 再补登记
- 提交信息里引用了未登记规则 ID
- 规则目录计数与文档字面量对不上

**验证命令**：

- `node scripts/common/generate-rule-catalog.js --check-only`
- `node scripts/common/sync-doc-metrics.js`
- `pwsh -File scripts/ps1/pre-commit-gate.ps1`

### skill-governance

- **调用含义**：回答『这个技能结构是否合规、双目录是否字节一致』，产出四件套检查与同步校验结论。
- **描述行**：`【触发：编写技能/新增skill/技能治理/同构同步/双目录同步/四件套/JIT披露】创建、修改技能、维护四件套结构(SKILL/references/templates/scripts)或同步双目录字节等价时触发。贯彻 JIT 渐进披露与 50~200 字描述契约。`
- **所属层**：工作区统一治理底座
- **联动定位**：技能与规则元治理（领域入口）
- **前置**：—（领域入口）
- **接续**：`rule-catalog-governance`
- **并行支援**：`coding-craft`、`complexity-budget`、`constraint-driven-development`、`batch-commit`
- **协作专员**：原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`

**典型情形**：

- 新增技能目录但缺 references 骨架
- 改了根目录技能忘了同步插件副本
- 校验脚本报 description 超长

**验证命令**：

- `node scripts/common/validate-skills.js`
- `node scripts/common/sync-skills.js --check`
- `pwsh -File scripts/ps1/audit-all.ps1 -Fast`

### subagent-orchestration

- **调用含义**：回答『这个任务怎么拆给子 Agent 且不互相覆盖文件』，产出派发契约与隔离边界。
- **描述行**：`【触发：subagent/派发任务/多agent协同/并发开发/隔离边界/上下文预算/交叉复审】派发或编排 SubAgent、处理五层上下文预算治理(75% 脱水)时必须使用。强制同构模型、独占 Zero-Intersection Path Jail 物理防冲突与交叉复审。`
- **所属层**：工作区统一治理底座
- **联动定位**：技能与规则元治理（领域支援）；工作区元治理与并行交付（领域支援）
- **前置**：—（通用方法论横向支援）
- **接续**：—（按需横向注入）
- **并行支援**：`coding-craft`、`complexity-budget`、`constraint-driven-development`、`batch-commit`
- **协作专员**：全领域调度总枢（7 原型 × 5 姿态 × 27 预置）

**典型情形**：

- 两个子 Agent 同时改同一批文件
- 主会话上下文到 75% 需要脱水
- 派发审查型子 Agent 却给了写权限

**验证命令**：

- `node .agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js`
- `node scripts/common/generate-rule-catalog.js --check-only`
- `node scripts/common/validate-skills.js && node scripts/common/sync-skills.js --check`

### test-benchmark-engineering

- **调用含义**：回答『这条修复该先写哪个失败用例、基准会不会回退』，产出红绿闭环与耗时棘轮数据。
- **描述行**：`【触发：写单测/TDD/红绿测试/基准测试/性能回归/耗时棘轮/孤儿用例】编写单元测试、性能压测或实行 TDD 时必须使用。先写失败用例，隔离确定性时钟与伪随机种子，看守单调耗时预算与零孤儿用例。`
- **所属层**：工作区统一治理底座
- **联动定位**：分形版本控制内核（链上第 5 步）；自动重构内核（链上第 5 步）；VS Code 扩展与计时视图（链上第 4 步）；游戏引擎与 Godot 视图（链上第 4 步）；门禁与命令面基础设施（链上第 4 步）；工作区元治理与并行交付（领域支援）
- **前置**：`algorithmic-operator-engineering`、`telemetry-statistical-modeling`、`interaction-design-physics`、`coding-craft`
- **接续**：`release-package-workflow`
- **并行支援**：`constraint-driven-development`、`debugging-and-error-recovery`、`complexity-budget`、`spec-driven-development`
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`

**典型情形**：

- 用户报 bug 要直接改代码而不是先复现
- 新增测试没进 Cargo.toml 的测试注册
- 跨午夜定时器测试偶发失败

**验证命令**：

- `cd auto-refactor && npm test`
- `cd workspace-timing && npm run test:fast`
- `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1`

### auto-refactor-dev

- **调用含义**：回答『改引擎会不会破坏双轨等价与流水线拓扑』，产出分析器与规则改动及回归结论。
- **描述行**：`【触发：auto重构/分析器/内核/Praxis/重构引擎/双轨等价/流水线】开发、修改或测试 auto-refactor 项目代码时必须使用。看守 Rust 与 TS 双轨 100% 字节等价、四阶段流水线拓扑、Diff 引擎与暂存落盘规范。`
- **所属层**：子项目领域适配器
- **联动定位**：自动重构内核（领域入口）
- **前置**：—（领域入口）
- **接续**：`rust-engineering`
- **并行支援**：`algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`
- **协作专员**：原型 `cli-engine`：`ar-construct`、`ar-review`、`ar-refactor`、`ar-explore`

**典型情形**：

- 新增一个第二阶段分析器规则
- Rust 与 TS 实现的 Diff 输出不一致
- Praxis SDK 客户端协议要改签名

**验证命令**：

- `cd auto-refactor && npm run build && npm run gate && npm test && node scripts/bench-hot-paths.js`
- `cd auto-refactor && npm test`

### fractal-git-dev

- **调用含义**：回答『Taxis 改动是否仍与 Git 字节等价、拓扑是否越界』，产出内核实现与门禁回归。
- **描述行**：`【触发：taxis/版本控制内核/CAS/偏序集/实现子命令/字节等价/FGT规则】开发或修改 fractal-git (Taxis) 模块时必须使用。看守 10 微 Crate 分层拓扑、Git Plumbing 二进制等价、偏序集冲突检测与 CAS 无锁索引树。`
- **所属层**：子项目领域适配器
- **联动定位**：分形版本控制内核（领域入口）
- **前置**：—（领域入口）
- **接续**：`rust-engineering`
- **并行支援**：`algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`

**典型情形**：

- 修改 fg-object 的 tree 解析
- taxis 与 git 的 pack 字节不一致
- 新增 SubAgent Cell 工作树快照逻辑

**验证命令**：

- `node fractal-git/scripts/common/validate-crate-topology.js`
- `cargo clippy --manifest-path fractal-git/Cargo.toml --all-targets -- -D warnings`
- `cargo test --workspace --manifest-path fractal-git/Cargo.toml`
- `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1`

### rust-engineering

- **调用含义**：回答『这段 Rust 是否达到工业级红线』，产出类型状态与零分配实现及 Clippy 干净结果。
- **描述行**：`【触发：Rust/Cargo/unsafe/无锁/Clippy/编写Rust/panic】编写或重构 Rust 代码时必须触发。全面贯彻 Type-State 状态机、零瞬态堆分配(FGT-PRF-001)、thiserror 强类型错误、// SAFETY: 严格证明及 Clippy 零容忍门禁。`
- **所属层**：子项目领域适配器
- **联动定位**：分形版本控制内核（链上第 2 步）；自动重构内核（链上第 2 步）
- **前置**：`fractal-git-dev`、`auto-refactor-dev`
- **接续**：`state-concurrency-and-crash-recovery`、`algorithmic-operator-engineering`
- **并行支援**：`coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`

**典型情形**：

- 热路径里出现 Vec 分配
- 写 unsafe 块却没有 SAFETY 注释
- cargo clippy 报 -D warnings 失败

**验证命令**：

- `node .agents/skills/rust-engineering/scripts/validate-rust-conformance.js`
- `cargo fmt --all --manifest-path fractal-git/Cargo.toml -- --check`
- `cargo clippy --workspace --all-targets --manifest-path fractal-git/Cargo.toml -- -D warnings`
- `cargo test --workspace --manifest-path fractal-git/Cargo.toml`

### webgames-workflow

- **调用含义**：回答『这段游戏逻辑该放哪层、配置从哪来』，产出配置驱动与快照注入实现。
- **描述行**：`【触发：WebGames/Godot/GDScript/游戏逻辑/写玩法/对象池/快照注入】开发或修改 WebGames 游戏模块时必须触发。坚持全域 GameConfig 配置驱动、视图表现层单向快照注入(apply_snapshot)与循环零堆分配(ADV-PRF-002)。`
- **所属层**：子项目领域适配器
- **联动定位**：游戏引擎与 Godot 视图（领域入口）
- **前置**：—（领域入口）
- **接续**：`algorithmic-operator-engineering`
- **并行支援**：`coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`
- **协作专员**：原型 `game-engine`：`wg-construct`、`wg-review`、`wg-refactor`、`wg-explore`

**典型情形**：

- 视图层里直接算了游戏数值
- 循环里 new 对象导致每帧堆分配
- 新增游戏模式要扩配置字段

**验证命令**：

- `pwsh -File WebGames/scripts/ps1/check-gdscript.ps1 && pwsh -File WebGames/scripts/ps1/test-run.ps1`
- `pwsh -File WebGames/scripts/ps1/audit-all.ps1`

### workspace-timing-dev

- **调用含义**：回答『这个计时扩展改动是否破坏五层解耦与崩溃安全』，产出实现与双语 UI 校验。
- **描述行**：`【触发：计时扩展/VS扩展/计时/UI国际化/环形缓冲/崩溃安全/双语字典】开发或维护 workspace-timing 扩展时触发。落实五层解耦、RingBuffer 与 Journal 双写崩溃安全、双语字典(zh-CN/en)与暗色 UI。`
- **所属层**：子项目领域适配器
- **联动定位**：VS Code 扩展与计时视图（领域入口）
- **前置**：—（领域入口）
- **接续**：`state-concurrency-and-crash-recovery`
- **并行支援**：`algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`
- **协作专员**：原型 `vs-extension`：`wt-construct`、`wt-review`、`wt-refactor`、`wt-explore`

**典型情形**：

- 用户说『计时器跨午夜后数据丢了』
- 新增 UI 文案还没补 en 字典
- Journal 重放后出现重复时间段

**验证命令**：

- `cd workspace-timing && npm run compile && npm run test:fast && npm run review`

## 五、维护闭环

1. 修改 `scripts/common/skill-registry.json`：描述含义、触发词、领域链或场景只在这一个文件里改。
2. 渲染入口元数据：`node scripts/common/sync-skill-metadata.js`。
3. 重渲染本说明书：`node scripts/common/render-skill-catalog.js`。
4. 同步插件镜像：`node scripts/common/sync-skills.js`。
5. 本地校验：`node scripts/common/validate-skills.js`，随后按工作区门禁执行 `pwsh -File scripts/ps1/audit-all.ps1`。

三项校验看守上述闭环：`SKILL-METADATA` 校验注册表与磁盘双向闭包及描述渲染一致，
`SKILL-LINKAGE` 校验联动关系存在性与领域链完整性，`SKILL-CATALOG` 校验本说明书与注册表同源。
