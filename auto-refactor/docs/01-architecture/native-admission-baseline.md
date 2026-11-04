# 原生算子准入基线（Native Operator Admission Baseline）

> 本文件是 `validate-native-admission.js` 的数据契约。每条记录声明一个算子「值得原生化」的前提与实测证据。
> 门禁读取本表并实测；任何一项长期不达标，即视为该算子不应继续留在原生路径。

## 为什么需要基线

实测结论（数据取自 `validate-native-admission.js` 与 `validate-native-operator.js`）：Rust 并不总是更快。

| 场景 | Rust / shim | 结论 |
| :--- | ---: | :--- |
| 数组型（`Vec<f64>` 逐次跨边界） | 1.8 ~ 5.4 | Rust 更慢 |
| 逐行拼装记录（与手写逐字符循环比较） | 0.10 | 该对照组本身是坏基线 |
| 整块 SWAR（一次性传缓冲） | 0.55 ~ 0.65 | Rust 快约 1.5~1.8× |
| 存在性判定（`contains` 提前返回） | 0.16 | Rust 快约 6× |

决定因素是**数据传递形态**，不是语言。因此需要一个门禁把「准入条件」写成可执行的断言，而不是靠直觉。

## 准入条件（三条，必须同时满足）

1. **整块传递**：一次调用处理整个缓冲或整批数据，不做逐行/逐元素回调。
2. **工作量远超边界成本**：单次工作量须显著大于实测的约 `1.7 µs` 跨边界固定成本。
3. **加速比有正收益**：实测 Rust 相对 shim 的耗时比 `< 1.0`（即 Rust 更快）。

任一条不满足时，算子应留在 TS 或退回 shim，并在下表中记录原因。

## 基线表

字段说明：`name` 为算子名；`minSpeedup` 为要求的最小加速比（**Rust 耗时 / shim 耗时**，须 ≤ 该值，越小越严）；
`payload` 为测试负载构造方式；`status` 取 `enforced`（强制看守）或 `documented`（仅记录，不阻断，用于已知
不适用的场景）；`rationale` 为纳入理由。

下表数值由 `validate-native-admission.js` 在本机实测后填入，取多轮最佳值。

| name | minSpeedup | payload | status | rationale |
| :--- | ---: | :--- | :--- | :--- |
| `countBracesDetailed` | 0.80 | 512 KB 源码 | enforced | 整块 SWAR 扫描；实测 Rust 快约 1.5~1.8 倍，基线留余量 |
| `fastPatternMatch` | 0.35 | 256 KB 源码，8 个安全 token | enforced | 实测 Rust 快约 6~7.7 倍；shim 逐行拼装记录，原生整块扫描优势明显 |
| `hasAnyPattern` | 1.00 | 256 KB 源码，安全 token | enforced | 存在性判定提前返回；实测 0.4~0.8，波动来自 shim 的逐行缓存行为，故基线取 1.00 表示「不得慢于 shim」 |
| `computeStatisticalMoments` | 1.20 | 2,000 个数值 | documented | `Vec<f64>` 逐次复制，实测 Rust 慢 1.8~5.4 倍，**不应迁往原生** |
| `computeShannonEntropy` | 0.50 | 64 KB 文本 | documented | 单次字符串；实测 Rust 快约 7.7 倍，但调用频次低，暂不看守 |

> [!IMPORTANT]
> `minSpeedup` 是「上限」而非「下限」：它是 `Rust / shim` 的比值，因此 **数值越小要求越严**。
> 若某算子实测比值上升（Rust 变慢），说明原生路径的收益正在消失，应评估退回 shim。

## 实测偏差记录

首版本表曾把 `fastPatternMatch` 标为 `documented`（预期 Rust 慢）并把 `countBracesDetailed` 的基线设为 `0.50`。
实测推翻了这两处：

- `fastPatternMatch` 在 256 KB 语料上 Rust 比 shim 快 6~7.7 倍 —— 先前「逐行 Rust 慢 10 倍」的结论，
  对比对象是**手写 JS 逐字符循环**，而 shim 的真实实现是逐行 `indexOf`，两者不可等同。
- `countBracesDetailed` 实测 0.55~0.65，而非早期与逐字符循环对比得到的 0.16。

教训：**基准必须与产品的真实对照实现比较**，不能与随手写的基线比较。

## 维护约定

- 新增原生算子前，先在本表加一行并给出负载构造方式；`enforced` 项必须实测达标。
- 调整 `minSpeedup` 需同时说明为何原值不再适用，不得仅为让门禁通过而下调。
- `documented` 项若实测 Rust 已明显更快，应升级为 `enforced`，反之亦然。
