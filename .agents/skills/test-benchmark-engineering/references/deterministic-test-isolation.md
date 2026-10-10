# 确定性测试隔离与时钟/RNG 虚拟化指南 (Deterministic Test Isolation Guide)

本指南规范了工作区各子系统单元测试与集成测试中的环境隔离标准，确保自动化测试具备 100% 确定性（Determinism）、零偶发失败（Flakiness）与无副作用清理。

---

## 一、 时钟虚拟化与固定时间注入 (`withFixedNow`)

### 1. 真实系统时钟的危害
直接在业务代码或测试断言中读取 `Date.now()`、`new Date()` 或 `performance.now()` 会导致：
- **跨午夜/跨时区竞态**：在 UTC 23:59:59 附近运行测试可能偶发跨天，导致切分逻辑断言失败；
- **执行延迟抖动**：因机器负载差异，执行时长在 10ms 与 100ms 间波动，导致绝对耗时断言偶发失败。

### 2. 标准注入范式
所有涉及时间计算的模块必须支持时间抽象注入或通过上下文包裹函数执行：

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

在测试中通过 `withFixedNow(1700000000000, async () => { ... })` 锁定离散时间基准点，断言输出具有数学级确定性。

---

## 二、 伪随机数种子隔离 (PRNG Seed Isolation)

在涉及游戏逻辑、蒙特卡洛抽样或随机测试用例生成的场景下：
- **严禁**：裸调用无种子的 `Math.random()`；
- **必须**：引入可重现的伪随机数发生器（如 XorShift128+ 或 Mulberry32），在测试套件头部固定初始化 Seed：
  ```typescript
  function mulberry32(seed: number) {
    return function() {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  ```

---

## 三、 文件系统与进程沙箱清理契约

1. **独占临时工作目录**：
   测试产生的所有临时文件、快照或测试数据库必须建立在带随机后缀的独立临时目录（如 `os.tmpdir()/test-<uuid>/`）；
2. **两阶段资源清理保证**：
   无论测试成功与否，必须在 `afterEach` 或 `try ... finally` 中物理清理临时文件与监听器，严禁污染源码树或系统临时目录。

