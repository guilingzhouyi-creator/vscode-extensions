# 确定性测试隔离、内存桩与耗时基准棘轮 (`TB-REGRESSION`) 深度指南

本指南规范了工作区单元测试与集成测试中的时钟/随机数虚拟化、内存存储桩隔离以及测试耗时单调棘轮（`TB-REGRESSION`）防回归机制。

---

## 一、 时钟虚拟化 (`withFixedNow`) 与伪随机种子隔离 (Mulberry32)

1. **固定时间注入（消除跨午夜与负载抖动）**：
   ```typescript
   export async function withFixedNow<T>(
     fixedTimestampMs: number,
     fn: () => Promise<T> | T,
   ): Promise<T> {
     const originalNow = Date.now;
     try {
       Date.now = () => fixedTimestampMs;
       return await fn();
     } finally {
       Date.now = originalNow;
     }
   }
   ```
2. **固定种子 PRNG（严禁裸调 `Math.random()`）**：
   ```typescript
   export function mulberry32(seed: number): () => number {
     return () => {
       let t = (seed += 0x6d2b79f5);
       t = Math.imul(t ^ (t >>> 15), t | 1);
       t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
       return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
     };
   }
   ```
3. **内存存储桩与临时沙箱对称清理**：
   单元测试优先使用 `Map<string, T>` 内存桩替代磁盘 I/O；集成测试必须在 `os.tmpdir()` 下创建带随机后缀的独立沙箱目录，并在 `try ... finally` 或 `afterEach` 中彻底清理文件与事件监听器。

---

## 二、 耗时基准单调棘轮 (`TB-REGRESSION`) 设计原理

1. **分层预算基线**：
   - **纯逻辑单测**：单项执行耗时 $\le 10\text{ms}$；
   - **本地流式门禁**：内存判定约 $1\text{ms}$，端到端（含 Node 启动约 $80\text{ms}$）约 $160\text{ms}$（必须同时报告双口径）；
   - **套件耗时棘轮**：基线快照记录历史耗时，允许 $15\%$ 硬件波动容差（$\le 1.15 \times \text{Baseline}$）；突破阈值即触发 `TB-REGRESSION` 阻断，强制排查未释放定时器或 $O(N^2)$ 退化。
2. **单向棘轮更新**：
   当算子重构使执行耗时显著下降时，同步收紧基线快照，确保性能水位单调不退。
