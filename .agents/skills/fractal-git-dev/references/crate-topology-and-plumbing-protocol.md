# Taxis 10 大内核子系统拓扑、Plumbing 二进制协议与 CCD v2 冲突检测深水区指南

本指南提供 `fractal-git`（Taxis）内核在子系统边界划分、Git Plumbing 字节级协议实现以及偏序集同态冲突检测（CCD v2）的完整工程细则。

---

## 一、 10 大内核子系统职责边界与禁区矩阵 (`FGT-TOP-001` / `FGT-DEP-001`)

1. **`fg-core`**：定义 `ObjectId`（20/32 字节定长栈数组）、`CrateError` 基础特征与 `constants/` 单源常量表；严禁引入文件 I/O 或并发锁；
2. **`fg-object`**：纯内存零拷贝解析与编码 Git `blob`、`tree`、`commit`、`tag` 对象；Tree 条目排序必须对子目录名按隐式追加 `0x2F` (`/`) 比较字节序；
3. **`fg-pools`**：提供线程安全的世代戳对象池（`BufferPool`、`DeltaArena`），通过 RAII 守卫在作用域结束时自动执行 `buf.clear()` 归还容量（`FGT-PRF-001`）；
4. **`fg-index`**：实现 `.git/index`（DIRC v2/v3）二进制编解码与内存无锁前缀树（Lock-Free ART / Snapshot Index）；
5. **`fg-storage`**：封装 Loose Object 暂存原子重命名落盘（`temp -> fsync -> rename`）与 Packfile 内存映射读取（`FGT-STO-001`）；
6. **`fg-algorithms`**：承载 64-bit SWAR 行边界扫描、Myers/Histogram 差分、Kirsch-Mitzenmacher 双哈希布隆过滤器与 CCD v2 偏序集同态算子（`FGT-ALG-001`）；
7. **`fg-topology`**：管理 DAG 提交图可达性、分支引用（Refs）与多智能体 Cell 虚拟工作树分叉拓扑；
8. **`fg-transport`**：封装本地与远端引用协商、Pack 流式传输包帧（pkt-line）编解码；
9. **`fg-gate`**：内置 17 条 `FGT-*` 架构门禁自检器，确保内核自身代码符合零 Panic、零热路径锁与 `// SAFETY:` 证明（`FGT-GAT-001`）；
10. **`fg-native`**：暴露给 Node.js / CLI 的 FFI 与 N-API 边界层，必须使用 `std::panic::catch_unwind` 隔离异常（`FGT-BRG-001`）。

---

## 二、 Git Plumbing 二进制帧协议要点 (`FGT-OBJ-001` / `FGT-IDX-001`)

### 1. Loose Object 存储帧
$$\text{ZlibDeflate}\Big(\text{ASCII}(\text{kind}) \mathbin{\Vert} \texttt{0x20} \mathbin{\Vert} \text{ASCII}(\text{decimal\_len}) \mathbin{\Vert} \texttt{0x00} \mathbin{\Vert} \text{payload}\Big)$$
- OID 由未压缩前的完整字节流计算 SHA-1（或 SHA-256）；
- 落盘路径为 `.git/objects/<hex[0..2]>/<hex[2..]>`，必须先写入同目录临时文件再原子 `rename`。

### 2. Tree 对象条目二进制布局
$$\text{ASCII}(\text{octal\_mode}) \mathbin{\Vert} \texttt{0x20} \mathbin{\Vert} \text{filename} \mathbin{\Vert} \texttt{0x00} \mathbin{\Vert} \text{raw\_oid (20 bytes)}$$
- 注意：文件模式为八进制无前导零 ASCII（如普通文件 `100644`、可执行文件 `100755`、子目录 `40000` 而非 `040000`）。

---

## 三、 偏序集同态冲突检测 (CCD v2) 与三层升级协议

在多 SubAgent 并发修改同一代码库时，Taxis 通过三层漏斗判定两个虚拟工作树快照 $S_A, S_B$（基于共同祖先 $S_0$）是否可无锁合并：

1. **L1 路径正交预筛（$< 5\mu\text{s}$）**：
   每个 Cell 维护修改文件集合的 256-bit 双哈希布隆过滤器 $B_A, B_B$。若 $(B_A \mathbin{\&} B_B) == 0$，直接证明文件级零交集，O(1) 原子合并 Tree 节点。
2. **L2 行块偏序集同态（Poset Homomorphism）**：
   对交集文件提取相对于 $S_0$ 的差分编辑算子序列 $\Delta_A, \Delta_B$。若所有编辑区间的半开行范围 $[l_i, r_i)$ 满足严格偏序分离（间隔 $\ge 2$ 行上下文安全边距），则满足交换律 $\Delta_A \circ \Delta_B(S_0) = \Delta_B \circ \Delta_A(S_0)$，自动合成合并快照。
3. **L3A 冲突阻断与精准切片上送**：
   若存在重叠或毗邻行块修改，立即拒绝投机合并，生成带精确行号区间与共同祖先基线的结构化冲突报告（`FGT-COR-001`）。
