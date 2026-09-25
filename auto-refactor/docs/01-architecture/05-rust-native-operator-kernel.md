# 🦀 Rust 原生算子库（auto-refactor-ops）模块化架构与双轨等价规范

> **规范级别**：CORE-RUST-OPS-SPEC-v0.4.0  
> **所属模块**：`crates/` 与 `src/core/native`  
> **设计目标**：将计算密集型算法（SIMD 源码脱敏、Git 直方图差分、Tarjan SCC 图分析、多模式扫描与克隆检测）解耦下沉至独立 Rust 算子库，同时通过 `PureJsNativeShim` 保持 100% 双轨容灾与逐字节行为等价。

---

## 一、 架构背景与粗粒度算子原则 (Coarse-Grained Law)

在混合语言架构（Node.js + Rust N-API）中，跨语言 FFI 调用的单次往返边界开销约为 30 ~ 80ns，细粒度跨语言对象序列化会导致整体性能大幅劣于 V8 JIT。

为此，`auto-refactor-ops` 遵循以下核心硬性架构契约：
1. **粗粒度批处理边界**：
   - 严禁逐 AST 节点或逐字符跨 FFI 回调；
   - 跨语言输入必须为整块文本切片 `&str` / `&[u8]` 或扁平拓扑边数组 `Vec<Vec<String>>`；
   - 跨语言输出必须为紧凑扁平结构体数组（如 `NativeMaskedSource`、`Vec<NativeDiffHunk>`），一次性回传 V8。
2. **纯 Rust 算子与 N-API 解耦**：
   - 底层各子 Crate（`ops-diff`、`ops-graph`、`ops-pattern`、`ops-mask`）均为纯 Rust 库，零 N-API 运行时依赖；
   - 仅外层 `auto-refactor-core` 依赖 `napi`，作为胶水门面编译为 `index.node`。
3. **双轨容灾与 100% 字节等价性 (Dual-Track Parity)**：
   - 必须保留 `src/core/native/native-bridge.ts` 中的 `PureJsNativeShim`；
   - 算子库暴露的任何方法均在 Shim 中提供纯 TypeScript/JavaScript 的等价实现；
   - 在缺失编译二进制的环境中自动平滑降级，测试套件 100% PASS。

---

## 二、 工作区拓扑 (Cargo Workspace Topology)

```text
crates/
├── Cargo.toml                       # [Workspace 根配置] 统一成员与编译 Profile
├── .cargo/config.toml               # [MinGW 链接器配置] 锁定 x86_64-pc-windows-gnu
├── .gitignore                       # 忽略 target/ 编译产物
├── auto-refactor-core/              # [N-API 汇聚门面]
│   ├── Cargo.toml                   # 声明对各子 Crate 的 path 依赖与 cdylib 类型
│   ├── index.node                   # 最终编译部署的原生二进制动态库
│   └── src/lib.rs                   # 汇聚各子算子，对外暴露 napi 函数
├── ops-diff/                        # 【差分算子】Myers & Git 直方图差分
│   ├── Cargo.toml
│   └── src/lib.rs                   # 纯 Rust: run_histogram_diff
├── ops-graph/                       # 【图论算子】Tarjan SCC 强连通分量与拓扑排序
│   ├── Cargo.toml
│   └── src/lib.rs                   # 纯 Rust: run_analyze_dependency_graph
├── ops-pattern/                     # 【扫描算子】极速行级多模式文本搜索
│   ├── Cargo.toml
│   └── src/lib.rs                   # 纯 Rust: run_fast_pattern_match
└── ops-mask/                        # 【脱敏算子】SIMD 源码词法脱敏与行统计
    ├── Cargo.toml                   # 依赖 memchr 2.7
    └── src/lib.rs                   # 纯 Rust: mask_source_code
```

---

## 三、 `ops-mask` SIMD 脱敏算子技术规格

### 1. 算法与优化机制
- **触发字符向量快筛**：基于 `memchr` 单指令扫描当前行是否存在注释前缀（`//`, `#`）、块注释开闭符（`/*`, `<#`）、引号（`'`, `"`, '`'）或正则斜杠（`/`）；无触发字符的纯代码行 2 CPU 周期内直接原样返回。
- **双轨编码对齐**：
  - ASCII 行（占代码 98%+）：在 `&[u8]` 字节切片上就地执行掩码扫描；
  - 非 ASCII 行（含中文注释、多语言 Unicode 标识符）：按 UTF-16 code units 严格对齐，保证脱敏后与 JavaScript `line.split('')` 的字符数与列坐标（Column Index）100% 绝对一致。
- **行状态与正则启发式**：完整支持跨行块注释与跨行模板字面量状态流转，且遵循 C 语言家族正则字面量前缀启发式规则（`opens_regex_literal`）。

### 2. 算子契约
```rust
pub struct MaskConfig {
    pub line_comment: String,
    pub block_comment: Option<(String, String)>,
    pub quote_chars: String,
    pub multiline_templates: bool,
    pub regex_literals: bool,
}

pub struct MaskResult {
    pub raw: Vec<String>,
    pub masked: Vec<String>,
    pub lines: u32,
    pub non_blank_lines: u32,
}

pub fn mask_source_code(content: &str, config: &MaskConfig) -> MaskResult;
```

---

## 四、 构建、验证与持续集成护栏

1. **本地编译构建**：
   ```bash
   npm run build:native
   ```
   由 `scripts/build-native.js` 自动调度 MinGW GCC 链接器完成 Cargo Workspace release 模式编译，并将动态库提取部署至 `crates/auto-refactor-core/index.node`。
2. **纯 Rust 单元测试**：
   ```bash
   cargo test --workspace --exclude auto-refactor-core
   ```
   各独立子算子均具备完全脱离 Node.js 的 Rust 原生测试用例。
3. **双轨等价性端到端验证**：
   ```bash
   node scripts/validate-native-operator.js
   ```
   已集成至 `scripts/test-parallel.js` 全量测试流水线，自动看守多语言矩阵与真实工程文件的 100% 字节等价性。
