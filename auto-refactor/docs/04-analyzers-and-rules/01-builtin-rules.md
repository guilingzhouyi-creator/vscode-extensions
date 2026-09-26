# 内置分析器与重构规则 (Built-in Analyzers & Rules)

> **所属模块**：`04-analyzers-and-rules`  
> **核心源码**：`src/analyzers/constants.ts`, `src/analyzers/complexity.ts`, `src/analyzers/largeFile.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**
>
> **规则单一真源**：全部规则的身份 / 归属分析器 / 语言范围 / 默认级别 / 意图 / 治理建议登记在
> `src/core/rules/registry.ts`（按域拆分为 `entries/{analyzers,governance,platform}.ts`）。
> `scripts/validate-rules-registry.js`（`npm test`）强制「注册表 ↔ 实现可产出集 ↔ 本文档」三方一致，
> 并打印命名分布（canonical / legacy）与文档覆盖率；本文档尚未覆盖的规则以该守卫输出为准，随文档生成批次补齐。

---

## 1. 常量与字面量分析器 (`constants`)

负责检测代码库中散落的硬编码常量，提供自动重构命名建议：

| 规则 ID | 级别 | 触发条件 | 自动重构建议 |
| :--- | :--- | :--- | :--- |
| `magic-number` | `warning` | 出现非琐碎（非 0, 1, -1 等）的未绑定数字字面量。 | `const CONST_<num> = <num>;` |
| `hardcoded-string` | `warning` | 长度超过阈值（默认 ≥ 3）的硬编码字符串。 | `const EXTRACTED_STRING = "...";` |
| `duplicate-literal` | `warning` | 同一文件内相同字面量出现频次超标（默认 ≥ 3 次）。 | 自动聚合多处行号并提示提取共享常量。 |
| `nested-constant` | `warning` | 常量化定义出现别名套壳（`const A = B`）、深层嵌套结构或作用域内伪常量。 | 直接内联、单源声明或提升为模块顶层常量。 |

---

## 2. 圈复杂度分析器 (`complexity`)

计算函数、类方法、箭头函数与静态块内的 McCabe 圈复杂度：

* **基础分值**：基础复杂度为 1。
* **分支计数**：每个 `if`, `for`, `while`, `catch`, `case`, `&&`, `||`, `??`, 三元表达式 `? :` 均递增 1。
* **分级告警**：
  * 复杂度 $\ge \text{complexityWarn}$（默认 10）：发出 `warning` 级别告警；
  * 复杂度 $\ge \text{complexityFail}$（默认 20）：升级为 `error` 级别告警。

**规则明细**

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `high-complexity` | `warning` | 函数 McCabe 圈复杂度达到 `complexityWarn`（默认 10）即告警；达到 `complexityFail`（默认 20）时引擎按 `error` 上报。 | 抽取具名步骤、早返回替代嵌套分支，或按职责拆分函数。 |

---

## 3. 文件尺寸与超长函数分析器 (`fileSize` / `largeFile`)

* **文件行数告警 (`large-file`)**：源码总行数（排除空行后）超过 `maxFileLines`（默认 500 行）时发出告警，建议进行模块拆分。
* **函数行数告警 (`large-function`)**：单个函数体行数超过 `maxFunctionLines`（默认 80 行）时告警，建议提炼子函数。

**规则明细**

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `large-file` | `warning` | 文件总行数或函数数达到阈值：`fileLinesWarn`（默认 400）、`fileLinesFail`（默认 800）或 `fileFunctionsWarn`（默认 15）；达到 `fileLinesFail` 时引擎按 `error` 上报。 | 按职责拆分模块，或把工具函数迁到专属文件。 |

---

## 4. 现代化跨语言编程规范审查器 (`governance` — 跨语言规范内化改造)

面向多语言（TypeScript/JavaScript、GDScript、Rust、Python、Shell、PowerShell）的统一工程规范审查层，抽象自 WebGames 脚本治理方法：

$$\text{通用规范原则} \longrightarrow \text{语言能力适配层} \longrightarrow \text{具体规则} \longrightarrow \text{静态检查} \longrightarrow \text{等价安全修复/建议}$$

| 规范类别 | 规则 ID | 级别 | 说明与判定依据 | 是否可自动修复 |
| :--- | :--- | :--- | :--- | :---: |
| **标准化写法** | `GOV-STD-001` | `warning` | 冗余布尔逻辑 (`if (x) return true; else return false;` $\to$ `return x;`) | ✅ 可安全修复 |
| **标准化写法** | `GOV-STD-002` | `warning` | 过时或冗余语法模式 (TS/JS `var` $\to$ `let/const`；GDScript 冗余 `pass`) | ✅ 可安全修复 |
| **文件结构** | `GOV-FIL-001` | `warning` | 文件命名规范性校验 (TS: kebab-case, GD/Rust/Python/Shell: snake_case) | 建议重命名 |
| **文件结构** | `GOV-FIL-002` | `info` | 关键模块责任头注释与文档契约检查（含头声明路径与物理路径一致性校验） | 建议补充/修正 |
| **代码逻辑** | `GOV-LOG-001` | `warning` | 控制流深层嵌套治理（嵌套深度 $> 5$ 告警，推崇 Guard Clauses 卫语句） | 建议重构 |
| **代码逻辑** | `GOV-LOG-002` | `info` | 空层转发与无意义包装方法治理 | 建议内联 |
| **类型体系** | `GOV-TYP-001` | `warning` | 隐式弱类型分配 (GDScript `var =` $\to$ `:=` / `: Type =`) | ✅ 可安全修复 |
| **类型体系** | `GOV-TYP-002` | `warning` | 导出与公共函数签名完整性 (GDScript/Python 显式返回值标注 `-> Type`) | 建议标注 |
| **类型体系** | `GOV-TYP-003` | `warning` | 危险裸 `any` 类型逃逸检查 | 建议精准类型 |
| **类型体系** | `GOV-TYP-004` | `warning` | 契约强迫性类型逃逸 (`undefined as any` / `null as any` 违背 ISP) | 建议声明可选或拆解接口 |
| **类型体系** | `GOV-TYP-005` | `warning` | 危险裸属性穿透 (`(expr as any).prop` 绕过类型守卫) | 建议使用标准类型守卫 |
| **异常容错** | `GOV-EXC-001` | `error` | 空 `catch` / 裸 `except:` 吞异常治理 (TS/JS `catch {}`，Python 裸 `except:` 及 swallowed `pass`)。**注释携带理由标记**（`best-effort` / `ignore` / `intentional` / `expected`）的 catch 视为已记录决策，不再报；无理由的注释-空 catch 仍报 | 建议兜底 |
| **异常容错** | `GOV-EXC-002` | `warning` | 生产路径裸 `.unwrap()` 未受保护 panic 治理 | 建议 `?` 传播 |
| **调试隔离** | `GOV-DBG-001` | `warning` | 生产路径残留 `console.log` / `print()` / `println!` 泄露治理 | 建议 Logger |
| **性能规范** | `GOV-PRF-001` | `warning` | 循环热路径内不变配置读取/频繁 IO/重复对象分配提升建议 | 建议循环外提升 |
| **性能规范** | `GOV-PRF-002` | `info` | 循环体内线性查找未索引化治理 (建议转换为 Map/Set $O(1)$) | 建议哈希索引 |
| **性能规范** | `GOV-PRF-005` | `info` | 循环体内部调用未索引数组对象的 `.includes()` / `.indexOf()` 线性查找 | 建议循环外提升预建 Set 索引 |
| **可维护性** | `GOV-MNT-001` | `warning` | 面向对象类多层继承约束（继承深度 $> 2$，推崇组合优于继承） | 建议组合重构 |
| **可维护性** | `GOV-MNT-002` | `error` | 核心纯领域模型反向耦合外部框架/UI 依赖审查 | 建议端口适配 |
| **可维护性** | `GOV-DAT-001` | `info` | 函数入参离散参数过多 (≥ 5) 数据泥团坏味道 | 建议聚合为 Context 或 Options 接口 |
| **可维护性** | `GOV-SAN-001` | `warning` | 词法卫生与临时批次黑话拦截 (注释中残留的 pXX/phaseXX/stXX/wip 临时工单标记) | 建议清理黑话 |
| **协同治理** | `GOV-AGN-001` | `error` | 多 Agent 并发改动制造跨模块循环依赖、分层倒置或破坏公共契约审查 | 协调架构边界与依赖职责 |
| **增量切片** | `GOV-SLC-001` | `error` | AST 切片改动引入破坏性签名漂移或向外部调用链扩散不可控副作用 | 确保切片向后兼容或同步重构调用者 |
| **轨迹学习** | `GOV-TRJ-001` | `error` | 历史改造轨迹呈现循环震荡修改或反向退化重新引入反模式审查 | 维护单向演进质量与重构收益 |

### 治理规则明细（规则 ID 口径）

下表按注册表逐条列出规则 ID、默认级别、触发条件与治理建议（与上方类别矩阵同源，便于按 ID 检索并与覆盖率守卫核对）：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `GOV-STD-001` | `warning` | 冗余布尔逻辑：`if (x) return true; else return false;` 一类可直接返回布尔表达式的写法。 | 直接 return 布尔表达式，去掉 if/else 包装。 |
| `GOV-STD-002` | `warning` | 过时或冗余语法模式：现代 TS/JS 仍使用 `var`，GDScript 残留冗余 `pass`。 | 替换废弃构造（var、legacy 键名等）为现代等价写法。 |
| `GOV-FIL-001` | `warning` | 文件命名不符合语言契约（TS kebab-case；GDScript/Rust/Python/Shell snake_case），引发跨平台大小写与模块发现问题。 | 按语言命名契约重命名文件（kebab-case 或 snake_case）。 |
| `GOV-FIL-002` | `info` | 关键生产模块缺少架构角色与职责边界声明，或头部声明路径与物理路径不一致。 | 修正文件头声明路径，或补齐缺失的头部字段。 |
| `GOV-LOG-001` | `warning` | 控制流嵌套深度超过 5 层，认知负荷与缺陷风险升高。 | 降低嵌套：卫语句早返回、抽取子步骤或扁平化分支。 |
| `GOV-LOG-002` | `info` | 空层转发：方法仅做直通式包装，没有校验或语义转换。 | 去掉直通式包装，让调用方直达目标或合并职责。 |
| `GOV-GAM-001` | `warning` | 防刷分违规：检测到机械切分函数或恒真断言等虚假提升指标行为。 | 保持业务内聚并编写有实质断言的真实测试用例，杜绝空样板与假测试。 |
| `GOV-TYP-001` | `warning` | 隐式弱类型赋值：变量或参数缺少类型注解，类型错误推迟到运行时才暴露。 | 为变量/参数补齐类型注解。 |
| `GOV-TYP-002` | `warning` | 导出或公共函数签名缺少返回类型标注（GDScript/Python 未写 `-> Type`）。 | 为函数补齐返回类型注解。 |
| `GOV-TYP-003` | `warning` | 类型位置出现危险裸 `any`，绕过编译器类型检查。 | 裸 any 换成 unknown 或具体联合；动态边界用受控断言并注释理由。 |
| `GOV-TYP-004` | `warning` | 参数或赋值使用 `undefined as any` 或 `null as any` 强行逃逸类型检查。 | 将目标参数声明为可选联合类型或拆分专有接口，消除强制类型断言。 |
| `GOV-TYP-005` | `warning` | 通过 `(expr as any).prop` 盲目读取未受检属性。 | 使用标准类型收窄谓词（如 ts.canHaveModifiers 或 isXxx）保护属性访问。 |
| `GOV-TYP-006` | `warning` | 导出的公共函数、类方法缺少显式返回类型注解，导致跨包跨模块调用依赖隐式推断甚至引发类型破损。 | 为导出的公共函数、箭头函数与类方法补充显式返回类型注解。 |
| `GOV-EXC-001` | `error` | 空 `catch` / 裸 `except:` 静默吞异常；catch 内带理由标记（best-effort / ignore / intentional / expected）视为已记录决策，不再上报。 | 处理/记录/显式重抛；确属 best-effort 时在 catch 内写明理由标记。 |
| `GOV-EXC-002` | `warning` | 生产路径裸 `.unwrap()` / `expect` 在 Err 或 None 时导致不可恢复 panic。 | 避免裸 unwrap/expect，改为显式错误分支或 Result/Option 传播。 |
| `GOV-EXC-003` | `error` | 伪处理 catch/except 块：使用 `void 0`、无用变量赋值等 dummy 语句静默吞噬异常，未记日志也无 rationale 标记。 | 处理/记录/显式重抛；确属 best-effort 时在注释写明理由标记。 |
| `GOV-DBG-001` | `warning` | 生产路径残留 `console.log` / `print()` / `println!` 等调试输出，污染标准输出、泄漏诊断信息并拖慢 I/O。 | 删除调试输出，或改用结构化日志并按级别输出。 |
| `GOV-PRF-001` | `warning` | 循环体内执行不变量 I/O、正则构造或重复配置读取，造成 CPU/吞吐损耗。 | 循环不变量外提，把不变计算移出循环体。 |
| `GOV-PRF-002` | `info` | 循环体内调用 `.find` / `.indexOf` / `.includes` 线性查找，复杂度退化为 O(N*M)。 | 用 Set/Map 承载查找，消除循环内线性扫描。 |
| `GOV-PRF-003` | `error` | 定时器使用数字字面量延时绕过集中钳制；字面量 ≤ 0 会触发约 1ms 忙循环热点。 | 定时器延时常量具名或走集中配置，避免绕过统一钳制。 |
| `GOV-PRF-004` | `warning` | 同步 fs 调用阻塞宿主事件循环（IDE 扩展 UI 卡顿、服务端请求停顿）。 | 改用异步 IO；进程式 CLI 路径可用 blockingIoAllowPatterns 声明豁免。 |
| `GOV-PRF-005` | `info` | 循环体内调用数组 `.includes` / `.indexOf` 线性查找，复杂度退化为 O(N*M)。 | 在循环前使用 `const set = new Set(arr)` 预建索引，循环内改用 `.has()` 检索。 |
| `GOV-MNT-001` | `warning` | 类继承深度超过 2 层，出现脆弱基类问题。 | 收敛继承层级：组合优先，或抽公共能力为独立模块。 |
| `GOV-MNT-002` | `error` | 核心纯领域模型反向导入 UI/CLI 表现层框架，产生严重耦合。 | 反转依赖：内层定义端口/接口，由外层实现。 |
| `GOV-DAT-001` | `info` | 函数入参离散参数过多 (≥ 5)，出现数据泥团 (Data Clumps) 坏味道。 | 将离散参数群聚合为强类型的结构化上下文模型（如 Context 或 Options 接口对象）。 |
| `GOV-SAN-001` | `warning` | 代码或注释残留临时工单/批次黑话（pXX、phaseXX、stXX、wip），损害架构寿命并造成文档漂移。 | 移除临时工单/批次黑话，改用长效领域术语。 |
| `GOV-AGN-001` | `error` | 多 Agent 并发修改导致架构边界突破、跨模块循环依赖闭环或公共契约破坏。 | 协调并行 Agent 的架构边界与修改职责，消解跨模块并发循环依赖并维护单向分层契约。 |
| `GOV-SLC-001` | `error` | AST 切片改动引入破坏性签名漂移或向外部调用链扩散不可控副作用。 | 确保切片改动向后兼容，或同步重构受影响调用链上的全部外部调用者。 |
| `GOV-TRJ-001` | `error` | 历史演化轨迹呈现循环震荡（Flip-Flop）或反向退化，死灰复燃已被重构配方消除的架构反模式。 | 确保演化轨迹保持单调质量提升，避免在后续修订中死灰复燃已被重构配方消除的架构反模式。 |
| `GOV-MSG-001` | `warning` | 底层诊断消息与建议必须统一采用标准英文并由常量字典集中管控，严禁在分析器发射点硬编码内联或非 ASCII 文本。 | 将内联提示提取至 `src/core/messages/` 集中常量池，并确保文案符合英语工业技术标准。 |
| `GOV-RTC-002` | `warning` | 基线债务记录必须感知物理文件重命名，单调递减门禁在重构发生时必须重映射历史基线至新路径。 | 在基线更新与门禁收敛中应用重命名路径规范化映射 (pathRemap)，确保文件重构后既有基线连续继承，杜绝因重命名引发基线虚增或债务逃逸。 |

### 统一结构化诊断契约

每项问题严格输出：
$$\text{问题位置} \longrightarrow \text{规范类别} \longrightarrow \text{当前风险} \longrightarrow \text{判定依据} \longrightarrow \text{修改建议} \longrightarrow \text{是否可自动修复}$$
通过 `Issue.detail`（`category`, `risk`, `rationale`, `fixable`, `targetLanguage`, `suggestedPatch`）与 CI/SARIF 报告格式原生集成。

---

## 5. 架构分层守卫分析器 (`architecture`)

负责守卫 DDD (领域驱动设计) 与整洁架构边界，防止核心模型退化：

| 规则 ID | 级别 | 触发条件 | 自动重构/治理建议 |
| :--- | :--- | :--- | :--- |
| `ARCH-DIR-001` | `error` | 核心逆流：领域层 (Domain) 反向依赖外层应用层/基础设施/接口层。 | 倒置依赖，在领域层定义接口契约，由外层实现。 |
| `ARCH-DIR-002` | `warning` | 越层穿透：接口层控制器绕过应用层直接直连基础设施实现。 | 引入用例服务 (Application Service) 统筹业务流。 |
| `ARCH-LEAK-001` | `error` | 职责泄漏：纯领域模型直接引用或泄漏外部框架库 (Express/Vue/Godot/ORM)。 | 领域模型使用 POJO/原生实体，隔离外部框架专有类型。 |
| `ARCH-LEAK-002` | `warning` | 分层越界：外层实现被内层直接反向引用（Clean/DDD 层序反转）。 | 把依赖改回单向（内层定义接口、外层实现），或把该文件移入正确层。 |
| `ARCH-DISP-001` | `warning` | 巨石分支分发器：单一函数内 switch/if-else 分支过多 (≥ 8) 且紧耦合各分支业务逻辑。 | 重构为查表映射 (Table-driven) 或策略对象模式 (Strategy Pattern)。 |
| `ARCH-DSP-002` | `warning` | 分发器闭包碎片化：单一对象字面量内连续定义过多匿名单行函数闭包 (≥ 15)。 | 重构为按职责正交划分的 switch 分发函数（圈复杂度 ≤ 10）或顶层具名函数。 |
| `clean-layer-violation` | `error` | 增量管线中的分层越界（clean-layer 口径）。 | 按层序调整依赖方向或把实现下沉/上提到正确层。 |

### 依赖图与导入边界 (`dependency-graph`)

跨文件依赖图后处理通道（覆盖 TS/JS 与 Python 导入提取；函数内惰性导入与 docstring 示例不建边）：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `disallowed-import` | `error` | 声明式导入边界违规：跨组依赖或未授权外部包（对照 `allowGroups` / `allowExternal` 配置）。 | 按配置的 allowGroups/allowExternal 调整导入，或显式登记豁免。 |
| `import-cycle` | `error` | 模块级循环依赖（含 Python 相对导入与包解析）。 | 把共享契约下沉为独立模块，或用惰性导入打断环（惰性导入不建边）。 |
| `unused-export` | `warning` | 导出符号无人引用（TS/JS 口径；Python 无 export 关键字不参与）。 | 删除无人使用的导出，或把它收回模块内部。 |
| `unused-module` | `warning` | 模块无人导入且不在入口白名单内。 | 删除该模块，或把入口 glob 加入 entryGlobs。 |

---

## 6. 高阶算法与热点性能分析器 (`performance`)

负责静态探查算法时间/空间复杂度瓶颈与事件循环阻塞风险：

| 规则 ID | 级别 | 触发条件 | 优化建议 |
| :--- | :--- | :--- | :--- |
| `PRF-ALG-001` | `warning`/`error` | 发现 $\ge 3$ 层循环嵌套 (潜在 $O(N^3)$ 多项式计算热点)。 | 将内层查找通过 Map/Set 哈希预索引降维为 $O(1)$。 |
| `PRF-MEM-001` | `info` | 高频热路径瞬态堆对象分配 (循环体内 `new Array`, `new Object`, `.duplicate(true)` 等)。 | 将缓冲区/对象提升至循环外部复用，循环内仅清空重置。 |
| `PRF-MEM-002` | `warning` | 跨语言循环热路径高危类实例化与深拷贝（违背 `ADV-PRF-002` 零瞬态堆分配契约）。 | 严禁循环内频繁分配；引入对象池并在借出/回收时通过 `reset_state()` 重置，或提升至循环外复用。 |
| `PRF-IO-001` | `warning`/`error` | 事件循环同步阻塞风险：在 `async` 上下文或高频帧循环内调用同步阻塞 I/O (如 `readFileSync`, `time.sleep`)。`thresholds.blockingIoAllowPatterns` 声明的路径 glob（CLI/校验器/基准脚本等进程式工具）豁免；该键同时下发给治理规则 `GOV-PRF-004`，属单一策略源。 | 切换为异步非阻塞对应 API，避免锁死 Node.js 事件循环或游戏主线程。 |
| `PRF-LEAK-001` | `warning` | 检测循环或定时器内的集合无界追加，防范 $O(t)$ 或 $O(n)$ 内存泄漏。 | 为集合设置容量上限/LRU淘汰/定期重置，或避免在循环与定时器内无界追加。 |

> **`PRF-LEAK-001` 启用口径**：**opt-in**——需在 `analyzers.performance.options.checkUnboundedGrowth: true`
> 显式声明后才参与扫描。与 `crossFileLiteralClusters`、`errorPropagation` 及各语言包一致：内容启发式
> 检测不得因分析器本身启用就静默进入既有使用方的门禁。判定读取共享掩码视图（`src/core/sourceMask.ts`），
> 集合"是否有界"仅认针对该集合名的证据，不认文件级关键词；当前集合声明语法为 JS/TS 形态
> （`const`/`let`/`var`、类字段、`this.` 赋值），其它语言需先补夹具再扩声明。

---

## 7. 命令参数分级注释审查器 (`comments`)

支持 `--comment-level <off|basic|standard|strict>` 阶梯式审查体系：

| 规则 ID | 级别 | 适用品级 | 判定依据 |
| :--- | :--- | :--- | :--- |
| `CMT-HDR-001` | `info` | `basic` 及以上 | 源码文件顶部缺少文件层级职责与设计意图注释。 |
| `CMT-HDR-002` | `warning` | `strict` | 工业级严格题头契约缺失六字段之一 (模块归属、文件路径、架构定位、依赖与触发、职责说明、退出语义与设计依据)。 |
| `CMT-HDR-003` | `error` | `strict` | 题头声明路径与物理文件路径失真不一致。 |
| `CMT-DOC-001` | `info`/`warning`| `standard` 及以上 | 核心公开导出符号缺少功能描述、参数或返回值 Docstring/JSDoc 说明。 |
| `CMT-DOC-002` | `warning` | `standard` 及以上 | 机械无意义冗余注释 (注释文本仅重复函数名或符号名)。 |
| `CMT-CON-001` | `info` | `strict` | 异步导出方法未注明并发调度假设、可重入性或幂等语义。 |
| `CMT-MOJI-001` | `error` | `basic` 及以上 | 编码损坏（U+FFFD 替换符、UTF-8 被按 Latin-1 解码的 `Ã`+高位字节、Windows-1252 智能引号乱码）。跨语言通用。 |
| `CMT-WID-001` | `warning` | `standard` 及以上 | 注释/docstring 物理行宽超过 100 列；工具指令行（`noqa`/`type: ignore`/`eslint-disable`/`@ts-expect-error` 等）以及 `comments.options.directiveTokens` 声明的项目自有指令豁免。 |
| `CMT-SEP-001` | `warning` | `standard` 及以上 | 同一文件混用短标题分隔（`── 标题 ──`）与长串分隔（`──── 标题`）；纯分隔线豁免。 |
| `CMT-BAN-001` | `warning` | `standard` 及以上 | 不足 150 行的小文件使用 `═` 文件级横幅。 |

---

## 8. 全方位代码卫生中枢 (`hygiene`)

跨语言代码坏味道、未决桩与命名风格看守：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `HYG-DED-001` | `warning` | 终结控制流 (`return/throw/break/raise/exit`) 之后存在不可达死代码。 | 清理冗余死代码，重构控制流分支。 |
| `HYG-CLN-001` | `warning` | 基于 32-bit 滚动多项式哈希检测到连续多行代码完全重复 (Copy-Paste)。 | 抽象提炼共享通用函数或工具类。 |
| `HYG-NAM-001` | `info`/`warning` | 命名风格失真 (TS/JS 源码非 kebab-case，GDScript/Python/Rust 非 snake_case)。 | 对齐各语言官方主流工程命名契约。 |
| `HYG-STB-001` | `info` | 代码或注释中残留 `TODO`, `FIXME`, `XXX`, `HACK` 等临时未决桩标记。 | 闭环开发任务，清理临时桩。 |
| `HYG-STB-002` | `warning` | 全域代码与注释中泄漏临时施工工单黑话 (`pXX`, `phaseXX`, `stXX`, `wip`)。词汇表可用 `hygiene.options.jargonPatterns`（正则源数组）替换为**项目自有**词表，避免项目词被误判或被整条规则静音。 | 使用中立、长效的业务领域术语替换临时工单代号。 |
| `HYG-BLT-001` | `warning` | Python：局部变量或函数参数遮蔽内建名。类体字段视为协议契约豁免；参数级 `id/type/help/format/input/next` 与 `self/cls` 豁免；docstring 示例不视为活代码。 | 重命名绑定（加领域限定词），避免掩盖内建语义。 |
| `HYG-SGL-001` | `warning` | Python：赋值/循环/with/参数出现单字母名。仅 `i`/`j`/`k`/`_` 放行。 | 使用描述性命名。 |
| `HYG-EXC-001` | `warning` | Python：`except ... as <name>` 的变量名不是 `exc`。 | 统一命名为 `exc`，让错误处理读起来一致。 |
| `HYG-WRAP-001` | `warning` | 空层转发与无意义包装函数：单一函数仅透传参数至内部目标函数而无任何参数转换、校验、日志或错误处理。 | 直接调用目标方法，或为包装层补充数据校验、状态转换与上下文日志。 |
| `HYG-WRAP-002` | `info` | 冗余零参委托包装器：单一函数无参数且直接穿透委托至内部成员方法，缺乏数据校验、多态重载或上下文补充。 | 若无多态抽象必要直接暴露被委托方或内联调用；若确需封装，补充守卫逻辑、状态转换或日志。 |
| `ERR-PRP-001` | `warning` | 错误码跨声明重复抛出（分类法冲突）或沿调用链向上传播过多跳数。 | 统一错误分类法，使用具名错误类型并在边界层显式捕获转换。 |

> **未内化**：外层作用域遮蔽需要引擎暴露作用域图（当前 `visit` 只提供 className/binding 线程化上下文），与「需语句序列/作用域分析」的简化类规则同属待办。

### 密钥与安全审查（`secrets` / `security`）

独立于 `hygiene` 的密钥与漏洞扫描分析器：`secrets` 负责硬编码凭据与高熵令牌，`security` 负责跨语言高危模式：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `high-entropy-token` | `warning` | 高熵字符串疑似密钥/令牌。 | 移入配置/密钥管理；确为误报时用 matchRule 抑制并写明理由。 |
| `secret-detected` | `error` | 疑似硬编码凭据（按模式识别）。 | 撤销并轮换该凭据；改为从环境/密钥管理读取。 |
| `SEC-LEAK-001` | `warning` | 日志/异常中输出敏感数据（密码、令牌、个人标识）。 | 脱敏后再记录，或只记录标识符与哈希。 |
| `SEC-VUL-001` | `error` | 任意动态代码执行（`eval` / `exec` / `Function` 构造）。 | 改为显式分支或查表；确需动态求值时使用受限解析器。 |
| `SEC-VUL-002` | `error` | 命令注入：拼接外部输入后交给 shell/子进程执行。 | 使用参数数组形式（execFile/spawn 无 shell）并对输入做白名单校验。 |
| `SEC-VUL-003` | `warning` | 原型污染：给对象原型写入来自外部的键。 | 拒绝 `__proto__`/`constructor`/`prototype` 键，或改用 Map 承载外部数据。 |
| `SEC-VUL-004` | `warning` | 不安全随机数：用 `Math.random` 生成安全敏感值。 | 改用 crypto.randomUUID/randomBytes 等密码学安全随机源。 |
| `SEC-VUL-005` | `warning` | 弱哈希：`md5`/`sha1` 用于完整性或口令场景。 | 改用 sha256 及以上；口令使用 bcrypt/argon2 等加盐慢哈希。 |
| `SEC-VUL-006` | `warning` | 路径穿越：用外部输入拼接文件路径。 | 规范化后校验是否仍位于允许的根目录内，并拒绝 `..` 片段。 |

---

## 9. 技术栈画像与自适应弹性调谐器 (`projectProfiler` & `scaleTuner`)

- **全域技术栈画像**：扫描前自动检测项目主语言、异构语言分布、构建系统 (`npm/cargo/godot/python/go/maven/cmake` 等) 与框架指纹 (`react/vue/godot-engine/django` 等)。
- **规模自适应调谐 (`--auto-tune`)**：
  根据代码量与模块规模自动划分 `micro`（微型）、`small`（小型）、`medium`（中型）、`large`（大型）、`enterprise`（超大型），动态调控圈复杂度容限、单文件行数阈值与告警升级权重，禁止固定标准机械套用。

---

## 10. 引擎级诊断 (`engine`)

这两类问题由引擎在分析器之外直接产出，不隶属于任何分析器开关，因此不会被 `--analyzers` 白名单过滤掉。

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `LANG-UNSUPPORTED` | `error`（可配置） | 文件扩展名没有任何语言适配器认领（如 Python/Shell 适配器落地前的 `.py`/`.sh`/`.ps1`）。适配器注册表会回退到 TypeScript 解析器，导致 AST 维度（复杂度、常量、架构、依赖图、评分）对该文件零信号。 | 新增该语言适配器、把该路径移出扫描范围，或显式把 `unsupportedLanguage` 降为 `warning`/`off` 以声明接受降级覆盖 |
| `analyzer-error` | `error`/`info` | 某个分析器在分析单个文件时抛异常。`failOnAnalyzerError: true` 时为 `error`（可阻断 CI），否则为 `info`（只留痕） | 修复该分析器缺陷；若属已知外部数据问题可保持 `info` |

**跳过登记（不是 issue，但必须可见）**：报告 `summary.disabledAnalyzers` 始终列出被有效配置关闭的分析器；文本输出打印 `skipped (disabled) analyzers: …`。当**扫到了某语言/格式的文件、而对应的语言包恰好关闭**时（`.py` 且 `python-modern` 关闭、`.md` 且 `docs` 关闭），另在 `summary.warnings` 追加一条 `analyzer coverage:` 提示——杜绝把「分析器没跑」读成「零违规」。

`unsupportedLanguage` 语义：`error`（默认，fail-closed）→ `warning`（照常报告但不阻断）→ `off`（恢复历史静默回退行为）。该取值参与缓存指纹，切换后不会命中旧分析结果。

---

## 11. 简化与结构坏味道审查器 (`simplify`)

默认关闭（专用分析器，需在 `analyzers.simplify` 显式启用）。语言无关实现，覆盖全部已接入语言：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `SIM-LONG-001` | `warning` | 函数物理跨度超过 `thresholds.maxFunctionLines`（默认 60）。跨度取适配器物化的起止行，覆盖 TS/JS/Python/Rust/GDScript。 | 抽取内聚步骤为具名 helper，让顶层流程只剩意图序列 |
| `SIM-COMC-001` | `warning` | 连续 ≥ `commentedCodeMinLines`（默认 3）行「代码形状」注释。关键字锚定（`def`/`function`/`return`/`if`/`import`… 或 `NAME =` 形式），散文注释不会命中。 | 直接删除（历史在 git 里）或恢复为真实代码 |
| `SIM-EMPTY-001` | `warning` | 函数体只剩 `pass`/`...`（跳过前置 docstring）或空 `{}`。 | 实现函数体、显式抛「未实现」异常，或删除声明 |
| `SIM-PRNT-001` | `warning` | 非豁免路径出现调试输出（`print`/`pprint`/`breakpoint`/`console.log`/`println!`/`dbg!` 等）。默认豁免 `**/cli/**`、`**/scripts/**`、`**/tests/**`、`**/bench/**`、`*.test.*`、`*.spec.*`，可用 `printAllowPatterns` 覆盖。 | 改用结构化 logger 或删除；调试输出绕过日志级别并泄漏到生产 stdout |
| `SIM-FLAT-002` | `warning` | 控制流深度嵌套超过阈值（默认 > 3 层），决策树过深增加心智负担。 | 采用卫语句（Guard Clauses）提前返回扁平化控制流，或将深层嵌套提炼为独立函数。 |
| `SIM-TRN-001` | `info` | 冗长且无副作用的 if-else 分支可折叠为浅层单行三元表达式。 | 双分支为同变量单一赋值或纯返回值时，在无副作用、单层深度且行长 ≤ 80 字符的前提下折叠为三元表达式。 |
| `SIM-IMM-001` | `info` | 通过三元表达式折叠消除未初始化的局部可变绑定，提纯为不可变 const。 | 将 `let x; if (c) { x = a; } else { x = b; }` 提纯为 `const x = c ? a : b;`，消除可变状态生命周期。 |

**未内化项（需语句序列 / 符号引用分析，另行评估）**：布尔返回化简、`len()` 比较化简、冗余 `else`（均需兄弟语句分析）、未使用导入（需跨文件符号引用，且 TS/JS 与 Python 已有 ESLint/ruff 原生覆盖）。

---

## 12. Python 现代化审查器 (`python-modern`) — M 族 13 条

默认关闭（专用分析器，需显式声明 `analyzers.python-modern`）；仅对 `.py` 文件生效；`M02`（返回类型注解）由 `GOV-TYP-002` 覆盖：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `PYM-PATH-001` | `warning` | `os.path.*` 用法 | 迁移到 `pathlib.Path`（`Path(...) / name`） |
| `PYM-RAISE-001` | `warning` | `except` 块内 `raise X` 缺少 `from`，异常链丢失 | `raise X from exc`，或裸 `raise` 原样上抛 |
| `PYM-DEFAULT-001` | `warning` | 可变默认参数（`=[]`/`={}`/`=set()` 等） | 改用 `None` 哨兵，在函数体内构造 |
| `PYM-ASYNC-001` | `error` | `async` 函数内阻塞调用（`time.sleep`/`requests.*`/`urllib`）或未 `await` 的同步 ORM `session.query|execute` 调用 | 改 async 等价物（asyncio/httpx/异步仓储） |
| `PYM-FSTRING-001` | `warning` | `%` 格式化字符串 | 改写为 f-string |
| `PYM-OPEN-001` | `warning` | `open()` 调用未处于 `with` 块内 | 包进 `with open(...) as handle:` |
| `PYM-IMPORT-001` | `warning` | 模块级 import 违反三段式顺序（标准库→第三方→本地）或段内未按整行字典序。函数内惰性导入不参与排序；本地根 = 文件首段目录 + `app/src/lib/tests/scripts/conftest/helpers` | 按 PEP 8 分组并段内排序 |
| `PYM-SLOTS-001` | `warning` | `@dataclass`（含 `@dataclasses.dataclass`）修饰的**无继承**类未声明 `slots=True` | 加 `slots=True`；确需 `__dict__` 时显式 `slots=False` |
| `PYM-GENERIC-001` | `error` | `List/Dict/Set/FrozenSet/Tuple/Type[...]` 旧式容器泛型 | 改用内置泛型 `list[...]` 等（PEP 585） |
| `PYM-ABC-001` | `error` | `from typing import` 引入 `collections.abc` 抽象类型（`Iterable`/`Callable`/`Mapping` 等 21 个） | 改从 `collections.abc` 导入 |
| `PYM-DATETIME-001` | `error` | `timezone.utc` 用法 | 改用 `datetime.UTC`（PEP 615） |
| `PYM-UNION-001` | `error` | 注解（带默认值）或类型别名位置使用 `Optional[...]`/`Union[...]` | 改用 PEP 604 写法 `X \| None` |

> **引擎契约提示**：纯内容型分析器必须实现 `finalize()`；引擎的 legacy `analyze()` 路径只为 TS 系适配器物化 `ts.SourceFile`，非 TS 文件会被静默跳过（`hygiene`/`governance` 同样以 `finalize` 委托进入流式路径）。

---

## 13. 文档审查器 (`docs`)

默认关闭（专用分析器，需显式声明 `analyzers.docs`）；仅对 `.md` 生效；规则族中**语言/格式无关**的三条如下：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `DOC-FEN-001` | `error` | Markdown 代码围栏未闭合（` ``` ` / `~~~`） | 补闭合围栏；未闭合会把后续章节整体吞进代码块 |
| `DOC-LNK-001` | `warning` | 反引号代码路径或相对链接指向不存在的文件。仅检查「含目录段 + 已知扩展名」的目标；glob（`a/**/b.ts`）、裸文件名、git ref、外部 URL 与含「不存在/已废止/deprecated/example」等标注的行豁免；跨仓引用可用 `linkExemptTargets` 通配符豁免 | 更新为现路径，或在行内标注废弃/历史 |
| `DOC-DUP-001` | `warning` | 同文档内正文行重复（≥24 字符，排除标题/引用/表格行），报一次并给出最高频样例 | 收敛为单一章节 + 指针，避免副本漂移 |

**配套变更**：`DEFAULT_EXT` 增加 `.md`，新增最小 `MarkdownAdapter`（空文档 AST，使文档不再触发 `LANG-UNSUPPORTED`）；`comments` 与 `governance` 按扩展名跳过 `.md`（源码契约不适用于文档散文）。

> **未内化**：依赖外部项目专有编号体系、语料索引或目录布局的文档规则（如编号锚点解析、可达性图、配额式行预算）不进入引擎——它们属于项目政策，应由消费方用声明式规则或专用脚本表达。



---

## 14. TypeScript/JavaScript 现代化审查器 (`ts-modern`) — 10 条

默认关闭（专用语言包，需显式声明 `analyzers.ts-modern`）；对 `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs` 生效，`.d.ts` 不参与；类型类规则（`TSM-ANY-001`、`TSM-TYPE-001`）只对 `.ts`/`.tsx` 生效。判定在「字符串与注释掩码」后的视图上进行，因此字符串/注释/模板里的关键字不会误报；掩码不建模正则字面量，属已登记的精度边界。

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `TSM-VAR-001` | `warning` | `var` 声明 | 改用 `const`；需要重新赋值时用 `let` |
| `TSM-REQUIRE-001` | `warning` | 已使用 ESM 语法的模块内仍调用 `require()` | 改为 `import` 绑定，保持单一模块体系 |
| `TSM-CTOR-001` | `warning` | `new Array()/Object()/String()/Number()/Boolean()` | 改用字面量或 `String()`/`Number()`/`Boolean()` 转换 |
| `TSM-ARGS-001` | `warning` | 使用 `arguments` 对象 | 改用剩余参数 `(...args)` |
| `TSM-SPREAD-001` | `warning` | `Object.assign({}, …)` 浅合并 | 改用对象展开 `{ ...source }` |
| `TSM-INCLUDES-001` | `warning` | `indexOf(...)` 与 `-1`/`0` 比较判断成员存在 | 改用 `includes(value)` |
| `TSM-SUBSTR-001` | `warning` | 使用已弃用的 `substr` | 改用 `slice(start, start + length)` |
| `TSM-REPLACE-001` | `info` | 字符串模式 `replace('literal', …)`，只替换首个匹配 | 需要全量替换时改用 `replaceAll` |
| `TSM-ANY-001` | `warning` | 类型位置出现显式 `any` | 改用 `unknown` 加收窄，或精确泛型/联合类型 |
| `TSM-TYPE-001` | `info` | 具名导入只出现在类型位置（保守判定：出现任一值位置即沉默） | 改为 `import type { … }` |

---

## 15. Rust 现代化审查器 (`rust-modern`) — 7 条

默认关闭（专用语言包，需显式声明 `analyzers.rust-modern`）；仅对 `.rs` 生效。掩码只处理斜杠注释与双引号字符串——单引号被刻意保留，以免把生命周期 `'a` 误判为字符字面量而静默吞掉整行。

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `RSM-TRY-001` | `warning` | `try!(expr)` 宏 | 改用 `?` 运算符，可嵌入更大表达式 |
| `RSM-EXTERN-001` | `warning` | `extern crate name;` | 2018 edition 起删除声明，直接按路径 `use` |
| `RSM-MACRO-001` | `warning` | `#[macro_use]` | 显式 `use` 目标宏，来源可追溯 |
| `RSM-STR-001` | `warning` | 签名使用 `&String` 参数 | 改用 `&str`（或 `impl AsRef<str>`） |
| `RSM-CLONE-001` | `info` | `.clone()` 结果只用于比较或取长度 | 改为借用比较，避免不可见复制 |
| `RSM-UNWRAP-001` | `info` | 对可失败结果调用 `.unwrap()` | 改用 `?` 传播，或用 `expect` 说明不变式 |
| `RSM-FORMAT-001` | `warning` | 格式化宏使用位置参数 `{}` | 改用内联捕获 `"{value}"`，名称由编译器校验 |

---

## 16. GDScript 现代化审查器 (`gdscript-modern`) — 7 条

默认关闭（专用语言包，需显式声明 `analyzers.gdscript-modern`）；仅对 `.gd` 生效。承载 Godot 3 → 4 迁移清单：这段迁移没有成熟的外部 linter 覆盖，是引擎独有的跨语言「现代化批次」呈现。

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `GDM-YIELD-001` | `warning` | `yield(...)` 协程写法 | 改用 `await obj.signal` |
| `GDM-EXPORT-001` | `warning` | `export` 语句（含 `export(int)` 形式） | 改用 `@export var x: int` |
| `GDM-ONREADY-001` | `warning` | `onready var` | 改用 `@onready var` |
| `GDM-TOOL-001` | `warning` | 脚本首行裸 `tool` | 改用 `@tool` 注解 |
| `GDM-POOL-001` | `warning` | `Pool*Array` 类型 | 改用 `Packed*Array` 系列 |
| `GDM-CONNECT-001` | `info` | Godot 3 `connect("signal", self, "method")` 字符串方法名 | 改用 `signal.connect(Callable)` 形式 |
| `GDM-RPC-001` | `warning` | `remote`/`master`/`puppet`/`slave` 函数修饰符 | 改用 `@rpc` 注解 |

> **三个语言包的共同契约**：均为「内容型分析器」，实现 `finalize()` 并共用 `src/core/sourceMask.ts` 的掩码能力；全部默认关闭，声明后才参与扫描，因此升级引擎不会静默改变既有门禁结果。规则 id、注册表条目、键点验证脚本（`validate-ts-modern.js` / `validate-modern-packs.js`）与本文档四处必须同步。

---

## 17. 治理分析器与代码压缩下界族 (`governance` / `CMP-*`)

治理与认知下界看守：防止代码过度压缩导致可读性与可维护性崩溃，并附带置信度与运行时验证需要标定：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `CMP-EXP-001` | `warning` | 巨型嵌套三元表达式或过长的无界布尔逻辑链（超出认知下界）。 | 将巨型嵌套三元或长逻辑链拆分为具名中间变量或 if-else 分支。 |
| `CMP-LIN-001` | `warning` | 单行塞入多个可执行语句或副作用赋值。 | 将单行内的多个语句或副作用拆分为独立代码行，遵循单行单一语义原则。 |
| `CMP-CAL-001` | `warning` | 内联回调函数嵌套层级（深度 ≥ 3）超出维护下界。 | 降低回调嵌套深度：改用 async/await、Promise 链扁平化或抽取具名顶层函数。 |
| `CMP-DEN-001` | `warning` | 认知 token 密度过高（算式/位运算密集压缩缺少命名或空白辅助）。 | 降低认知密度：添加适当空白与具名中间常量，拆分高密度算式或位运算组合。 |

**启用口径**：本族随 `governance` 分析器参与扫描；该分析器位于 `SPECIALIZED_ANALYZERS`
（`src/core/config.ts`），**默认关闭**，需在配置或 CLI 白名单中显式声明后才生效，因此升级引擎
不会静默改变既有门禁结果。

**语言范围**：当前仅声明 `typescript` / `javascript`。本族的语法锚点（`;` 语句、`? :` 三元、
`=>` 回调）在其它受支持语言中不存在，未补夹具前不得扩大声明范围。

**已知漏报（有意为之）**：`CMP-DEN-001` 要求同行存在强位运算符（`<<` `>>` `^` `~`）才判定。
仅含裸 `&`/`|` 的行不报——因为这两个符号在 TS 中是交叉/联合类型、在 Rust 中是模式提升，纳入判定
会把类型层语法误读为位运算（宁可漏报，不可误报）。

> **内容型规则的词法规范（强制）**：凡是"逐行读取源码文本"的规则，**必须**消费
> `RuleEvaluationContext.masked`——它由 `src/core/sourceMask.ts` 的 `maskedLinesOf` 按语言预设
> 每文件构建一次；**禁止**自行用行级正则剥离注释/字符串/正则字面量。行级清洗会把 JSDoc 正文、
> CLI 用法文本、正则体与 TS 联合类型当作代码：本族首版即在仓库自身 `src` 上产生 16 条命中、其中
> **15 条为误报（93.75%）**，且被 `validate-compression-bounds.js` 的伪指标（命中数 ÷ 扫描行数）
> 认证为 `0.00%`。该脚本现已断言**真误报率**（负样本命中数 ÷ 命中总数，并先断言正样本仍有命中，
> 杜绝删空规则即通过）以及 **12 个历史误报生产文件的零命中**，同类回归会直接变红。

---

## 18. 时空复杂度语义分析族 (`complexity` / `CPX-*`)

基于跨函数与跨文件调用图（CallGraph）与符号流分析复杂度和生命周期，区分有界集合与无界数据流：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `CPX-TIME-001` | `warning` | 跨函数/跨文件无界多项式时间复杂度：嵌套迭代调用链引发高开销。 | 将内层数据预先构建为 Map/Set 索引，降低复合复杂度至 O(N)。 |
| `CPX-SPACE-001` | `warning` | 热点循环内无界瞬态内存分配与重复全量物化。 | 将对象/缓冲区分配提升到循环外，循环内执行就地重置与复用。 |
| `CPX-REC-001` | `error` | 跨函数/跨文件无终止保障的递归或互递归调用链。 | 引入显式深度累加参数与终止保护，或改写为迭代工作列表。 |
| `CPX-AMP-001` | `warning` | 复杂度放大陷阱：在迭代或热点调用链中隐式嵌套阻塞 I/O 或序列化。 | 将 I/O 与序列化批量汇聚在循环外部执行。 |
| `CPX-BUD-001` | `warning` | 突破上下文弹性复杂度预算：函数圈复杂度超出结合语言、拓扑分层、领域算法特征与扁平度计算所得的弹性预算阈值。 | 结合函数承担的领域职责进行结构拆分，或将深层嵌套控制流扁平化。 |
| `CPX-JST-001` | `warning` | 无算法证明的失控深层分支嵌套：函数具备深层嵌套控制流，但缺乏状态机契约或算法证明注解。 | 扁平化深层嵌套分支，提取卫语句或使用查表法/状态模式消除嵌套分支。 |
| `CPX-HOP-001` | `warning` | 机械化拆分与调用图层级无意义膨胀：通过机械拆分产生多个单一转发包装函数，增加调用图深度与认知开销。 | 拒绝机械式碎片化拆分，以领域职责高内聚为导向进行真实结构简化。 |

---

## 19. 数据架构与数据访问现代化族 (`data-architecture` / `DAT-*`)

审查持久化、缓存、查询模式与信任边界，防止无界查询与过度防御：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `DAT-QRY-001` | `warning` | 在线请求链路中的无界数据读取或全表内存过滤。 | 增加游标分页或 Limit/Offset 条件，强制限制单次读取上限。 |
| `DAT-NPL-001` | `error` | 迭代与映射上下文中的 N+1 查询与重复存储调用。 | 将循环内查询提升至外层使用批量 IN 查询或 DataLoader 批量加载。 |
| `DAT-SER-001` | `info` | 跨层调用链中的重复序列化与反序列化转换。 | 在内部调用链路传递强类型原生对象，仅在网络边界执行序列化。 |
| `DAT-DEF-001` | `info` | 受信内部领域边界内的冗余重复防御性校验。 | 在信任边界执行一次性完整校验，内部领域对象依托不可变类型保证。 |
| `DAT-LAY-001` | `warning` | 数据访问抽象泄漏：业务核心直接操纵持久化驱动或底层存储细节。 | 将存储驱动调用封装在仓储接口实现内，领域层仅依赖仓储契约。 |

---

## 20. 测试代码现代化与业务承接族 (`test-modernity` / `TST-*`)

衡量测试代码对真实业务风险的承接能力，识别测试完整性幻觉并支持 EMTD/CBCR 指标：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `TST-ILS-001` | `warning` | 测试完整性幻觉：测试仅校验 Mock 配置或绑定已废弃业务契约。 | 将测试迁移至验证活跃业务契约与实际领域状态变化。 |
| `TST-SKP-001` | `warning` | 核心业务域中长期滞留的跳过、隔离或未执行测试用例。 | 修复并恢复测试用例，或正式登记入测试债务清单并设定收敛里程碑。 |
| `TST-TAU-001` | `warning` | 缺乏真实业务断言或包含恒真断言的无效测试。 | 替换恒真断言为针对业务实体输出和错误边界的有效验证。 |
| `TST-DEN-001` | `info` | 关键业务模块的有效现代化测试密度 (EMTD) 或当前业务承接率 (CBCR) 低于阈值。 | 补齐高风险语义单元的契约测试与边界测试，提高实际故障感知能力。 |
| `TST-DBT-001` | `info` | 未登记里程碑收敛计划或责任人的滞后测试技术债务。 | 在测试债务登记表中补全责任 Agent 及目标收敛里程碑。 |

---

## 21. 导入、依赖与资源布局族 (`dependency-layout` / `DEP-*`)

规范多语言文件布局、函数内导入合规审计与未纳管远程端点治理：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `DEP-ORD-001` | `info` | 文件布局与导入分组不符合当前语言现代化工程规范。 | 调整导入顺序为 Stdlib -> ThirdParty -> InternalShared -> Local。 |
| `DEP-LAZ-001` | `warning` | 未提供审计声明或合规理由的函数内部临时导入。 | 将导入提升至文件顶部，或添加 @lazy/@optional 注释标注意图。 |
| `DEP-RES-001` | `warning` | 业务逻辑中散落硬编码的未纳管外部 URL、文件路径或连接串。 | 将外部资源地址统一抽取至配置文件或服务资源注册中心。 |
| `DEP-WLD-001` | `warning` | 使用通配符导入破坏显式依赖跟踪与树摇优化。 | 改用显式具名导入 (Named Imports)，明确模块依赖面。 |
| `DEP-INV-001` | `error` | 依赖倒置违规：底层基础设施或公共模块反向依赖高层业务模块。 | 解除反向依赖，通过控制反转或事件总线进行解耦。 |

---

## 22. 项目架构泛化与模块边界族 (`architecture` / `ARCH-*`)

超越目录名推断真实分层，看守 Headless 无头边界并防止隐式全局可变状态耦合：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `ARCH-HDL-001` | `error` | 无头架构违规：核心业务逻辑或计算模块直接绑定 UI/IDE 视图框架。 | 解除核心计算与展示框架依赖，保持无头独立执行与测试能力。 |
| `ARCH-BND-001` | `warning` | 跨业务域内部穿透：绕过公共导出 Facade 契约直接访问非公开内部实现。 | 通过模块顶层公共导出 API 访问，禁止直接引用 /internal/ 或 /private/。 |
| `ARCH-GLB-001` | `warning` | 隐式全局可变状态：模块间通过顶层全局变量或单例产生隐式强耦合。 | 重构为依赖注入或按需创建实例，消除共享可变静态单例。 |
| `ARCH-DIR-003` | `error` | 形式分层假象：目录结构表面隔离，但调用关系与数据流发生逆向越层。 | 调整调用依赖流向，由内层领域定义契约接口并交由基础设施层实现。 |
| `ARCH-CFG-001` | `info` | 环境配置泄漏：纯领域业务模型内部直接读取环境变量或底层磁盘配置。 | 将环境配置提升到应用装配层解析，并以强类型参数注入领域对象。 |
| `ARCH-CFG-002` | `warning` | 废弃或未引用的死配置声明：配置文件中声明了配置键，但项目中没有任何代码读取或参与决策。 | 清理未决或已失效的无用配置项，保持配置契约精炼单一。 |
| `ARCH-CFG-003` | `warning` | 多源重复或冲突配置声明：相同配置键在多个独立配置文件中被无序重复声明。 | 建立统一权威配置中心，消除多重声明冲突并使用显式继承/覆盖机制。 |
| `ARCH-CFG-004` | `warning` | 业务领域内核中散落隐式环境读取：核心业务逻辑直接调用 process.env/os.environ。 | 通过应用层统一解析环境变量，并以强类型配置模型或构造函数注入业务核心。 |
| `ARCH-CFG-005` | `warning` | 配置读取散落与缺乏集中治理：多处代码直接散落解析物理配置文件，缺乏注册中心或统一入口。 | 通过统一配置加载服务或注册中心读取配置，杜绝业务层散落物理文件解析。 |
| `ARCH-CFG-006` | `warning` | 配置与业务逻辑强耦合：核心领域逻辑直接执行物理磁盘 I/O 读取配置文件。 | 将配置 I/O 与解析解耦至基础设施装配层，核心领域仅依赖纯粹配置数据对象。 |
| `ARCH-CFG-007` | `info` | 微型项目中配置过度抽象：小型轻量级项目中存在过多分散的小型配置文件，造成不必要的维护间接层。 | 权衡项目体量，针对小型项目合并配置至单一统一配置文件，避免过度设计。 |
| `ARCH-BLR-001` | `warning` | 跨职责内聚失衡与职责边界模糊：单文件内并存多个复杂函数，但其引用的符号集合 Jaccard 相似度极低，职责正交分散。 | 依职责边界拆分异构函数至独立专职模块，提升单一职责内聚度。 |
| `ARCH-SKL-001` | `info` | 执行骨架一致但策略分化的候选模板方法：多函数具备对称的 Prologue/Epilogue 阶段骨架，仅在中间执行核心不同。 | 提取为模板方法模式或高阶函数骨架，并将中间差异策略抽象为策略对象。 |
| `ARCH-ROL-001` | `warning` | 文件本体角色失衡与伪共享库：文件承担过多易变状态或高耦合业务逻辑，却被跨域频繁引用作为共享库。 | 剥离核心领域状态，明确稳定输入输出边界，构建真正低耦合的共享库。 |
| `ARCH-ROL-002` | `warning` | 业务模块承载无界公共能力：领域业务模块内部私自承载与导出通用基础设施或公共计算能力。 | 将通用能力下沉至对应共享层或基础设施层，确保领域模块职责专注单一。 |
| `ARCH-UTL-001` | `warning` | 万能工具库反模式：检测到承担混杂异构逻辑的 utils/common 垃圾桶文件。 | 按四分流治理原则重构：纯算子进入算法库、常量进入常量库、规则进入策略库、通用转换进入基础层。 |
| `ARCH-ABS-001` | `warning` | 过度抽象与非必要间接层：为少量共性引入跨层深层转发跳板、跨域依赖反转或循环依赖。 | 消除负收益间接跳板与人为抽象，容许领域隔离的局部正当实现。 |
| `ARCH-DEC-002` | `warning` | 分析器或领域模型直接耦合具体 AST 解析器库（如 `oxc-parser`、`@babel/parser`、`tree-sitter`、`ts-morph/dist`）。 | 将底层 AST 解析抽取至独立适配器，面向统一的 NormalizedNode 抽象接口交互。 |
| `ARCH-TMP-001` | `warning` | 巨石视图/模板渲染器未解耦：单函数规模超标且包含深度 HTML/SVG/DSL 模板字符串拼接，缺少局部组件化。 | 拆解为领域正交的局部组件（Header/Card/Graph Partials），由结构化 ViewModel 驱动渲染。 |

---

## 23. 性能基准与循环高开销治理族 (`performance` / `PRF-*`)

针对循环热路径、深拷贝与瞬态堆内存分配等关键性能反模式进行静态拦截：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `expensive-loop-operation` | `error` | 循环体内执行昂贵深拷贝（`.duplicate(true)`）或阻塞式序列化与IO。 | 消除热路径内的深拷贝操作，改用只读视图或轻量引用。 |
| `high-algorithmic-complexity` | `warning` | 循环多重嵌套引发潜在 $O(N^2)$ / $O(N^3)$ 复杂度热点或循环体内隐式线性查找。 | 重构循环嵌套或预先构建 Map/Set 索引将查找降为 $O(1)$。 |
| `loop-transient-allocation` | `warning` | 循环体内瞬态堆分配（ADV-PRF-002），违背零瞬态分配契约。 | 将对象实例化提升到循环外或使用对象池模式（ADV-POOL-001）。 |
| `PRF-POL-001` | `warning` | 热路径高频昂贵资源缺乏复用池化：循环内或高频调用中频繁分配重型对象、缓冲区或连接。 | 引入对应对象池/缓冲池机制并在生命周期结束时回收复用。 |
| `PRF-POL-002` | `error` | 资源池缺乏状态重置契约或容量上限：池化机制缺失 reset_state 回收契约或无界增长导致数据污染与泄漏。 | 补全对象归还重置逻辑并设定池容量高水位淘汰限制。 |
| `PRF-POL-003` | `warning` | 负收益过度池化：对极小轻量纯值对象或冷路径过度引入池化管理开销，得不偿失。 | 移除负收益池化包装层，直接采用值对象或短生命周期瞬态分配。 |

---

## 24. 命名规范与现代变量作用域族 (`naming` / `NAM-*`)

面向现代化工程规范的全局分层命名与作用域守卫体系，涵盖物理组织（文件与目录）、模块全局（常量与顶层状态）、类型与成员、局部业务变量（模糊词黑名单与单字母作用域拦截）以及集合意图表达：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `NAM-FIL-001` | `warning` | 文件命名不符合语言规范（TS/JS 强制 kebab-case，Python/Rust/GDScript 强制 snake_case）或包含临时批次黑话词。 | 将文件名规范重命名为对应语言的标准格式（如 `foo-bar.ts` 或 `foo_bar.py`），且不可带有临时标记。 |
| `NAM-DIR-001` | `warning` | 源码目录名包含大写驼峰（CamelCase）、空格或临时批次工单词。 | 将目录重命名为全小写短横线风格（如 `ast-utils`、`pipeline`）。 |
| `NAM-GLB-001` | `warning` | 模块顶层声明的不可变原始值或数组未遵循 UPPER_SNAKE_CASE 规范。 | 将模块级原始常量重命名为大写蛇形命名（如 `MAX_RETRIES`、`DEFAULT_TIMEOUT`）。 |
| `NAM-GLB-002` | `warning` | 在模块顶层声明可变的 `let` 或 `var` 变量（隐式全局共享状态、破坏并发安全）。 | 重构顶层可变状态为函数作用域变量、类实例属性或显式单例状态持有者。 |
| `NAM-TYP-001` | `warning` | 类（class）、接口（interface）、类型别名（type）或枚举（enum）未遵循 PascalCase 大驼峰命名。 | 将类、接口、类型别名或枚举重命名为大驼峰格式（如 `Scanner`、`RuleDefinition`）。 |
| `NAM-MBR-001` | `warning` | 类属性、对象字段或方法名未遵循 camelCase 小驼峰命名规范。 | 将属性和方法名调整为清晰有意义的小驼峰命名。 |
| `NAM-VAG-001` | `warning` | 变量名使用了无业务语义的模糊泛化裸词（如 `data`、`res`、`ret`、`tmp`、`item` 等）。 | 结合业务领域语义补齐前缀或后缀（如 `parseResult`、`tokenPayload`、`ruleEntry`）。 |
| `NAM-SGL-001` | `warning` | 在业务逻辑中使用无语义的单字母变量名（仅循环头计数器 `i`/`j`/`k` 与 discard 占位符 `_` 豁免）。 | 改用能表达具体意图的具名标识符；仅 `for (let i = ...)`、`_` 允许单字母。 |
| `NAM-COL-001` | `info` | 数组集合未使用复数名词，或字典映射未表达键值关联关系（如缺少 `*To*` 或 `*By*`）。 | 为数组集合增加复数形态，为字典映射添加 `*To*` 或 `*By*` 表达关联意图。 |
| `NAM-JRG-002` | `warning` | 标识符、函数名、类名或测试套件名称中包含临时性施工批次黑话词（`p[0-9]+`、`phase[0-9]+`、`st[0-9]+`、`temp`、`new`、`v[0-9]+`、`wip`）。 | 消除临时性工程批次词汇，使用具备长效业务语义的领域词汇或标准功能命名。 |

---

## 25. 弹性复杂度与分布式冗余治理族 (`complexity` / `CPX-*`)

针对单函数弹性上下文预算、设计失控嵌套、机械切分投机与跨文件分布式冗余复杂度进行静态识别：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `CPX-BUD-001` | `warning` | 超出弹性复杂度预算：综合语言基线、角色权重、领域特征与结构清晰度测算的动态预算超标。 | 按职责拆解函数，或将多重嵌套扁平化为策略表/状态机。 |
| `CPX-JST-001` | `warning` | 非必要设计失控复杂度：深层控制流嵌套与复杂度堆叠缺乏算法或状态机契约证明。 | 梳理核心职责，采用卫语句早返回，解离混合流程并分离副作用。 |
| `CPX-HOP-001` | `warning` | 机械式拆分投机：通过制造大量单行薄转发包装函数人为压低复杂度，导致认知跳板成本上升。 | 消除无意义的透传转发包装，聚焦于语义重用与领域内聚。 |
| `CPX-RED-001` | `warning` | 分布式冗余复杂度超标：跨多个文件存在高度相似的算法流程、计算或校验逻辑，累积形成隐性系统复杂度。 | 评估逻辑共性并依据领域边界进行抽离，或消除局部开发复制。 |

---

## 26. 常量语义治理与位置追踪族 (`constants` / `CONST-*`)

面向现代化工程规范的常量全生命周期语义治理与跨版本位置追踪体系，区分“纯搬迁”与“真实语义改善”，防范 Anti-Gaming 伪改造并把控代码拓扑与所有权层级：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `CONST-LAY-001` | `warning` | 模块级常量位置错乱：常量声明出现在函数、类或逻辑实现之后，破坏标准文件布局次序。 | 将模块级稳定常量移至依赖引入区之后、业务逻辑声明之前。 |
| `CONST-SCP-001` | `warning` | 常量作用域过度扩大：非导出常量仅在单处局部函数或狭窄代码块内消费，却盲目定义为模块顶层全局。 | 收敛作用域，将常量下沉至消费它的局部函数或代码块头部声明。 |
| `CONST-SCP-002` | `warning` | 局部作用域内散落硬编码：函数内重复出现相同语义的硬编码字面量，未提取为局部常量。 | 在局部函数或作用域顶部定义常量统一引用，消除散落硬编码。 |
| `CONST-CLU-001` | `warning` | 临近调用域同源字面量未成组提取：同一调用域或临近窗口内存在同族未提取硬编码（遗留孤儿硬编码）。 | 结合调用语义与领域知识，对同源同族字面量执行成组批量提取与标准化命名。 |
| `CONST-DRF-001` | `warning` | 跨文件同名异值或同值异名语义漂移：跨模块存在同名常量取值不同，破坏 Single Source of Truth。 | 统一定义至公共领域配置或类型模块，消除跨文件语义漂移与硬编码碎片化。 |
| `CONST-OWN-001` | `warning` | 常量架构所有权归属不合规：常量放置在错误的架构层级或全局大杂烩文件中。 | 按四层所有权（模块私有/领域共享/协议共享/系统配置）将常量迁移至对应归属模块。 |

---

## 27. 标准库与系统级运行时特种规则族 (`stdlib` / `STDLIB-*`)

专为标准库、裸机内核、系统运行时与密码学基础设施定制的高级别硬核质量与安全防卫：

| 规则 ID | 级别 | 触发条件 | 治理策略 |
| :--- | :--- | :--- | :--- |
| `STDLIB-PANIC-001` | `warning` | 系统标准库公开接口严禁逃逸裸 panic/unwrap/abort，强制 Result/Option 或有界 error 返回。 | 对可能失败的公开 API 采用 Result<T, E> 或显式 error code 表达错误，内部调用使用 match 或 ? 操作符解包。 |
| `STDLIB-ALLOC-001` | `error` | 裸机与 no_std 系统运行环境下隐式堆逃逸与动态重分配静态拦截。 | 在 no_std / core 作用域下使用固定容量栈缓冲、借用切片或预分配内存池，避免裸调 Box::new / malloc。 |
| `STDLIB-UNSAFE-001` | `error` | Rust/C++ 底层 unsafe 块强制附带 // SAFETY: 契约证明，缺失即阻断。 | 在每个 unsafe 块或函数前编写 // SAFETY: 注释，明确记录调用者必须保证的前置条件与内存安全不变量。 |
| `STDLIB-CONST-001` | `warning` | 标准库密码学与哈希敏感比较严禁分支时间泄漏，强制常量时间恒定延迟比对。 | 使用恒定时间累加比对（如 constant_time_eq / subtle::ConstantTimeEq），严禁在字节不匹配时提前 return false。 |
| `STDLIB-RECURSION-001` | `warning` | 底层核心算法无界深层递归缺乏显式栈深检查或上限防卫。 | 为递归算法引入显式 depth 计数限制，或改用显式工作栈与迭代平铺展开循环。 |
| `STDLIB-PORT-001` | `warning` | 底层平台条件编译 #[cfg(...)] 缺少未知平台或未支持目标架构时的 fallback 阻断。 | 在特定操作系统/目标平台条件编译块末尾添加 compile_error! 或通用软实现作为兜底后备。 |




