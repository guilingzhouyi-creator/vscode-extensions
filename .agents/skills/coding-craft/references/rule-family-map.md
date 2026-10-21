# 规则族 → 编码准则指针表 (Rule Family Map)

> 本表是 `scripts/common/rule-catalog.json` 的人工可读投影：每一族给出**一句话准则**与**全量规则 ID**，让「写这段代码时该遵守什么」有唯一入口。规则正文与判定实现仍在 SSOT 与各项目分析器中，本表只建立指针，不复述正文。
>
> 加粗 ID 为 `error` 级（违反即门禁阻断），其余为 `warning` / `info` 级。新增规则后本表由 `sync-doc-metrics.js` 的同族守卫提示补齐。

---

## 命名、注释与文档

### `NAM` — 标识符即契约

准则：文件名、类型名、成员名、集合名词性与长度都必须自解释；缩写、单字母、`data`/`res`/`tmp` 一类空壳名与超长堆叠名同属违规。

- warning / info：`NAM-ABR-001`、`NAM-COL-001`、`NAM-DEC-001`、`NAM-DIR-001`、`NAM-FIL-001`、`NAM-GLB-001`、
  `NAM-GLB-002`、`NAM-JRG-002`、`NAM-LEN-001`、`NAM-LEN-002`、`NAM-MBR-001`、`NAM-RES-001`、
  `NAM-RES-002`、`NAM-RES-003`、`NAM-RES-004`、`NAM-RES-005`、`NAM-SGL-001`、`NAM-TYP-001`、
  `NAM-VAG-001`

### `CMT` — 注释写 why 不写 what

准则：文件首部六字段、导出符号文档、契约与实现一致、语言不混排、宽度 ≤ 100 列；机械复述与低语义密度按负权重计。

- warning / info：`CMT-BAN-001`、`CMT-CON-001`、`CMT-DOC-001`、`CMT-DOC-002`、`CMT-HDR-001`、`CMT-HDR-002`、
  `CMT-HDR-003`、`CMT-HDR-004`、`CMT-INT-001`、`CMT-LNG-001`、`CMT-LNG-002`、`CMT-MOJI-001`、
  `CMT-SEP-001`、`CMT-TRM-001`、`CMT-VMD-001`、`CMT-WID-001`

### `DOC` — 文档结构与可点达

准则：代码围栏必须闭合、相对链接必须存活、正文零宣传口号与批次代号、跨文档零重复段落。

- **error**：`DOC-FEN-001`
- **error**（workspace-timing）：`DOC-CL-001`、`DOC-CL-002`、`DOC-CL-003`、`DOC-CL-004`、`DOC-CL-005`、`DOC-CL-006`、`DOC-CL-007`、`DOC-CL-008`、`DOC-CL-009`、`DOC-RD-001`、`DOC-RD-002`、`DOC-RD-003`、`L3-DOC-LAYOUT`
- warning / info：`DOC-DUP-001`、`DOC-LNK-001`、`DOC-TRM-001`

### `ART` — WebGames 艺术工单与资产规格

准则：立绘、图标、动效的工单登记、规格尺寸与命名必须与资产清单双向对齐，禁止无工单资产入库。

- warning / info：`ART-AUD-005`、`ART-ICO-012`、`ART-REC-001`、`ART-REC-002`、`ART-REC-003`、`ART-REC-004`、
  `ART-REC-005`、`ART-REC-006`、`ART-REC-007`、`ART-REC-008`、`ART-REC-009`、`ART-SPEC-001`、
  `ART-SPEC-002`、`ART-SPEC-003`、`ART-SPEC-004`、`ART-SPEC-005`、`ART-SPEC-006`、`ART-SPEC-007`、
  `ART-SPEC-008`、`ART-UI-001`、`ART-VIG-003`

### `RES` — 资源与关停契约

准则：结构化资源仓必须可枚举、可回收；宿主关停路径须释放句柄并幂等。

- **error**（workspace-timing）：`L3-RESOURCE-TOPO`、`RES-TOPO-NAMING-DEPTH`、`RES-TOPO-OVER-DESCRIPTIVE`、`RES-TOPO-OVER-GENERIC`、`RES-TOPO-OVER-SPECIALIZED`、`RES-TOPO-RESP-MISMATCH`
- warning / info：`RES-SHUT-001`

---

## 错误、类型与接口

### `ERR` — 失败语义必须显式

准则：可失败操作必须返回可判别结果或抛出强类型错误，禁止吞异常、禁止以空值代替失败。

- **error**：`FGT-ERR-001`
- warning / info：`ERR-FLT-001`、`ERR-MSG-001`、`ERR-PRP-001`

### `TSM` — TypeScript 惯用法

准则：禁 `any`、禁 `var`、禁旧式 `require`/`substr`/`includes` 误用；构造器与展开语义须显式声明。

- warning / info：`TSM-ANY-001`、`TSM-ARGS-001`、`TSM-CTOR-001`、`TSM-DISP-001`、`TSM-INCLUDES-001`、`TSM-REPLACE-001`、
  `TSM-REQUIRE-001`、`TSM-SPREAD-001`、`TSM-SUBSTR-001`、`TSM-TYPE-001`、`TSM-VAR-001`

### `PYM` — Python 惯用法

准则：`collections.abc`、`with` 管资源、`X | None`、内建泛型、`raise ... from`、`slots=True`、禁可变默认参数。

- **error**：`PYM-ABC-001`、`PYM-ASYNC-001`、`PYM-DATETIME-001`、`PYM-GENERIC-001`、`PYM-UNION-001`
- warning / info：`PYM-DEFAULT-001`、`PYM-FSTRING-001`、`PYM-IMPORT-001`、`PYM-OPEN-001`、`PYM-PATH-001`、
  `PYM-RAISE-001`、`PYM-SHADOW-001`、`PYM-SLOTS-001`

### `RSM` — Rust 惯用法

准则：零裸 panic、`unsafe` 必须带 `// SAFETY:` 证明、`let-else` 替代单分支、`&str` 替代 `&String`、禁跨 `.await` 持锁。

- **error**：`RSM-PNC-001`
- warning / info：`RSM-CAST-001`、`RSM-CLONE-001`、`RSM-ELSE-001`、`RSM-EXP-001`、`RSM-EXTERN-001`、`RSM-FIND-001`、
  `RSM-FORMAT-001`、`RSM-LOCK-001`、`RSM-MACRO-001`、`RSM-SAF-001`、`RSM-STR-001`、`RSM-TRY-001`、
  `RSM-UNWRAP-001`

### `GOM` — Go 惯用法

准则：`context` 首参传递、错误包装用 `%w`、导出符号必须有文档注释、禁裸 `panic` 于库代码。

- warning / info：`GOM-CTX-001`、`GOM-ERR-001`、`GOM-STYLE-001`、`GOM-STYLE-002`、`GOM-STYLE-003`

### `NUM` — 数值边界与精度

准则：递归深度、循环上界必须双侧有界；缩放与舍入不得静默丢精度。

- warning / info：`NUM-BND-001`、`NUM-PREC-001`

### `SIM` — 简化与消歧

准则：形参 ≥ 4 收为参数对象、禁布尔旗标参数、禁空实现与空壳继承、守卫子句替代嵌套。

- **error**：`SIM-CMP-001`、`SIM-DED-001`、`SIM-INH-001`、`SIM-WRP-001`
- warning / info：`SIM-ARGS-001`、`SIM-ARGS-002`、`SIM-BOOL-001`、`SIM-COMC-001`、`SIM-ELSE-001`、`SIM-EMPTY-001`、
  `SIM-FLAT-002`、`SIM-GUARD-001`、`SIM-IMM-001`、`SIM-INL-001`、`SIM-LONG-001`、`SIM-PRNT-001`、
  `SIM-TRN-001`

### `ARCH` — 架构边界与门面承载

准则：分层单向直连、门面必须实质承载（ELOC ≥ 15 或冻结）、≤ 3 行透传跳板物理消融。

- **error**：`ARCH-DIR-003`、`ARCH-HDL-001`、`clean-layer-violation`
- warning / info：`ARCH-ABS-001`、`ARCH-BLR-001`、`ARCH-BND-001`、`ARCH-CFG-001`、`ARCH-CFG-002`、`ARCH-CFG-003`、
  `ARCH-CFG-004`、`ARCH-CFG-005`、`ARCH-CFG-006`、`ARCH-CFG-007`、`ARCH-CFG-008`、`ARCH-CFG-009`、
  `ARCH-DEC-002`、`ARCH-DIR-001`、`ARCH-DIR-002`、`ARCH-DISP-001`、`ARCH-DSP-002`、`ARCH-FAC-001`、
  `ARCH-GLB-001`、`ARCH-LEAK-001`、`ARCH-LEAK-002`、`ARCH-PLM-001`、`ARCH-ROL-001`、`ARCH-ROL-002`、
  `ARCH-SKL-001`、`ARCH-TMP-001`、`ARCH-UTL-001`

### `MOD` — 模块边界

准则：模块间禁止反向依赖、禁止扁平化跨层引用、导出面必须最小化。

- warning / info：`MOD-BWD-001`、`MOD-DEP-001`、`MOD-FLB-001`

---

## 依赖、常量与体积

### `DEP` — 依赖方向与供应链

准则：基础设施不得反向依赖上层；禁 devDependency 进生产、禁循环导入、禁幽灵/未固定/高危许可证依赖。

- **error**：`DEP-INV-001`、`DEP-VULN-001`、`disallowed-import`、`FGT-DEP-001`、`import-cycle`
- warning / info：`DEP-DEV-001`、`DEP-LAZ-001`、`DEP-LIC-001`、`DEP-OBS-001`、`DEP-ORD-001`、`DEP-ORD-002`、
  `DEP-PHANTOM-001`、`DEP-PIN-001`、`DEP-RES-001`、`DEP-WLD-001`、`unused-export`、`unused-module`

### `CONST` — 常量单源与分层

准则：同类字面量必须提取、跨文件同义常量零漂移、常量声明区固定、禁厨房水槽式常量仓。

- warning / info：`CONST-CLU-001`、`CONST-DRF-001`、`CONST-LAY-001`、`CONST-LAY-002`、`CONST-LIB-001`、`CONST-OWN-001`、
  `CONST-SCP-001`、`CONST-SCP-002`、`duplicate-literal`、`nested-constant`

### `VOL` — 双轨体积预算

准则：ELOC 与 LOC 双轨上限、1:3 动态包络、注释不得为避让行数而被删。

- **error**：`VOL-DOC-001`、`VOL-ELOC-001`、`VOL-LOC-001`
- warning / info：`VOL-DIL-001`、`VOL-RATIO-001`

### `BIG` — 超大文件

准则：单文件超限必须按领域拆分，而非机械切碎。

- warning / info：`large-file`

### `CMP` — 表达式与语句密度

准则：禁深层内联回调链、禁位运算与三元堆叠、禁单行多语句。

- warning / info：`CMP-CAL-001`、`CMP-DEN-001`、`CMP-EXP-001`、`CMP-LIN-001`

### `CPX` — 复杂度与空间

准则：CC ≤ 15、Depth ≤ 4、循环内零瞬态堆分配、递归必须有收敛证明。

- **error**：`CPX-REC-001`
- warning / info：`CPX-AMP-001`、`CPX-BUD-001`、`CPX-HOP-001`、`CPX-JST-001`、`CPX-NEST-001`、`CPX-NEST-002`、
  `CPX-RED-001`、`CPX-SPACE-001`、`CPX-STM-001`、`CPX-TIME-001`、`CPX-TRV-001`、`high-complexity`

### `PRF` — 热路径与内存

准则：顶层正则常量化、禁循环内重复 I/O、禁无界缓存、算法复杂度须与数据规模匹配。

- **error**：`expensive-loop-operation`、`FGT-PRF-001`、`PRF-POL-002`
- warning / info：`high-algorithmic-complexity`、`loop-transient-allocation`、`PRF-ALG-001`、`PRF-ALG-002`、
  `PRF-DUP-001`、`PRF-IO-001`、`PRF-LEAK-001`、`PRF-MEM-001`、`PRF-MEM-002`、`PRF-POL-001`、
  `PRF-POL-003`、`PRF-POL-004`

### `LAY` — 分层与依赖（layer: L2）

准则：分层单向、零循环、导入必须可解析。

- **error**（workspace-timing）：`L2-LAYERS`、`LAY-CYCLE`、`LAY-IMPORT`、`LAY-UNRESOLVED`

### `HC` — 硬编码专项（layer: L3）

准则：禁绝对路径、禁 CJK 字面量入代码、禁魔数、禁密钥，UI 串必须走字典。

- **error**（workspace-timing）：`HC-ABS-PATH`、`HC-CJK-LITERAL`、`HC-MAGIC-NUM`、`HC-SECRET`、`HC-UI-STRING`、`L3-HARDCODE`

---

## 测试、界面与平台

### `TST` — 测试工程

准则：确定性时钟与 RNG、零跳过用例、零孤儿用例、耗时回归棘轮、测试拓扑与源码同构。

- **error**（workspace-timing）：`L0-TEST`
- warning / info：`TST-DBT-001`、`TST-DEN-001`、`TST-FLT-001`、`TST-ILS-001`、`TST-ORC-001`、`TST-SKP-001`、
  `TST-TAU-001`、`TST-TOP-001`

### `UI` — 界面工程与交互物理

准则：语义明度阶梯、单闭合边框、二阶阻尼动效、感知幂律遮罩。

- warning / info：`UI-ENG-001`、`UI-ENG-002`、`UI-ENG-003`、`UI-ENG-004`、`UI-ENG-005`、`UI-ENG-006`、`UI-ENG-007`、
  `UI-ENG-008`

### `VSC` — VS Code 扩展契约

准则：100% 双语字典、RingBuffer + Journal 崩溃安全、状态栏刷新有界、内存与性能预算。

- **error**：`VSC-MEM-001`、`VSC-UI-002`
- warning / info：`VSC-I18N-001`、`VSC-PERF-001`、`VSC-PERF-002`、`VSC-UI-001`、`VSC-UI-003`、`VSC-UI-004`

### `PROD` — 生产构建洁净度

准则：产物零 console/TODO、零 sourcemap 外泄、零服务端环境变量泄漏到客户端包。

- **error**：`PROD-HYG-001`、`PROD-HYG-002`、`PROD-HYG-003`

### `SEC` — 安全与暴露面

准则：内部端点不得进客户端包、视觉隐藏不构成鉴权、密钥零硬编码、实验路由不得打包。

- **error**：`SEC-EXP-001`、`SEC-EXP-002`、`SEC-EXP-004`、`SEC-EXP-005`、`SEC-VUL-001`、`SEC-VUL-002`、
  `secret-detected`
- warning / info：`high-entropy-token`、`SEC-EXP-003`、`SEC-LEAK-001`、`SEC-VUL-003`、`SEC-VUL-004`、`SEC-VUL-005`、
  `SEC-VUL-006`

### `DAT` — 数据访问

准则：禁 N+1 查询、禁无界全表加载、持久化驱动不得泄漏进业务核心。

- **error**：`DAT-NPL-001`
- warning / info：`DAT-DEF-001`、`DAT-LAY-001`、`DAT-QRY-001`、`DAT-RES-001`、`DAT-SER-001`

### `STDLIB` — 标准库使用

准则：禁 panic 型标准库调用、分配必须可控、平台相关 API 须有移植层、递归须有界。

- **error**：`STDLIB-ALLOC-001`、`STDLIB-UNSAFE-001`
- warning / info：`STDLIB-CONST-001`、`STDLIB-PANIC-001`、`STDLIB-PORT-001`、`STDLIB-RECURSION-001`

### `SH` — Bash 惯用法

准则：`set -euo pipefail`、变量与命令替换必须加引号、错误平铺捕获、禁无守卫交互读取。

- **error**：`SH-EOL-001`、`SH-SAFE-001`、`SH-SEC-001`、`SH-TRAP-001`
- warning / info：`SH-ARRAY-001`、`SH-CMD-001`、`SH-COND-001`、`SH-DEPR-001`、`SH-DOC-001`、`SH-ECHO-001`、`SH-ERR-001`、
  `SH-EXIT-001`、`SH-INIT-001`、`SH-QUOTE-001`、`SH-READ-001`

### `PS` — PowerShell 惯用法

准则：Verb-Noun 命名、`[CmdletBinding()]`、禁 `iex` 动态执行、句柄必须 `try/finally` 释放。

- **error**：`PS-SAFE-001`、`PS-SEC-001`
- warning / info：`PS-ALIAS-001`、`PS-CMDLET-001`、`PS-DOC-001`、`PS-ERROR-001`、`PS-PARAM-001`、`PS-TRAP-001`、
  `PS-VERB-001`

### `GDM` — GDScript 引擎契约

准则：节点路径与 `@onready` 时序、信号连接/断开成对、对象池零分配、导出与 i18n 单源。

- **error**：`GDM-ISO-001`、`GDM-POL-001`、`GDM-PRF-001`
- warning / info：`GDM-BAR-001`、`GDM-BND-001`、`GDM-CONNECT-001`、`GDM-DEB-001`、`GDM-EXPORT-001`、`GDM-EXT-001`、
  `GDM-FSM-001`、`GDM-I18N-001`、`GDM-LOC-001`、`GDM-NOD-001`、`GDM-ONREADY-001`、`GDM-POOL-001`、
  `GDM-POOL-002`、`GDM-RES-001`、`GDM-RPC-001`、`GDM-SIG-001`、`GDM-TOK-001`、`GDM-TOOL-001`、
  `GDM-UNI-001`、`GDM-VRT-001`、`GDM-WEAK-001`、`GDM-YIELD-001`

### `ADV` — 高性能脚本与引擎约束

准则：循环零堆分配、连续缓冲区、对象池 `reset_state()`、随机源可播种、事件派发有界。

- **error**：`ADV-BND-001`、`ADV-CFG-001`、`ADV-DEC-001`、`ADV-EVT-001`、`ADV-EVT-002`、`ADV-EVT-003`、
  `ADV-EVT-004`、`ADV-LAM-001`、`ADV-NAM-001`、`ADV-POOL-001`、`ADV-PRF-001`、`ADV-PRF-002`、
  `ADV-RNG-001`、`ADV-SIG-001`、`ADV-TYP-001`、`ADV-TYP-002`、`ADV-TYP-003`
- warning / info：`ADV-CFG-002`、`ADV-PRF-003`、`ADV-PRF-004`、`ADV-UI-001`

### `UUID` — 重入与幂等

准则：可重入路径必须幂等，重复触发不得产生重复副作用。

- **error**：`UUID-REENTRANT-001`

### `ENG` — 分析器自身故障

准则：分析器单文件异常必须降级为诊断而非中断整轮扫描。

- warning / info：`analyzer-error`

### `EXT` — 外部目录边界

准则：扫描与写入必须限定在受控目录内，越界即拒绝。

- **error**：`EXT-DIR-001`

### `BLD` — 编译基线（layer: L0）

准则：代码必须可编译，禁止以跳过换取绿色。

- **error**（workspace-timing）：`L0-COMPILE`

### `LINT` — 静态检查基线（layer: L1）

准则：Lint 与格式检查零告警，禁止以忽略标记掩盖。

- **error**（workspace-timing）：`L1-*`、`L1-LINT`

### `TB` — 测试预算与棘轮（layer: L4）

准则：测试耗时预算、基线必须存在、超预算即回退。

- **error**（workspace-timing）：`L4-TEST-BUDGET`、`TB-NO-BASELINE`、`TB-REGRESSION`

---

## 治理与门禁

### `GOV` — 运行时治理契约

准则：异常不得吞、日志必须可脱敏、类型契约不得双写、防刷分熔断必须真实触发。

- **error**：`GOV-AGN-001`、`GOV-EXC-001`、`GOV-EXC-003`、`GOV-MNT-002`、`GOV-PRF-003`、`GOV-RUL-001`、
  `GOV-SLC-001`、`GOV-TRJ-001`
- warning / info：`GOV-ARC-001`、`GOV-BLS-001`、`GOV-DAT-001`、`GOV-DBG-001`、`GOV-EXC-002`、`GOV-FIL-001`、
  `GOV-FIL-002`、`GOV-GAM-001`、`GOV-HOK-001`、`GOV-LOG-001`、`GOV-LOG-002`、`GOV-MNT-001`、
  `GOV-MSG-001`、`GOV-PRF-001`、`GOV-PRF-002`、`GOV-PRF-004`、`GOV-PRF-005`、`GOV-RTC-002`、
  `GOV-SAN-001`、`GOV-SAN-002`、`GOV-STD-001`、`GOV-STD-002`、`GOV-TYP-001`、`GOV-TYP-002`、
  `GOV-TYP-003`、`GOV-TYP-004`、`GOV-TYP-005`、`GOV-TYP-006`

### `GUARD` — 门禁与守卫

准则：AST 切片预算、语义步骤登记、反馈状态词闭包、双平台同构对、SSOT 零漂移。

- **error**：`GUARD-AST-001`、`GUARD-CHAIN-001`、`GUARD-COUNT-001`、`GUARD-DOC-001`、`GUARD-ENT-001`、
  `GUARD-ERR-001`、`GUARD-FAC-001`、`GUARD-FBK-001`、`GUARD-HYG-001`、`GUARD-MSG-002`、`GUARD-MSG-003`、
  `GUARD-ORD-001`、`GUARD-PROC-001`、`GUARD-ROUTE-001`、`GUARD-SHELL-001`、`GUARD-STEP-001`、
  `GUARD-SYS-001`
- warning / info：`GUARD-BUDGET-001`、`GUARD-HOOK-001`、`GUARD-ISO-001`、`GUARD-MSG-001`、`GUARD-PAIR-001`、
  `GUARD-SSOT-001`

### `HYG` — 物理卫生

准则：零空文件、`.ps1` CRLF 其余 LF、UTF-8 无 BOM、单 EOF、纯空格缩进、目录名 kebab-case。

- **error**：`HYG-BOM-001`、`HYG-CLT-001`、`HYG-DIR-001`、`HYG-EMP-001`、`HYG-EMP-002`、`HYG-EOL-001`、
  `HYG-SUP-001`
- warning / info：`HYG-BLT-001`、`HYG-CLN-001`、`HYG-DED-001`、`HYG-EXC-001`、`HYG-IND-001`、`HYG-NAM-001`、
  `HYG-SGL-001`、`HYG-STB-001`、`HYG-STB-002`、`HYG-TRL-001`、`HYG-WRAP-001`、`HYG-WRAP-002`

### `CMG` — 提交说明规范

准则：必填项目归属、实质字数下限、零黑话、零夸大、验证段禁流水账。

- **error**：`CMG-PRJ-001`、`CMG-STY-001`、`CMG-STY-002`、`CMG-STY-003`、`CMG-STY-004`、`CMG-STY-005`、
  `CMG-STY-006`、`CMG-STY-007`、`CMG-STY-008`

### `RCFG` — 规则元治理

准则：规则 ID 双向闭包、计数口径与真源一致、表现层与底层诊断去重。

- **error**：`RCFG-COUNTS-001`
- **error**（workspace-timing）：`L3-REVIEW-CONFIG`、`RCFG-GLOBS`、`RCFG-MATRIX`、`RCFG-RULE-DRIFT`、`RCFG-SCHEMA`、`RCFG-TOOL-PATH`

### `SCR` — 脚本库标准（layer: L3）

准则：脚本命名、头契约与注册表双向完备：既无孤儿也无悬空。

- **error**（workspace-timing）：`L3-SCRIPT-STANDARD`、`SCR-DANGLING`、`SCR-HEADER`、`SCR-NAMING`、`SCR-ORPHAN`

### `ARF` — 重构门槛（layer: L5）

准则：重构必须有净收益与等价性证明，禁止表面搬移。

- **error**（workspace-timing）：`ARF-*`、`L5-REFACTOR`

---

## fractal-git 原生内核

### `ALG` — 算法等价性

准则：原生算子必须与参考实现差分等价。

- **error**：`FGT-ALG-001`

### `BRG` — 桥接层

准则：FFI/桥接边界必须显式声明所有权与生命周期。

- **error**：`FGT-BRG-001`

### `CAS` — 无锁 CAS

准则：CAS 循环必须处理 ABA 与内存序。

- **error**：`FGT-CAS-001`

### `COR` — 核心不变量

准则：核心数据结构的前置/后置不变式必须可断言。

- **error**：`FGT-COR-001`

### `FAC` — 门面承载

准则：crate 门面必须实质承载，禁止空壳转发。

- **error**：`FGT-FAC-001`

### `GAT` — 门禁自审

准则：内核门禁必须自证检出能力。

- **error**：`FGT-GAT-001`

### `IDX` — 索引安全

准则：索引访问必须边界检查或形式证明。

- **error**：`FGT-IDX-001`

### `LCK` — 锁纪律

准则：禁跨 await 持锁、锁粒度最小化。

- **error**：`FGT-LCK-001`

### `OBJ` — 对象生命周期

准则：对象池借还必须成对且幂等。

- **error**：`FGT-OBJ-001`

### `POL` — 策略注入

准则：策略必须可替换，禁止硬编码分支。

- **error**：`FGT-POL-001`

### `SAF` — unsafe 最小化

准则：`unsafe` 必须有 `// SAFETY:` 证明且作用域最小。

- **error**：`FGT-SAF-001`

### `STO` — 存储层

准则：持久化写入必须原子且可恢复。

- **error**：`FGT-STO-001`

### `TOP` — 拓扑

准则：模块拓扑单向，禁止反向引用。

- **error**：`FGT-TOP-001`

### `TRN` — 事务

准则：事务边界必须显式，失败须回滚。

- **error**：`FGT-TRN-001`

---
