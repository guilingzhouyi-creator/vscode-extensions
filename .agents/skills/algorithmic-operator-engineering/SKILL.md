---
name: algorithmic-operator-engineering
description: >-
  算法与高性能算子第一性原理突破工程规范。指导 Agent 跳出传统语法级微调思维，
  通过五步降维思考协议（代数级零工预筛漏斗、面向数据表示层反转 SoA/CSR、无分支查表 LUT 与位级并行 SWAR/Bitset、
  单趟结构化磁带算子融合、时代戳 O(1) 零清零复用与自适应多模态退化）实现数量级吞吐跃升与 100% 差分等价验证。
---

# algorithmic-operator-engineering — 算法与高性能算子第一性原理突破规范

本技能指导 Agent 在开发或重构核心算法与算子（`auto-refactor` 的 Rust/TS 双轨词法/AST/图/差分算子、`WebGames` 的高频求解器与对象池循环、`workspace-timing` 的时间序列与流式聚合引擎）时，**跳出“仅提炼正则或微调循环”的传统语法级修补思维**，从数据表示、代数预筛、位级并行与单趟融合四个底层维度实现数量级的性能与内存突破。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **核心算子研发与瓶颈攻坚**：编写词法扫描、Myers/Histogram 差分、依赖图（Tarjan SCC / 支配树 / BFS / DFS）、代码克隆（MinHash / LSH）或 AST 切片算子；
2. **传统优化触顶**：单纯提取常量或减少属性访问已无法降低耗时，需从 $O(N \cdot M)$ 或多趟扫描降阶至 $O(N)$ / $O(1)$；
3. **高频热路径与帧循环**：处理万级文件扫描、百万节点图遍历、Godot `_process` 帧更新或实时遥测流聚合；
4. **跨语言双轨算子对齐**：在 Rust N-API 原生内核与 TypeScript / GDScript 之间设计 100% 字节等价的高吞吐算子。

---

## 二、 跳出传统：五步降维思考协议 (5-Step Dimensional Reduction Protocol)

严禁上来直接修改局部语句。在动笔优化任何算子前，必须按顺序回答以下五个第一性原理问题：

```text
[Step 1: 零工预筛] 能否用 O(1) 位签名/长度/哈希不变量直接拒绝 >95% 的非目标输入，完全不进主循环？
      │
      ▼
[Step 2: 表示反转] 能否消灭指针对象图 (Object Graph)，反转为扁平连续 TypedArray / CSR 前向星 / 整数 ID？
      │
      ▼
[Step 3: 无分支与位并行] 能否用 256 项 Uint8Array 查表 (LUT) 或 32/64-bit 位运算替代多路 if/switch/正则？
      │
      ▼
[Step 4: 单趟磁带融合] 能否将 N 个分析器/规则的多遍文本扫描融合为 1 次线性扫描 + 结构化特征磁带查询？
      │
      ▼
[Step 5: 时代戳与增量] 能否用 Epoch 版本号自增实现 O(1) 状态重置，或用滑动差分/长程窗口拓扑检测消灭重复计算与死循环？
```

---

## 三、 七大非常规算子突破范式 (Seven Operator Breakthrough Paradigms)

| 范式编号与名称 | 传统思维陷阱 (Conventional Trap) | 第一性原理突破手段 (Breakthrough Operator) | 复杂度/硬件收益 |
| :--- | :--- | :--- | :--- |
| **1. 代数级零工预筛漏斗**<br/>*(Zero-Work Pre-Filter Cascade)* | 对每行/每文件无差别运行正则列表或 AST 遍历 | 构建 **L0 扩展名/长度短路 $\to$ L1 行级 32-bit 特征位掩码 (`lineFeatureMask`) $\to$ L2 滚动哈希 $\to$ L3 精确匹配** 四级漏斗 | 滤除 $>95\%$ 无关输入，主算子触发率降至 $<5\%$ |
| **2. 面向数据表示层反转**<br/>*(DoD / SoA / CSR Arena)* | 构建含 `{ id: string, children: Node[] }` 的堆对象指针树，引发 GC 与缓存未命中 | 字符串经 `SymbolInterner` 映射为 `uint32`；图结构反转为 **`Int32Array` 压缩稀疏行 (CSR / 链式前向星 `head/to/next`)** | 零指针追逐，L1/L2 Cache 顺序预取命中率提升 $5\sim 10\times$ |
| **3. 无分支查表分发**<br/>*(Branchless 256-LUT)* | 连续 `if (c === ' ' \|\| c === '\t' ...)` 或 8 路前缀 `startsWith` 试探 | 预置模块级 `Uint8Array(256)` 字符分类位表（`CHAR_FLAGS[code] & MASK`）与 `charCodeAt` 首字符 $O(1)$ 跳转 | 消除 CPU 分支预测失败惩罚，字符分类耗时恒定 $O(1)$ |
| **4. 位级并行与 SWAR**<br/>*(Bit-Parallel & SWAR Algebra)* | 用 `Set<number>` 求交并集或二维数组计算编辑距离 | 支配集/可达集打包为 `Uint32Array` / `u64` 位集（单指令并行 32/64 节点）；Myers 采用 `Peq` 位向量并行加法；Rust 采用 64-bit SWAR 字节扫描 | 集合与DP运算吞吐量提升 $32\sim 64\times$，零堆内存分配 |
| **5. 单趟磁带与算子融合**<br/>*(Single-Pass Tape Fusion)* | $K$ 条规则对同一文件各自执行一遍行遍历或词法扫描（$K \times N$） | 在单趟词法脱敏（`maskSource`）时同步产出**结构化特征磁带**（每行偏移、缩进、算子/引号/注释位标志）并预过滤紧凑 `ActiveHook[]` | 将 $O(K \cdot N)$ 压缩为严格单趟 $O(N)$，消除空转回调 |
| **6. 时代戳 $O(1)$ 零清零复用**<br/>*(Epoch Counter Reset)* | 每次子图查询或循环迭代调用 `visited.fill(0)` 或 `new Set()`（导致 $Q \times O(V)$ 退化） | 维护全局复用 `visitedEpoch = new Int32Array(maxV)` 与单调递增 `currentEpoch++`；通过 `visitedEpoch[u] === currentEpoch` 判重 | 每次查询间的状态重置开销从 $O(V)$ 降至严格 $O(1)$ |
| **7. 多模态自适应混合包络**<br/>*(Poly-Algorithmic Envelope)* | 单一重型算法硬扛所有规模与熵分布输入 | $N \le 16$ 走寄存器位掩码/线性扫描；中等规模低差异走 Bit-Parallel Myers；跨度 $>1500$ 行或矩阵 $>2\text{M}$ 单元格自动降级 `histogramDiff` | 兼顾小输入零常数开销与极端退化输入下的零 OOM 保障 |
| **8. 交互动力学与感知信号算子**<br/>*(Kinetic & Perceptual Operators)* | 连续 requestAnimationFrame 步进数值积分或粗暴线性插值 | 采用 **二阶阻尼谐振子解析解算子**（直接代入 $e^{-\zeta \omega_0 t}$）+ **光标不动点仿射变换** + **感知幂律 Gamma 压缩** | 消除积分累积误差，每帧开销从步进迭代压缩为单次代数解算 |

---

## 四、 跨语言泛化算子与工作区多栈统一映射矩阵 (Generalized Primitives $\leftrightarrow$ Workspace Unification)

本规范将通用算法第一性原理泛化抽象为语言无关的算子原语，并在工作区三大技术栈与单源规则目录（`rule-catalog.json`）间保持 100% 统一受控：

| 泛化算子原语 (Generalized Primitive) | TypeScript / Node.js V8 (`auto-refactor` / `workspace-timing`) | Rust N-API 原生层 (`auto-refactor/native`) | GDScript 4.7 纯逻辑引擎 (`WebGames`) | 工作区统一门禁与契约映射 (`rule-catalog.json`) |
| :--- | :--- | :--- | :--- | :--- |
| **零堆分配平坦竞技场 (Flat Arena / SoA)** | `Int32Array` / `Float64Array` / `Uint32Array` | `Vec<u32>` / `&[u8]` 零拷贝切片 | `PackedInt32Array` / `PackedFloat64Array` | `CPX-SPACE-001` / `ADV-PRF-002` |
| **无分支查表分发 (Branchless 256-LUT)** | 模块级静态 `Uint8Array(256)` + `charCodeAt` | `static [u8; 256]` + `as usize` 索引 | 预加载常量 `PackedByteArray` 查表 | `GATE-AST-001` ($\text{CC}\le 15, \text{Depth}\le 4$) |
| **位并行与集合代数 (Bitset / SWAR)** | `Uint32Array` 位集 ($32\text{-bit}$ 步进) | `u64` / `u128` SWAR 寄存器并行 | `int` ($64\text{-bit}$ 有符号位掩码运算) | `ALGORITHMIC_PROOF` 契约注释 |
| **时代戳 $O(1)$ 状态复位 (Epoch Reset)** | `visitedEpoch: Int32Array` + `epoch++` | `visited_epoch: Vec<u32>` + `wrapping_add` | 成员 `PackedInt32Array` + `_epoch += 1` + `reset_state()` | `ADV-PRF-002` (禁止帧循环 `clear/fill`) |
| **定长环形缓冲轨迹记忆 (RingBuffer Trajectory)** | 预分配固定容量数组 + 双指针位回环游标 | `VecDeque` 预分配或定长数组轮询 | 定长 32 槽位数组 + `cursor = (cursor + 1) % N` 覆盖 | `PRF-MEM-001` / `ADV-PRF-002` |
| **容器原位注入 (In-Place Injection)** | 调用方传入预分配上下文 `out: Context` 就地覆写 | `&mut Context` 就地借用，零生命周期逃逸 | 传入预分配 `Dictionary` / `Array`，严禁返回新实例 | `CPX-SPACE-001` / `ADV-PRF-002` |
| **长程拓扑振荡检测 (Multi-step Cycle Detection)** | 滑动窗口定长哈希匹配 ($k \le 16$) 计算环长 | 状态指纹环形滑动窗口与拓扑剪枝 | 状态机历史指纹比对与自适应阻断 | `PRF-ALG-002` / `ALGORITHMIC_PROOF` |
| **多模态退化保护包络 (Fallback Envelope)** | 跨度 $>1500$ 行或 $>2\text{M}$ 单元降级线性/直方图 | 双轨阈值同步 (`MAX_MYERS_CELLS`) | 步数/节点超阈值降级启发式近似求解 | `INVARIANT_BOUNDARY` 六字段 JSDoc |

---

## 五、 刚性工程红线与差分神谕验证 (Differential Oracle Verification)

跳出传统的激进算子优化必须置于铁律防线之下，严禁以牺牲正确性或可读性契约为代价：
1. **差分神谕 100% 等价铁律 (Reference Oracle Parity)**：
   - 任何位并行、LUT、CSR 或单趟融合算子上线前，必须以朴素直观实现作为 **Reference Oracle（基准神谕）**，在涵盖空输入、多字节 UTF-8、极端退化边界的语料集上断言输出 **100% 字节与行号等价**；
   - Rust N-API 算子与纯 TS Shim 必须通过 `validate-native-parity.js` 与 `validate-equivalence.js` 双轨等价校验。
2. **微基准量化证明 (`bench-hot-paths.js` / `TB-REGRESSION`)**：
   - 优化前后必须运行 `node auto-refactor/scripts/bench-hot-paths.js`（或对应子项目基准），以客观耗时（`hrtime.bigint`）与堆内存增量证明实质收益，严禁无基准支撑的盲目复杂化。
3. **复杂度与注释契约守卫 (`GATE-AST-001` / `CPX-SPACE-001` / `ADV-PRF-002`)**：
   - 算子内部通过拆解 $\text{CC} \le 15$、$\text{Depth} \le 4$ 的无副作用纯函数保持平铺；
   - 循环体内保持零瞬态堆分配；在模块头六字段 JSDoc 中显式记录位掩码布局、前置等长不变式与退化降级阈值（`ALGORITHMIC_PROOF` / `INVARIANT_BOUNDARY`）。

---

## 六、 常用验证与基准测试命令

```bash
# 1. 运行 auto-refactor 核心算子热路径微基准 (mask-source / governance-scan / cmp-rules)
node auto-refactor/scripts/bench-hot-paths.js

# 2. 验证 Rust 原生算子与纯 TS Shim 100% 字节等价及全量 155 套测试
cd auto-refactor && npm run build && npm test

# 3. 验证 WebGames 静态提取与 ADV-PRF-002 零瞬态分配门禁
python WebGames/scripts/py/audit_arch_static.py

# 4. 验证 AST 切片复杂度与双轨体积预算
node scripts/common/evaluate-eloc-budget.js
```

---

## 七、 关联深水区参考与算子样板

- [bit-parallel-lut-and-dod-patterns.md](references/bit-parallel-lut-and-dod-patterns.md)：无分支 256-LUT、位并行代数、CSR 扁平图、单趟特征磁带与时代戳 $O(1)$ 复位深度实现图谱（TS / Rust / GDScript）；
- [branchless-lut-and-epoch-operator.ts](templates/branchless-lut-and-epoch-operator.ts)：集成 256 项 `Uint8Array` LUT、CSR 扁平图与 `Int32Array` 时代戳 $O(1)$ 遍历的标准算子样板。
