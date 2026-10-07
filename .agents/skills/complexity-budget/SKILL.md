---
name: complexity-budget
description: >-
  代码复杂度与体积双轨预算控制工作流。指导 Agent 在编写、重构或审查代码时，
  严格看守 AST 局部切片守卫（CC<=15, Depth<=4, Noise<=4.0）、单文件双轨体积（ELOC<=900, LOC<=1400）、
  1:3 动态反推包络、模块头部六字段 JSDoc 契约、ECR 有效注释密度模型、核心算法降级与前置哈希不变式，
  平铺控制流并拦截虚假重构刷分与敏捷过程代号。
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
| **单函数圈复杂度 (CC)** | $\text{CC} \le 15$ | • **平铺分发器/状态机容差**：无循环且 $\text{Depth} \le 2$ 的扁平 `if/switch` 事件分发器与状态映射器弹性放宽至 $\text{CC} \le 25$<br/>• **探针与测试套件**：`*archetype*` 与 `*.test.ts` 弹性预算 $\text{CC} \le 20$ | 条件分支与判定路径过多，测试覆盖组合爆炸，极易遗漏边界缺陷 | 抽取纯函数子解析器；改用配置驱动或查表策略映射（Strategy Map） |
| **控制流嵌套深度 (Depth)** | $\text{Depth} \le 4$ | 生产代码推荐 $\text{Depth} \le 2 \sim 3$，全仓任何场景严禁出现 $\text{Depth} > 4$ 的深层缩进嵌套（`CPX-NEST-001`） | 多重缩进引发箭头型代码（Arrow Code），上下文记忆负荷急剧攀升 | 采用卫语句提前返回（Early Return）；循环内早跳（`continue`/`break`）；提取嵌套内层逻辑为独立纯函数 |
| **单行代码噪声比 (Noise)** | $\text{Noise} \le 4.0$ | 非注释/非空白有效行中，非标识符字符数与标识符字符数比值严控 $\le 4.0$ | 符号堆叠、多层嵌套三元表达式或极端链式调用导致可读性崩塌 | 拆解为中间具有自解释语义的常量变量；消除行内内联回调与复杂正则压缩 |

---

## 三、 控制流平铺与认知降维实战模式 (`CPX-NEST-001`)

实战经验表明，函数圈复杂度超标与嵌套过深通常源于**参数校验与主流程混杂**以及**循环体内多层防御性判断堆叠**。解耦此类结构必须遵循以下降维范式：

### 1. 卫语句提前返回 (Guard Clauses)
将先验断言、参数校验与异常分支置于函数顶部提前退出，确保主干逻辑保持在 0~1 级缩进：

```typescript
// ❌ 错误示范：深层嵌套箭头反模式 (Depth = 4, CC = 6)
function processEvent(event: Event): void {
  if (event.isValid) {
    if (event.payload) {
      if (event.payload.type === 'DATA') {
        for (const item of event.payload.items) {
          if (item.active) {
            handleItem(item);
          }
        }
      }
    }
  }
}

// ✅ 正确示范：卫语句提前返回 + 循环内早跳 (Depth = 2, CC = 4)
function processEvent(event: Event): void {
  if (!event.isValid || !event.payload || event.payload.type !== 'DATA') {
    return;
  }
  for (const item of event.payload.items) {
    if (!item.active) {
      continue;
    }
    handleItem(item);
  }
}
```

### 2. 复杂数据管道与日志解析解耦
在处理包含 JSON 序列化、多格式容错与异常捕获的流式数据解析时，**严禁在主循环中内联 `try-catch` 和多重字段判断**。应将解析抽象为独立的无副作用纯函数：

```typescript
// ✅ 核心实战范式：抽取独立解析函数，主循环扁平消费
interface TrajectoryStep {
  readonly stepIndex: number;
  readonly type: string;
  readonly content: string;
}

// 独立解析函数：聚焦单行解析，全量应用卫语句，Depth <= 2
function parseTrajectoryStep(rawLine: string): TrajectoryStep | null {
  const trimmed = rawLine.trim();
  if (!trimmed || !trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.step_index !== 'number' || typeof parsed.type !== 'string') {
      return null;
    }
    return {
      stepIndex: parsed.step_index,
      type: parsed.type,
      content: typeof parsed.content === 'string' ? parsed.content : '',
    };
  } catch {
    return null;
  }
}

// 主流转循环：零深度嵌套，线性平铺
export function consumeTrajectoryStream(lines: readonly string[]): TrajectoryStep[] {
  const steps: TrajectoryStep[] = [];
  for (const line of lines) {
    const step = parseTrajectoryStep(line);
    if (!step) {
      continue;
    }
    steps.push(step);
  }
  return steps;
}
```

### 3. 策略映射表替代级联分支 (Strategy Map Dispatch)
当分支为类型分发或命令调度时，使用冻结字典或 `Map` 替代庞大的 `switch-case` 或 `if-else` 阶梯，将圈复杂度从 $\mathcal{O}(N)$ 降至 $\mathcal{O}(1)$。

---

## 四、 单文件双轨体积与 1:3 动态包络模型

工作区源码以**有效代码行（ELOC）**为核心复杂度标尺，以**物理行（LOC）**为编辑器阅读与排版防膨胀兜底线：

### 1. 刚性红线绝对预算
- **有效代码行硬顶**：$\text{ELOC} \le 900$（剔除单行/多行注释与物理空行后的纯语义代码行，超标一票否决）；
- **物理总行数硬顶**：$\text{LOC} \le 1400$（防止超大单体文件破坏编辑器渲染性能与上下文承载）。

### 2. 1:3 密度比双向动态反推包络 (`scripts/common/evaluate-eloc-budget.js`)
固定上限无法防范低逻辑文件恶意注水或高逻辑文件过度剥离注释，故实行动态双向制约：

1. **正向动态物理上限**：
   $$\text{LOC}_{dynamic\_max} = \min(1400, \max(150, \lceil \text{ELOC} \times 3.0 \rceil))$$
   低业务行数模块的物理行数被严格等比钳制，杜绝通过无意义格式空行与废话注水。
2. **反向动态逻辑下限**：
   当 $\text{LOC} \ge 250$ 时，强制要求 $\text{ELOC} \ge \lfloor \text{LOC} / 3.0 \rfloor$（即纯代码语义密度 $\ge 33.3\%$）。大体量文件必须承载相称的业务逻辑，杜绝冗余排版。
3. **高负荷契约注释密度约束**：
   当 $\text{ELOC} \ge 600$ 时，要求注释占比 $\ge 8\%$（$\text{Comments} / \text{LOC} \ge 0.08$）。严禁为了规避物理行数上限而删减状态机契约、算法原理或 JSDoc 关键文档。

### 3. 高内聚模块的重构治理原则
- **坚决杜绝机械物理碎片化**：处于合法双轨包络内（$\text{ELOC} \le 900, \text{LOC} \le 1400$）且高内聚的模块（如 700~800 行的领域聚合器或复杂视图逻辑），严禁单纯为了压低数字而机械切碎为多个 50 行的孤立文件，严防破坏领域封装与调用局部性；
- **重构治理重心转向**：模块治理的第一优先级永远是**根除循环内瞬态堆分配（`CPX-SPACE-001`）**、平铺控制流嵌套与降低算法复杂度，而非浅层代码行搬移。

---

## 五、 模块头部六字段 JSDoc 契约规范

所有核心模块文件（尤其是 `src/**`、引擎算子、门面入口与领域服务）顶部必须包含标准化六字段 JSDoc 注释契约，建立显式的架构身份证明：

### 1. 六字段契约定义
1. **`Module`**：子系统名称与功能标题（格式：`<Subsystem> — <Functional Title>`）；
2. **`File Path`**：项目内标准相对路径（例如 `src/daemon/index.ts`、`src/core/diff/myers-algorithm.ts`）；
3. **`Architecture Role`**：架构定位与系统边界（阐明在分层架构中的职责，如“常驻守护进程聚合门面”、“纯数学计算内核”）；
4. **`Dependencies & Triggers`**：上下游依赖与激活触发源（消费哪些模块、被哪些上层服务/CLI/门禁导入或调用）；
5. **`Responsibilities`**：核心职责清单（必须以数字标号列出 2~4 条具体的实质性技术职责）；
6. **`Design Rationale`**（或 `Exit Semantics & Design Rationale`）：设计权衡依据、降级策略、退出语义或并发不变式说明。

### 2. 标准规范范例
```typescript
/**
 * Module: Daemon Subsystem — Barrel & Process Fault Resilience Facade
 * File Path: src/daemon/index.ts
 * Architecture Role: Central facade for the persistent daemon subsystem; re-exports client,
 *   server, protocol, scan handler, and registry utilities while installing process-level
 *   unhandled rejection resilience listeners to prevent daemon process crashes.
 * Dependencies & Triggers: Consumes ./server, ./client, ./protocol, ./registry, ./scanHandler;
 *   imported by external consumers, daemon CLI, and integration harnesses.
 * Responsibilities:
 *   1. Re-export daemon components and protocol contracts;
 *   2. Install process-wide unhandledRejection event listener;
 *   3. Provide lifecycle verification and assertion helpers.
 * Exit Semantics & Design Rationale: Process listener logs diagnostics to stderr without exiting,
 *   preserving daemon process availability during transient unhandled promise rejections.
 */
```

---

## 六、 ECR 有效注释密度模型与契约质量规范

工作区静态分析引擎采用语义九分类加权体系计量有效注释密度（`comment-density-model.ts`），严禁注水式注释与无意义代码复述：

### 1. 注释九分类语义权重矩阵

| 分类标识 (Category) | 语义权重 ($w_i$) | 判定特征与内容标准 |
| :--- | :---: | :--- |
| **`DESIGN_RATIONALE`** | **+1.0** | 阐述设计权衡、为何做此技术选型（why / because / rationale / trade-off） |
| **`ARCHITECTURE_INTENT`** | **+1.0** | 声明架构定位、分层边界、领域模型归属（architecture role / facade / domain） |
| **`ALGORITHMIC_PROOF`** | **+1.0** | 算法复杂度上下界、推导依据、收敛性证明（$\mathcal{O}(ND)$、heuristic、proof） |
| **`LIFECYCLE_OWNERSHIP`** | **+0.9** | 资源生命周期、内存释放、线程安全、并发重入（thread-safe / idempotent / dispose） |
| **`INVARIANT_BOUNDARY`** | **+0.9** | 系统不变式、前置/后置条件、防御边界（invariant / precondition / fallback） |
| **`API_CONTRACT`** | **+0.8** | 结构化 JSDoc 标签契约（`@param` / `@returns` / `@throws` / `@example`） |
| **`TRIVIAL_TRANSLATION`** | **0.0** | 仅机械重复下一行标识符字面名称（如 `getUser()` 上方注释 `// get user`） |
| **`BEHAVIOR_ECHO`** | **-0.2** | 简单复述下一行显而易见的语句（如 `return true;` 上方注释 `// return true`） |
| **`WATER_LOGGING`** | **-0.5** | 空占位符、无实质内容的注水标记（`// TODO` / `// temp` / `// placeholder` / `// fixme`） |

### 2. 有效注释率 (ECR) 与反注水红线
- **有效注释行 (ECL)**：$\text{ECL} = \max(0, \sum w_i)$
- **有效注释率 (ECR)**：$\text{ECR} = \text{ECL} / \text{totalCommentLines}$
- **注水熔断红线**：
  当注释总行数 $\ge 5$ 行时，若 $\text{ECR} < 0.40$ 或包含 $\ge 2$ 处 `WATER_LOGGING` 注水，静态分析直接判定为 `GOV-GAM-001: tautological_comment_padding` 违规；
- **消除假分支幽灵注释**：严禁伪造无执行逻辑的条件分支（如 `if (false)`、死循环分支或未实现桩代码）并在其内部堆砌注释以虚增注释量；
- **根除敏捷冲刺期过程性代号**：正文与注释中绝对严禁出现敏捷冲刺期临时代号（如 `W1~W9`、`Pass 1..6`、`Sprint 3`、`Week 41` 等短期过程标记）。所有注释必须表述为恒定存在的客观技术事实、架构不变式与算法原理。

---

## 七、 复杂核心算法边界声明与降级不变式契约

高复杂度或长耗时核心算子（如 Myers Diff、语法分析器、大规模 AST 遍历、状态机求解器）必须在 JSDoc 契约与实现中显式声明前置不变式与降级边界：

### 1. 降级边界策略声明契约 (Degradation & Fallback Strategy)
必须明确算子的最差时间/空间复杂度包络及自动降级触发条件。以工作区 Myers 差异对比内核（`myers-algorithm.ts`）为例：
- **复杂度与内存包络**：Myers 对角线搜索需分配 $(max + 1) \times (2 \times max + 1)$ 的中间追踪矩阵，在极端不相交差异下存在平方级内存与耗时风险；
- **刚性降级条件**：
  当剔除公共前缀与后缀后的中间跨度 $\max(midN + midM) > 1500$ 行，或对角线追踪矩阵超过 2,000,000 单元格时，算法必须主动降级并回退至 `histogramDiff`，从根源规避内存溢出（OOM）与事件循环冻结：

```typescript
// Guard against OOM on large unpruned/disjoint matrices (>1500 lines or >2M cells).
if (max > MYERS_MAX_MID_LINES || (max + 1) * (2 * max + 1) > 2_000_000) {
  return histogramDiff(a, b, effectiveHashA, effectiveHashB);
}
```

### 2. 前置哈希等长不变式契约 (Precondition Length Invariant)
核心算子若支持预计算缓存（如预先计算的行哈希缓冲区 `hashA`、`hashB`），必须声明并断言前置等长不变式：
- **刚性断言**：`hashA.length === a.length` 且 `hashB.length === b.length`；
- **违例危害**：传入长度不匹配的切片或脏缓存会破坏缓冲区内存对齐，引发越界访问或对角线蛇形比对误判。

---

## 八、 循环体内零瞬态堆分配刚性约束 (`CPX-SPACE-001` / `ADV-PRF-002`)

在日志流解析、轨迹追踪、图表渲染、帧调度或大规模 AST 遍历等高频执行路径中，循环内任何无谓的堆内存分配都将引发 GC 抖动，必须坚决杜绝：

1. **零临时对象与闭包分配**：
   - 严禁在循环体内声明局部匿名函数、箭头回调或临时字面量对象 `{}`；
   - 状态收集器与上下文变量应提升至循环外部复用，循环体仅做标量属性覆写；
2. **连续缓冲区预分配 (TypedArray Buffer)**：
   - 数值采样、插值计算与坐标变换场景中，使用 `Float64Array` / `Int32Array` 单例缓冲区，杜绝循环内反复 `new Array()` 或调用 `.slice()`；
3. **行缓冲收集 Join 替代字符串连加**：
   - 大文本生成、HTML/Markdown 拼接循环中，严禁在循环内连续使用 `+=` 进行字符串堆拼接；统一在循环外初始化行数组，使用 `push()` 收集后在循环外一次性 `join('\n')`；
4. **迭代器直接解构替代中间容器复制**：
   - 遍历 `Map` / `Set` 时直接使用 `for (const [k, v] of map)`，严禁使用 `[...map.entries()]` 或循环内 `Object.keys()` 生成中间瞬态数组；
5. **对象池与 `reset_state()` 契约**：
   - 复杂生命周期对象必须采用对象池化技术，借出使用完毕必须调用 `reset_state()` 归还池中，严禁高频 `new` 与垃圾回收；
6. **队列单指针游标推进替代 `shift()` 数组移位**：
   - 广度优先搜索与批次调度中，严禁在循环内调用 `queue.shift()`（会导致每次出队全量元素前移，$O(V^2)$ 复杂度退化）；
   - 统一采用单指针游标模式：`let head = 0; while (head < queue.length) { const cur = queue[head++]; ... }`，将出队平摊开销压缩至 $O(1)$ 并杜绝内存重排；
7. **AST 遍历行缓存与切片复用**：
   - 在针对大文件进行多次函数或 AST 节点分析时，严禁在每个节点内部重复执行 `content.split('\n')`；
   - 必须在分析器初始化或文件入口处一次性缓存 `cachedLines`，后续提取切片直接从缓存中 `slice`，杜绝数百万个瞬态字符串对象生成；
8. **行扫描与词法正则顶层不可变常量化 (`PRF-MEM-001`)**：
   - 严禁在循环内或函数内部通过 `new RegExp(...)` 或行内字面量动态创建正则表达式；
   - 必须将其提升为模块顶层 `const RE_XXX = /^.../` 不可变常量；若涉及带全局 `/g` 标志的正则在循环中复用，必须重置 `lastIndex = 0` 或改用无状态匹配模式。

---

## 九、 防刷分、反注水与虚假收益熔断守卫 (`BLOCK_GAMING_DETECTED` / `GOV-GAM-001`)

在重构与优化作业中，严禁制造无实质质量改善的表面指标刷分：
- **禁止手段**：单纯重命名局部变量、微调注释空白、重排 `import` 语句、移动物理文件位置、或生成无调用的空壳跳板；
- **反注水拦截 (`GOV-GAM-001`)**：严禁通过复制无意义注释或自造假分支虚增注释率，注释必须承载真实的技术设计意图与架构约束；
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
- 循环体与热路径零瞬态堆分配，无 `CPX-SPACE-001` 违规。
