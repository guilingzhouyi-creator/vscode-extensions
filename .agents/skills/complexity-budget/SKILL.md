---
name: complexity-budget
description: >-
  代码复杂度与体积双轨预算控制工作流。指导 Agent 在编写、重构或审查代码时，
  严格看守 AST 局部切片守卫（CC<=15, Depth<=4, Noise<=4.0）、单文件双轨体积（ELOC<=900, LOC<=1400）、
  1:3 动态反推包络与高负荷契约注释密度，平铺控制流并拦截虚假重构刷分。
---

# complexity-budget — 代码复杂度与体积双轨预算控制工作流

本技能定义了工作区代码复杂度局部切片预算、控制流降维平铺模式、有效代码行（ELOC）与物理行（LOC）双轨体积约束以及高频循环内存空间纪律的标准工程规范。

---

## 一、 适用场景与触发条件

在以下任一开发或治理场景中，必须激活本技能实施复杂度预算审查：
1. **编写新功能或重构模块**：新增或修改任何语言（`.ts`, `.js`, `.gd`, `.py`, `.sh`, `.ps1` 等）的源码文件；
2. **函数逻辑分支扩张**：单函数出现多层嵌套判断（`if` / `switch` / `try`）、深层循环体或复杂事件解析管道；
3. **文件体积逼近预警线**：源码文件行数逼近 600 行或物理行数逼近 1100 行，需要进行架构评估与体积收敛；
4. **高频循环与渲染热路径**：涉及图表绘制、轨迹解析、状态机帧轮询、日志批量处理等高吞吐路径；
5. **提交前门禁自检**：在执行 `pre-commit` 门禁前，确保所有暂存区文件 100% 满足 AST 局部切片与双轨体积守卫。

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

### 2. 复杂数据管道与日志解析解耦（参考 `record-workspace-trajectory.js` 实战范式）
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

## 五、 循环体内零瞬态堆分配刚性约束 (`CPX-SPACE-001` / `ADV-PRF-002`)

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
   - 复杂生命周期对象必须采用对象池化技术，借出使用完毕必须调用 `reset_state()` 归还池中，严禁高频 `new` 与垃圾回收。

---

## 六、 防刷分与虚假收益熔断守卫 (`BLOCK_GAMING_DETECTED`)

在重构与优化作业中，严禁制造无实质质量改善的表面指标刷分：
- **禁止手段**：单纯重命名局部变量、微调注释空白、重排 `import` 语句、移动物理文件位置、或生成无调用的空壳跳板；
- **熔断判定**：重构改动中若语义有效代码变化量 $\text{ELOC}_{semantic} \le 15\%$ 且未消除任何真实技术债违规项，门禁系统将直接触发 `BLOCK_GAMING_DETECTED` 熔断阻断。

---

## 七、 本地预审指令与断言标准

在提交代码前，必须执行以下离线验证以确保复杂度预算完全合规：

```powershell
# 1. 验证全仓源码双轨体积与 1:3 动态包络合规性
node scripts/common/evaluate-eloc-budget.js

# 2. 验证暂存区 AST 局部切片守卫与物理行数（Gate 5 与 Gate 9）
pwsh -File scripts/ps1/pre-commit-gate.ps1
```

**质性断言标准**：
- 控制台输出全绿通过，没有任何函数超出 CC $\le 15$（或弹性包络 $\le 25$）、Depth $\le 4$、Noise $\le 4.0$ 红线；
- 暂存区所有改动文件均严格位于 1:3 双向动态包络安全带内；
- 循环体与热路径零瞬态堆分配，无 `CPX-SPACE-001` 违规。
