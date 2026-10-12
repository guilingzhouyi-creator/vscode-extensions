# 无分支 256-LUT、位并行代数、CSR 扁平图与时代戳 $O(1)$ 复位深度实现图谱

> 本指南提供跳出传统面向对象/多趟正则思维的五大底层算子工程实现模式，涵盖 TypeScript (V8)、Rust (N-API) 与 GDScript 4.7。

---

## 一、 模式 1：256 项 `Uint8Array` 无分支字符分类位表 (Branchless 256-LUT)

### 痛点
传统代码在词法扫描或高密度行检查中编写大量 `if (ch === '+' || ch === '-' || ch === '*' ...)` 或 `.replace(/\s+/g, '')`，不仅产生大量 CPU 分支预测失败（Branch Misprediction），还伴随瞬态字符串堆分配。

### 突破方案
在模块加载期一次性构造 256 字节的 `Uint8Array` 位掩码表，将所有 ASCII 字符的类别属性（空白符、标识符首字符、算子、引号、数字、括号）压缩进单字节的 8 个 Bit 中。单次查表仅需 1 次定长数组偏移读取 + 1 次按位与运算：

```typescript
const FLAG_WS       = 1 << 0; // ' ', '\t', '\r', '\n'
const FLAG_OP       = 1 << 1; // ?:+-*/%&|^!~=<>
const FLAG_QUOTE    = 1 << 2; // ' " `
const FLAG_IDENT    = 1 << 3; // A-Z, a-z, 0-9, _, $

const CHAR_LUT = (() => {
  const lut = new Uint8Array(256);
  for (const ch of [9, 10, 11, 12, 13, 32]) lut[ch] |= FLAG_WS;
  for (const ch of '?:+-*/%&|^!~=<>') lut[ch.charCodeAt(0)] |= FLAG_OP;
  for (const ch of '\'"`') lut[ch.charCodeAt(0)] |= FLAG_QUOTE;
  for (let c = 48; c <= 57; c++) lut[c] |= FLAG_IDENT;
  for (let c = 65; c <= 90; c++) lut[c] |= FLAG_IDENT;
  for (let c = 97; c <= 122; c++) lut[c] |= FLAG_IDENT;
  lut[95] |= FLAG_IDENT; // '_'
  lut[36] |= FLAG_IDENT; // '$'
  return lut;
})();

// 零分支、零分配单趟同时统计非空白字符数与算子数
export function scanLineMetricsBranchless(line: string): { nonWs: number; ops: number } {
  let nonWs = 0;
  let ops = 0;
  for (let i = 0, len = line.length; i < len; i++) {
    const code = line.charCodeAt(i);
    const flags = code < 256 ? CHAR_LUT[code] : 0;
    nonWs += (flags & FLAG_WS) === 0 ? 1 : 0;
    ops += (flags & FLAG_OP) !== 0 ? 1 : 0;
  }
  return { nonWs, ops };
}
```

---

## 二、 模式 2：行级 32-Bit 特征签名磁带与多级短路漏斗 (Line Feature Bitmask Tape)

### 痛点
治理引擎有 200+ 条规则，若每条规则都对每行调用一次正则匹配，总复杂度为 $O(R \times L \times C)$。

### 突破方案
在文件单趟扫描生成 `MaskedLine` 时，顺带为每行计算一个 32-bit 整数签名 `featureMask: number`（存入 `Uint32Array(lineCount)`）：
- `BIT_HAS_TERNARY (1 << 0)`：行内掩码后存在 `?` 与 `:`
- `BIT_HAS_LOGICAL_CHAIN (1 << 1)`：存在 `&&` 或 `||`
- `BIT_HAS_NULLISH (1 << 2)`：存在 `??` 或 `?.`
- `BIT_HAS_CALL_PAREN (1 << 3)`：存在 `(`
- `BIT_HAS_STRING_LIT (1 << 4)`：原行包含引号字面量

下游规则聲明其前置依赖位 `requiredMask`：
```typescript
// 若当前行连前置特征位都不满足，1 个 CPU 周期直接跳过，绝不调用正则或 AST 分析！
if ((lineFeatureMask[lineIdx] & rule.requiredMask) !== rule.requiredMask) {
  continue;
}
```

---

## 三、 模式 3：面向数据的 CSR 压缩稀疏行扁平图 (Flat CSR Graph vs Object Graph)

### 痛点
传统图结构 `Map<string, Set<string>>` 或 `Node { edges: Node[] }` 存在海量小对象指针跳转、哈希桶冲突与 GC 标记负担。

### 突破方案
将 $V$ 个节点编号为 $0 \dots V-1$，使用三个连续的 `Int32Array`（链式前向星 / CSR）表示整张有向图：
- `head = new Int32Array(V).fill(-1)`：每个节点的第一条出边索引
- `to = new Int32Array(E)`：第 $e$ 条边指向的目标节点 ID
- `next = new Int32Array(E)`：与第 $e$ 条边同起点的下一条边索引

遍历节点 `u` 的所有邻接点仅需紧凑整数索引访问，CPU 缓存亲和度极高：
```typescript
for (let e = head[u]; e !== -1; e = next[e]) {
  const v = to[e];
  // 处理边 u -> v
}
```

---

## 四、 模式 4：时代戳 $O(1)$ 零清零状态复位 (Epoch Generation Counter)

### 痛点
在针对每个模块/函数求可达闭包、支配树或对象池借还时，若每次调用 `visited.fill(0)` 或 `new Set()`，$V$ 次查询会产生 $O(V^2)$ 的清零开销。

### 突破方案
维护一个持久化的 `visitedEpoch = new Int32Array(maxNodes)` 与单调递增的整数 `currentEpoch`：
```typescript
let currentEpoch = 1;
const visitedEpoch = new Int32Array(MAX_NODES);

export function beginTraversalPass(): number {
  currentEpoch = (currentEpoch + 1) | 0;
  if (currentEpoch <= 0) {
    // 仅在 21 亿次溢出时执行一次物理归零
    visitedEpoch.fill(0);
    currentEpoch = 1;
  }
  return currentEpoch;
}

// 判重与标记均为 O(1)，且两次遍历之间零清零开销！
if (visitedEpoch[nodeId] !== currentEpoch) {
  visitedEpoch[nodeId] = currentEpoch;
  queue[tail++] = nodeId;
}
```

---

## 五、 模式 5：64-Bit 位并行集合代数与 Rust SWAR 向量化扫描

1. **Bitset 支配集与闭包运算**：
   将图的集合运算（交集 `&`、并集 `|`、差集 `& ~`）打包进 `Uint32Array`（TS）或 `Vec<u64>`（Rust），使传递闭包与 Lengauer-Tarjan 半支配点关联集运算获得 $32\sim 64$ 倍的指令级并行加速。
2. **Rust 64-Bit SWAR 字节流探测 (`crates/ops-mask`)**：
   每次从字节切片加载 `u64`（8 字节），利用广播掩码 `0x0101010101010101` 与异或技巧一次性并行检测 8 个字节中是否包含引号 `"`、斜杠 `/` 或换行符 `\n`；若 8 字节全为普通字符，直接步进 `idx += 8`！
3. **GDScript 4.7 高承压循环优化 (`WebGames`)**：
   在 `_process` / 经济与战斗批量求解器中，使用预分配的 `PackedInt32Array` / `PackedFloat64Array` 连续数组替代嵌套 `Array[Dictionary]`，并通过对象池 `reset_state()` + 时代戳索引彻底清零帧内堆分配（`ADV-PRF-002`）。
