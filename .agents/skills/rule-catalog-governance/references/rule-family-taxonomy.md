# 工作区规则家族分类与统一命名分类学 (Rule Family Taxonomy)

全工作区规则遵循严格的语义前缀编码规范，规则 ID 命名通式为 `[FAMILY]-[TOPIC]-[NNN]`。

---

## 一、 核心规则家族前缀矩阵

本表按主题族编排，分组与 [rule-family-map.md](../../coding-craft/references/rule-family-map.md) 逐组对应，共收录 <!-- METRICS:BEGIN rule-family-count-all -->**61 个规则族**<!-- METRICS:END rule-family-count-all -->。族名即 ID 的主题段：规范形取第一段，带项目命名空间的形式（如 `FGT-ALG-001`）取第二段，单段历史 ID 的族由目录生成器显式声明。族名全局唯一，同一族名可以跨项目复用。

### 命名、注释与文档（5 族）

| 家族 (Family) | 领域职责 | 约束范围与规模 | 典型代表规则 (SSOT 已登记) |
| :--- | :--- | :--- | :--- |
| **`NAM`** | 标识符即契约 | 文件名、类型名、成员名、集合名词性与长度都必须自解释；缩写、单字母、`data`/`res`/`tmp` 一类空壳名与超长堆叠名同属违规。族内 19 个 ID，仅 auto-refactor | `NAM-ABR-001` |
| **`CMT`** | 注释写 why 不写 what | 文件首部六字段、导出符号文档、契约与实现一致、语言不混排、宽度 ≤ 100 列；机械复述与低语义密度按负权重计。族内 16 个 ID，仅 auto-refactor | `CMT-BAN-001` |
| **`DOC`** | 文档结构与可点达 | 代码围栏必须闭合、相对链接必须存活、正文零宣传口号与批次代号、跨文档零重复段落。族内 17 个 ID，跨 2 个项目（workspace-timing、auto-refactor），layer L3 | `DOC-CL-001` |
| **`ART`** | WebGames 艺术工单与资产规格 | 立绘、图标、动效的工单登记、规格尺寸与命名必须与资产清单双向对齐，禁止无工单资产入库。族内 21 个 ID，仅 WebGames | `ART-AUD-005` |
| **`RES`** | 资源与关停契约 | 结构化资源仓必须可枚举、可回收；宿主关停路径须释放句柄并幂等。族内 7 个 ID，跨 2 个项目（workspace-timing、WebGames），layer L3 | `L3-RESOURCE-TOPO` |

### 错误、类型与接口（9 族）

| 家族 (Family) | 领域职责 | 约束范围与规模 | 典型代表规则 (SSOT 已登记) |
| :--- | :--- | :--- | :--- |
| **`ERR`** | 失败语义必须显式 | 可失败操作必须返回可判别结果或抛出强类型错误，禁止吞异常、禁止以空值代替失败。族内 4 个 ID，跨 2 个项目（auto-refactor、fractal-git） | `FGT-ERR-001` |
| **`TSM`** | TypeScript 惯用法 | 禁 `any`、禁 `var`、禁旧式 `require`/`substr`/`includes` 误用；构造器与展开语义须显式声明。族内 11 个 ID，仅 auto-refactor | `TSM-ANY-001` |
| **`PYM`** | Python 惯用法 | `collections.abc`、`with` 管资源、`X | None`、内建泛型、`raise ... from`、`slots=True`、禁可变默认参数。族内 13 个 ID，仅 auto-refactor | `PYM-ABC-001` |
| **`RSM`** | Rust 惯用法 | 零裸 panic、`unsafe` 必须带 `// SAFETY:` 证明、`let-else` 替代单分支、`&str` 替代 `&String`、禁跨 `.await` 持锁。族内 14 个 ID，仅 auto-refactor | `RSM-PNC-001` |
| **`GOM`** | Go 惯用法 | `context` 首参传递、错误包装用 `%w`、导出符号必须有文档注释、禁裸 `panic` 于库代码。族内 5 个 ID，仅 auto-refactor | `GOM-CTX-001` |
| **`NUM`** | 数值边界与精度 | 递归深度、循环上界必须双侧有界；缩放与舍入不得静默丢精度。族内 2 个 ID，仅 auto-refactor | `NUM-BND-001` |
| **`SIM`** | 简化与消歧 | 形参 ≥ 4 收为参数对象、禁布尔旗标参数、禁空实现与空壳继承、守卫子句替代嵌套。族内 17 个 ID，跨 2 个项目（auto-refactor、WebGames） | `SIM-CMP-001` |
| **`ARCH`** | 架构边界与门面承载 | 分层单向直连、门面必须实质承载（ELOC ≥ 15 或冻结）、≤ 3 行透传跳板物理消融。族内 30 个 ID，仅 auto-refactor | `ARCH-DIR-003` |
| **`MOD`** | 模块边界 | 模块间禁止反向依赖、禁止扁平化跨层引用、导出面必须最小化。族内 3 个 ID，仅 auto-refactor | `MOD-BWD-001` |

### 依赖、常量与体积（9 族）

| 家族 (Family) | 领域职责 | 约束范围与规模 | 典型代表规则 (SSOT 已登记) |
| :--- | :--- | :--- | :--- |
| **`DEP`** | 依赖方向与供应链 | 基础设施不得反向依赖上层；禁 devDependency 进生产、禁循环导入、禁幽灵/未固定/高危许可证依赖。族内 17 个 ID，跨 2 个项目（auto-refactor、fractal-git） | `DEP-INV-001` |
| **`CONST`** | 常量单源与分层 | 同类字面量必须提取、跨文件同义常量零漂移、常量声明区固定、禁厨房水槽式常量仓。族内 10 个 ID，仅 auto-refactor | `CONST-CLU-001` |
| **`VOL`** | 双轨体积预算 | ELOC 与 LOC 双轨上限、1:3 动态包络、注释不得为避让行数而被删。族内 5 个 ID，仅 global-tooling | `VOL-DOC-001` |
| **`BIG`** | 超大文件 | 单文件超限必须按领域拆分，而非机械切碎。族内 1 个 ID，仅 auto-refactor | `large-file` |
| **`CMP`** | 表达式与语句密度 | 禁深层内联回调链、禁位运算与三元堆叠、禁单行多语句。族内 4 个 ID，仅 auto-refactor | `CMP-CAL-001` |
| **`CPX`** | 复杂度与空间 | CC ≤ 15、Depth ≤ 4、循环内零瞬态堆分配、递归必须有收敛证明。族内 13 个 ID，仅 auto-refactor | `CPX-REC-001` |
| **`PRF`** | 热路径与内存 | 顶层正则常量化、禁循环内重复 I/O、禁无界缓存、算法复杂度须与数据规模匹配。族内 15 个 ID，跨 3 个项目（auto-refactor、fractal-git、WebGames） | `expensive-loop-operation` |
| **`LAY`** | 分层与依赖（layer: L2） | 分层单向、零循环、导入必须可解析。族内 4 个 ID，仅 workspace-timing，layer L2 | `L2-LAYERS` |
| **`HC`** | 硬编码专项（layer: L3） | 禁绝对路径、禁 CJK 字面量入代码、禁魔数、禁密钥，UI 串必须走字典。族内 6 个 ID，仅 workspace-timing，layer L3 | `HC-ABS-PATH` |

### 测试、界面与平台（17 族）

| 家族 (Family) | 领域职责 | 约束范围与规模 | 典型代表规则 (SSOT 已登记) |
| :--- | :--- | :--- | :--- |
| **`TST`** | 测试工程 | 确定性时钟与 RNG、零跳过用例、零孤儿用例、耗时回归棘轮、测试拓扑与源码同构。族内 9 个 ID，跨 2 个项目（workspace-timing、auto-refactor），layer L0 | `L0-TEST` |
| **`UI`** | 界面工程与交互物理 | 语义明度阶梯、单闭合边框、二阶阻尼动效、感知幂律遮罩。族内 8 个 ID，仅 auto-refactor | `UI-ENG-001` |
| **`VSC`** | VS Code 扩展契约 | 100% 双语字典、RingBuffer + Journal 崩溃安全、状态栏刷新有界、内存与性能预算。族内 8 个 ID，仅 auto-refactor | `VSC-MEM-001` |
| **`PROD`** | 生产构建洁净度 | 产物零 console/TODO、零 sourcemap 外泄、零服务端环境变量泄漏到客户端包。族内 3 个 ID，仅 auto-refactor | `PROD-HYG-001` |
| **`SEC`** | 安全与暴露面 | 内部端点不得进客户端包、视觉隐藏不构成鉴权、密钥零硬编码、实验路由不得打包。族内 14 个 ID，仅 auto-refactor | `SEC-EXP-001` |
| **`DAT`** | 数据访问 | 禁 N+1 查询、禁无界全表加载、持久化驱动不得泄漏进业务核心。族内 6 个 ID，仅 auto-refactor | `DAT-NPL-001` |
| **`STDLIB`** | 标准库使用 | 禁 panic 型标准库调用、分配必须可控、平台相关 API 须有移植层、递归须有界。族内 6 个 ID，仅 auto-refactor | `STDLIB-ALLOC-001` |
| **`SH`** | Bash 惯用法 | `set -euo pipefail`、变量与命令替换必须加引号、错误平铺捕获、禁无守卫交互读取。族内 15 个 ID，仅 auto-refactor | `SH-EOL-001` |
| **`PS`** | PowerShell 惯用法 | Verb-Noun 命名、`[CmdletBinding()]`、禁 `iex` 动态执行、句柄必须 `try/finally` 释放。族内 9 个 ID，仅 auto-refactor | `PS-SAFE-001` |
| **`GDM`** | GDScript 引擎契约 | 节点路径与 `@onready` 时序、信号连接/断开成对、对象池零分配、导出与 i18n 单源。族内 25 个 ID，仅 auto-refactor | `GDM-ISO-001` |
| **`ADV`** | 高性能脚本与引擎约束 | 循环零堆分配、连续缓冲区、对象池 `reset_state()`、随机源可播种、事件派发有界。族内 21 个 ID，仅 WebGames | `ADV-BND-001` |
| **`UUID`** | 重入与幂等 | 可重入路径必须幂等，重复触发不得产生重复副作用。族内 1 个 ID，仅 WebGames | `UUID-REENTRANT-001` |
| **`ENG`** | 分析器自身故障 | 分析器单文件异常必须降级为诊断而非中断整轮扫描。族内 1 个 ID，仅 auto-refactor | `analyzer-error` |
| **`EXT`** | 外部目录边界 | 扫描与写入必须限定在受控目录内，越界即拒绝。族内 1 个 ID，仅 auto-refactor | `EXT-DIR-001` |
| **`BLD`** | 编译基线（layer: L0） | 代码必须可编译，禁止以跳过换取绿色。族内 1 个 ID，仅 workspace-timing，layer L0 | `L0-COMPILE` |
| **`LINT`** | 静态检查基线（layer: L1） | Lint 与格式检查零告警，禁止以忽略标记掩盖。族内 2 个 ID，仅 workspace-timing，layer L1 | `L1-*` |
| **`TB`** | 测试预算与棘轮（layer: L4） | 测试耗时预算、基线必须存在、超预算即回退。族内 3 个 ID，仅 workspace-timing，layer L4 | `L4-TEST-BUDGET` |

### 治理与门禁（7 族）

| 家族 (Family) | 领域职责 | 约束范围与规模 | 典型代表规则 (SSOT 已登记) |
| :--- | :--- | :--- | :--- |
| **`GOV`** | 运行时治理契约 | 异常不得吞、日志必须可脱敏、类型契约不得双写、防刷分熔断必须真实触发。族内 36 个 ID，跨 2 个项目（auto-refactor、WebGames） | `GOV-AGN-001` |
| **`GUARD`** | 门禁与守卫 | AST 切片预算、语义步骤登记、反馈状态词闭包、双平台同构对、SSOT 零漂移。族内 23 个 ID，跨 2 个项目（auto-refactor、global-tooling） | `GUARD-AST-001` |
| **`HYG`** | 物理卫生 | 零空文件、`.ps1` CRLF 其余 LF、UTF-8 无 BOM、单 EOF、纯空格缩进、目录名 kebab-case。族内 19 个 ID，跨 2 个项目（auto-refactor、global-tooling） | `HYG-BOM-001` |
| **`CMG`** | 提交说明规范 | 必填项目归属、实质字数下限、零黑话、零夸大、验证段禁流水账。族内 9 个 ID，仅 global-tooling | `CMG-PRJ-001` |
| **`RCFG`** | 规则元治理 | 规则 ID 双向闭包、计数口径与真源一致、表现层与底层诊断去重。族内 7 个 ID，跨 2 个项目（workspace-timing、global-tooling），layer L3 | `L3-REVIEW-CONFIG` |
| **`SCR`** | 脚本库标准（layer: L3） | 脚本命名、头契约与注册表双向完备：既无孤儿也无悬空。族内 5 个 ID，仅 workspace-timing，layer L3 | `L3-SCRIPT-STANDARD` |
| **`ARF`** | 重构门槛（layer: L5） | 重构必须有净收益与等价性证明，禁止表面搬移。族内 2 个 ID，仅 workspace-timing，layer L5 | `ARF-*` |

### fractal-git 原生内核（14 族）

| 家族 (Family) | 领域职责 | 约束范围与规模 | 典型代表规则 (SSOT 已登记) |
| :--- | :--- | :--- | :--- |
| **`ALG`** | 算法等价性 | 原生算子必须与参考实现差分等价。族内 1 个 ID，仅 fractal-git | `FGT-ALG-001` |
| **`BRG`** | 桥接层 | FFI/桥接边界必须显式声明所有权与生命周期。族内 1 个 ID，仅 fractal-git | `FGT-BRG-001` |
| **`CAS`** | 无锁 CAS | CAS 循环必须处理 ABA 与内存序。族内 1 个 ID，仅 fractal-git | `FGT-CAS-001` |
| **`COR`** | 核心不变量 | 核心数据结构的前置/后置不变式必须可断言。族内 1 个 ID，仅 fractal-git | `FGT-COR-001` |
| **`FAC`** | 门面承载 | crate 门面必须实质承载，禁止空壳转发。族内 1 个 ID，仅 fractal-git | `FGT-FAC-001` |
| **`GAT`** | 门禁自审 | 内核门禁必须自证检出能力。族内 1 个 ID，仅 fractal-git | `FGT-GAT-001` |
| **`IDX`** | 索引安全 | 索引访问必须边界检查或形式证明。族内 1 个 ID，仅 fractal-git | `FGT-IDX-001` |
| **`LCK`** | 锁纪律 | 禁跨 await 持锁、锁粒度最小化。族内 1 个 ID，仅 fractal-git | `FGT-LCK-001` |
| **`OBJ`** | 对象生命周期 | 对象池借还必须成对且幂等。族内 1 个 ID，仅 fractal-git | `FGT-OBJ-001` |
| **`POL`** | 策略注入 | 策略必须可替换，禁止硬编码分支。族内 1 个 ID，仅 fractal-git | `FGT-POL-001` |
| **`SAF`** | unsafe 最小化 | `unsafe` 必须有 `// SAFETY:` 证明且作用域最小。族内 1 个 ID，仅 fractal-git | `FGT-SAF-001` |
| **`STO`** | 存储层 | 持久化写入必须原子且可恢复。族内 1 个 ID，仅 fractal-git | `FGT-STO-001` |
| **`TOP`** | 拓扑 | 模块拓扑单向，禁止反向引用。族内 1 个 ID，仅 fractal-git | `FGT-TOP-001` |
| **`TRN`** | 事务 | 事务边界必须显式，失败须回滚。族内 1 个 ID，仅 fractal-git | `FGT-TRN-001` |

---

## 二、 规则命名与元数据规范

1. **命名通式与权威判定**：规范形态为 `[FAMILY]-[TOPIC]-[NNN]`，由 `auto-refactor/src/core/rules/types.ts` 的 `RULE_ID_PATTERN`（`^[A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{2,10}){1,3}-\d{3}$`）判定，全仓共用该声明而不另立副本。两段式 ID（如 `L0-COMPILE`、`HC-ABS-PATH`）与单段 ID（如 `high-complexity`）属**历史形态**：它们是真实在用的规则身份，但每条都必须在 SSOT 目录中携带 `canonical: false` 与具体的 `legacyReason`，重命名须经别名窗口才能完成。
2. **唯一性**：规则 ID 在全工作区命名空间中全局唯一，严禁重复定义；
3. **摘要字段名**：SSOT 目录投影的摘要字段为 `summary`，内容是客观祈使句式的校验行为描述。分析器内部的 `RuleDefinition` 另有 `title` 字段，两者不通用，引用 SSOT 时不得写作 `title`；
4. **严重等级闭包**：`error` 违规时触发门禁非零退出码一票否决阻断；`warning` 在审查报告中给出警告与重构建议但不阻断；`info` 仅作提示与统计，不参与阻断。三个取值构成闭包，`warn` 不是合法取值；
5. **维度归属仅限分析器**：`dimension` 由 auto-refactor 的 `RuleDefinition` 与扣分表持有，用于把单个 Finding 分配到质量维度（单规则跨维度遵循 `MAX_AXES_PER_FINDING <= 4`）。SSOT 目录**不投影**该字段，因此 `workspace-timing`、`WebGames`、`fractal-git` 与 `global-tooling` 的规则没有维度归属，引用时不得臆造；
6. **度量求真公理**：规则扣分必须分配至明确的质量维度（`dimension`），单规则跨维度扣分遵循 `MAX_AXES_PER_FINDING <= 4`，严禁虚假注水。
