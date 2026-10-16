---
name: complexity-budget
description: >-
  代码复杂度与体积双轨预算控制工作流。指导 Agent 在编写与审查代码时，看守 AST 局部切片守卫（CC<=15, Depth<=4, Noise<=4.0）、
  单文件双轨体积（ELOC<=900, LOC<=1400）与 1:3 动态反推包络，落实六字段 JSDoc 契约、ECR 注释密度与循环零堆分配。
---

# complexity-budget — 代码复杂度与体积双轨预算控制工作流

本技能定义了工作区代码复杂度局部切片预算、控制流降维平铺模式、有效代码行（ELOC）与物理行（LOC）双轨体积约束、模块头部六字段 JSDoc 契约、ECR 有效注释密度模型、算法边界声明与高频循环零瞬态堆分配的标准工程规范。

---

## 一、 适用场景与触发条件

在以下任一开发或治理场景中，必须激活本技能实施复杂度预算审查：
1. **编写新功能或重构模块**：新增或修改任何语言（`.ts`, `.js`, `.gd`, `.py`, `.sh`, `.ps1` 等）的源码文件；
2. **函数逻辑分支扩张**：单函数出现多层嵌套判断（`if` / `switch` / `try`）、深层循环体或复杂事件解析管道；
3. **文件体积逼近预警线**：源码文件有效行逼近 600 行或物理行数逼近 1100 行，需要进行架构评估与体积收敛；
4. **复杂核心算法研发**：编写包含贪心搜索、回溯剪枝、大规模 AST 遍历或差异对比（如 Myers Diff）的核心算子；
5. **高频循环与渲染热路径**：涉及图表绘制、轨迹解析、状态机帧轮询、日志批量处理等高吞吐路径；
6. **提交前门禁自检**：在执行 `pre-commit` 门禁前，确保所有暂存区文件 100% 满足 AST 局部切片、双轨体积守卫与有效注释契约。

---

## 二、 AST 局部切片刚性预算与弹性包络 (`GATE-AST-001`)

工作区暂存区生产代码与工程脚本均受 AST 局部切片守卫管束，以单个函数/方法为最小审计切片，实行指标一票否决：

| 指标维度 | 刚性基准阈值 | 弹性包络与容差策略 | 语义与反模式危害 | 治理与重构重锤手段 |
| :--- | :---: | :--- | :--- | :--- |
| **单函数圈复杂度 (CC)** | $\text{CC} \le 15$ | • **平铺分发器/状态机容差**：无循环且 $\text{Depth} \le 2$ 的扁平 `if/switch` 事件分发器与状态映射器弹性放宽至 $\text{CC} \le 25$<br/>• **函数爆炸半径感知 (Blast Radius)**：未导出的文件私有局部纯函数（无循环且 $\text{Depth} \le 3$）享低爆炸半径弹性包络 $\text{CC} \le 18 \sim 20$；公共导出 API 严格锁定 $\text{CC} \le 15$<br/>• **探针与测试套件**：`*archetype*` 与 `*.test.ts` 弹性预算 $\text{CC} \le 20$ | 条件分支与判定路径过多，测试覆盖组合爆炸，极易遗漏边界缺陷 | 抽取纯函数子解析器；改用配置驱动或查表策略映射（Strategy Map） |
| **控制流嵌套深度 (Depth)** | $\text{Depth} \le 4$ | 生产代码推荐 $\text{Depth} \le 2 \sim 3$，全仓任何场景严禁出现 $\text{Depth} > 4$ 的深层缩进嵌套（`CPX-NEST-001`） | 多重缩进引发箭头型代码（Arrow Code），上下文记忆负荷急剧攀升 | 采用卫语句提前返回（Early Return）；循环内早跳（`continue`/`break`）；提取嵌套内层逻辑为独立纯函数 |
| **单行代码噪声比 (Noise)** | $\text{Noise} \le 4.0$ | 非注释/非空白有效行中，非标识符字符数与标识符字符数比值严控 $\le 4.0$ | 符号堆叠、多层嵌套三元表达式或极端链式调用导致可读性崩塌 | 拆解为中间具有自解释语义的常量变量；消除行内内联回调与复杂正则压缩 |

---

## 三、 控制流平铺与认知降维实战模式 (`CPX-NEST-001`)

解耦深层嵌套与高圈复杂度函数必须遵循以下三种标准降维范式（具体代码实现详见 [control-flow-flattening-patterns.md](references/control-flow-flattening-patterns.md) 与模板 [flat-control-flow-patterns.ts](templates/flat-control-flow-patterns.ts)）：

| 降维范式 | 核心机制与典型场景 | 复杂度收益 | 对应参考指针 |
| :--- | :--- | :---: | :--- |
| **卫语句提前返回 (Guard Clauses)** | 将先验校验、参数防御与异常分支置于顶部提前退出；循环体内使用 `continue`/`break` 早跳 | $\text{Depth}: 4 \to 1$<br/>$\text{CC}: -30\%$ | [control-flow-flattening-patterns.md#一-卫语句提前返回-guard-clauses](references/control-flow-flattening-patterns.md#一-卫语句提前返回-guard-clauses) |
| **独立纯函数解耦 (Pure Parsing Extraction)** | 严禁在主循环中内联 `try-catch` 和多重容错判断；抽取单项解析纯函数，主循环扁平消费 | 消除循环内嵌套<br/>测试单点隔离 | [control-flow-flattening-patterns.md#二-复杂数据管道与日志解析解耦](references/control-flow-flattening-patterns.md#二-复杂数据管道与日志解析解耦) |
| **策略映射分发 (Strategy Map Dispatch)** | 使用顶层冻结字典或 `Map` 替代庞大的 `switch-case` 或 `if-else` 分发阶梯 | $\text{CC}: \mathcal{O}(N) \to \mathcal{O}(1)$<br/>消融长分支 | [control-flow-flattening-patterns.md#三-策略映射表替代级联分支-strategy-map-dispatch](references/control-flow-flattening-patterns.md#三-策略映射表替代级联分支-strategy-map-dispatch) |

---

## 四、 单文件双轨体积与 1:3 动态包络模型

工作区源码以**有效代码行（ELOC）**为核心复杂度标尺，以**物理行（LOC）**为编辑器阅读与排版防膨胀兜底线：

### 1. 刚性红线绝对预算
- **有效代码行硬顶**：$\text{ELOC} \le 900$（剔除单行/多行注释与物理空行后的纯语义代码行，超标一票否决）；
- **物理总行数硬顶**：$\text{LOC} \le 1400$（防止超大单体文件破坏编辑器渲染性能与上下文承载）。

### 2. 1:3 密度比双向动态反推包络 (`scripts/common/evaluate-eloc-budget.js`)
固定上限无法防范低逻辑文件恶意注水或高逻辑文件过度剥离注释，故实行动态双向制约（速查表见 [dynamic-envelope-cheatsheet.md](references/dynamic-envelope-cheatsheet.md)）：
1. **正向动态物理上限**：$\text{LOC}_{dynamic\_max} = \min(1400, \max(150, \lceil \text{ELOC} \times 3.0 \rceil))$，低业务行模块物理行严格等比钳制；
2. **反向动态逻辑下限**：当 $\text{LOC} \ge 250$ 时，强制要求 $\text{ELOC} \ge \lfloor \text{LOC} / 3.0 \rfloor$（纯代码语义密度 $\ge 33.3\%$），杜绝冗余排版；
3. **高负荷契约注释密度约束**：当 $\text{ELOC} \ge 600$ 时，要求注释占比 $\ge 8\%$（$\text{Comments} / \text{LOC} \ge 0.08$），严禁为避让物理行而删减算法原理与 JSDoc。

### 3. 高内聚模块的重构治理原则
- **坚决杜绝机械物理碎片化**：处于合法双轨包络内（$\text{ELOC} \le 900, \text{LOC} \le 1400$）且高内聚的模块，严禁单纯为了压低数字而机械切碎为多个 50 行孤立文件，破坏领域封装；
- **重构治理重心转向**：模块治理第一优先级永远是**根除循环内瞬态堆分配（`CPX-SPACE-001`）**与平铺控制流，而非浅层代码行搬移。

---

## 五、 模块头部六字段 JSDoc 契约规范

所有核心模块文件（尤其是 `src/**`、引擎算子、门面入口与领域服务）顶部必须包含标准化六字段 JSDoc 注释契约：
1. **`Module`**：子系统名称与功能标题（格式：`<Subsystem> — <Functional Title>`）；
2. **`File Path`**：项目内标准相对路径（例如 `src/daemon/index.ts`）；
3. **`Architecture Role`**：架构定位与系统边界（阐明职责，如“常驻守护进程聚合门面”、“纯数学计算内核”）；
4. **`Dependencies & Triggers`**：上下游依赖与激活触发源（消费哪些模块、被哪些上层服务/门禁调用）；
5. **`Responsibilities`**：核心职责清单（必须以数字标号列出 2~4 条具体的实质性技术职责）；
6. **`Design Rationale`**（或 `Exit Semantics & Design Rationale`）：设计权衡依据、降级策略或并发不变式。

---

## 六、 ECR 有效注释密度模型与契约质量规范

静态分析引擎采用语义九分类加权体系计量有效注释密度（`comment-density-model.ts`），严禁注水式注释与代码复述：

| 分类标识 (Category) | 语义权重 ($w_i$) | 判定特征与内容标准 |
| :--- | :---: | :--- |
| **`DESIGN_RATIONALE` / `ARCHITECTURE_INTENT` / `ALGORITHMIC_PROOF`** | **+1.0** | 阐述设计权衡（why / trade-off）、架构定位边界、算法复杂度与收敛性证明 |
| **`LIFECYCLE_OWNERSHIP` / `INVARIANT_BOUNDARY`** | **+0.9** | 资源释放、线程安全、并发重入（idempotent / dispose）、前置/后置不变式边界 |
| **`API_CONTRACT`** | **+0.8** | 结构化 JSDoc 标签契约（`@param` / `@returns` / `@throws` / `@example`） |
| **`TRIVIAL_TRANSLATION` / `BEHAVIOR_ECHO`** | **0.0 / -0.2** | 机械重复下一行标识符（如 `// get user`）或复述语句（如 `// return true`） |
| **`WATER_LOGGING`** | **-0.5** | 空占位符、无实质内容的注水标记（`// TODO` / `// temp` / `// placeholder`） |

- **有效注释率公式**：$\text{ECR} = \max(0, \sum w_i) / \text{totalCommentLines}$；
- **注水熔断红线**：注释总行数 $\ge 5$ 时，若 $\text{ECR} < 0.40$ 或包含 $\ge 2$ 处 `WATER_LOGGING`，判定为 `GOV-GAM-001` 违规；
- **消除假分支幽灵注释与敏捷代号**：严禁伪造无执行逻辑的分支堆砌注释；正文与注释严禁出现敏捷冲刺代号（如 `W1~W9`、`Pass 1..6`、`Sprint 3`）。

---

## 七、 复杂核心算法边界声明与降级不变式契约

高复杂度或长耗时核心算子（如 Myers Diff、语法分析器、大规模 AST 遍历、状态机求解器）必须在 JSDoc 契约与实现中显式声明前置不变式与降级边界：
- **降级边界策略契约**：明确算子最差时间/空间复杂度包络及降级触发条件。例如 Myers 差异对比内核（`myers-algorithm.ts`）在剔除公共前后缀后中间跨度 $\max(midN + midM) > 1500$ 行或矩阵 $> 2,000,000$ 单元格时，自动回退至 `histogramDiff` 线性算法，规避 OOM；
- **前置哈希等长不变式契约**：使用预计算行哈希缓冲区时，必须断言 `hashA.length === a.length` 且 `hashB.length === b.length`，严防缓冲区内存错位。

---

## 八、 循环体内零瞬态堆分配刚性约束 (`CPX-SPACE-001` / `ADV-PRF-002`)

在日志流解析、轨迹追踪、图表渲染、帧调度或 AST 遍历等高频执行路径中，循环内堆内存分配会引发频繁 GC 抖动，必须严格遵守八项零分配准则：
1. **零临时对象分配与原位注入**：循环内严禁声明局部匿名闭包、箭头函数或临时字面量 `{}`，状态变量循环外复用；
2. **连续缓冲区预分配**：数值计算使用 `Float64Array` / `Int32Array` 单例缓冲区，杜绝循环内反复 `new` 或 `.slice()`；
3. **行缓冲收集 Join**：字符串拼接使用数组在循环内 `push()`，循环外统一 `.join('\n')`，严禁连续 `+=`；
4. **迭代器直接解构**：遍历 `Map` / `Set` 使用 `for (const [k, v] of map)`，严禁 `[...map.entries()]` 瞬态拷贝；
5. **对象池与 `reset_state()`**：复杂生命周期对象必须池化管理，借出使用完毕必须调用 `reset_state()` 归还；
6. **队列单指针游标推进**：广度遍历使用单指针游标 `head++`，严禁调用数组 `shift()` 引发 $O(V^2)$ 内存重排；
7. **AST 遍历行缓存复用**：针对大文件分析在文件入口一次性缓存 `cachedLines`，切片直接引用，杜绝重复 `split('\n')`；
8. **正则顶层不可变常量化 (`PRF-MEM-001`)**：严禁在循环内 `new RegExp(...)`，统一提升至模块顶层 `const RE_XXX`。

---

## 九、 防刷分、反注水与虚假收益熔断守卫 (`BLOCK_GAMING_DETECTED` / `GOV-GAM-001`)

在重构与优化作业中，严禁制造无实质质量改善的表面指标刷分：
- **禁止手段**：单纯重命名局部变量、微调注释空白、重排 `import`、移动物理文件位置或生成空壳跳板；
- **熔断判定**：重构改动中若语义有效代码变化量 $\text{ELOC}_{semantic} \le 15\%$ 且未消除任何真实技术债违规项，门禁系统将直接触发 `BLOCK_GAMING_DETECTED` 熔断阻断。

---

## 十、 本地预审指令与断言标准

在提交代码前，必须执行以下离线验证以确保复杂度预算与注释密度完全合规：

```powershell
# 1. 验证全仓源码双轨体积与 1:3 动态包络合规性
node scripts/common/evaluate-eloc-budget.js

# 2. 验证注释语义加权与有效注释密度模型 (ECR)
node auto-refactor/scripts/validate-comment-governance.js

# 3. 验证暂存区 AST 局部切片守卫与物理行数（Gate 5 与 Gate 9）
pwsh -File scripts/ps1/pre-commit-gate.ps1
```

**质性断言标准**：
- 控制台输出全绿通过，没有任何函数超出 CC $\le 15$（或弹性包络 $\le 25$）、Depth $\le 4$、Noise $\le 4.0$ 红线；
- 暂存区所有改动文件均严格位于 1:3 双向动态包络安全带内；
- 头部六字段 JSDoc 契约完整，无注水式注释与敏捷过程代号；
- 复杂核心算法显式声明降级边界与前置等长不变式；
- 循环体与热路径零瞬态堆分配，无 `CPX-SPACE-001` 违规；
- 全工作区 High/Critical 技术债务历史性归零（0 项），重构改动严禁引入任何技术债务反弹（一票否决）。
