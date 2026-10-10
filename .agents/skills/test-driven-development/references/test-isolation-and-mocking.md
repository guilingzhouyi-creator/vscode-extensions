# 测试隔离与 Mocking 通用工程指南

## 一、 单元测试与集成测试的分层
1. **单元测试 (Unit Tests)**：
   - 目标：验证单个函数、类或纯算法逻辑；
   - 速度：单个测试执行时间在毫秒级别；
   - 依赖：100% 内存化，零真实网络/文件/外部环境依赖。
2. **集成测试 (Integration Tests)**：
   - 目标：验证多个组件组合、真实数据库或中间件协作；
   - 频率：在构建阶段或特定全量门禁中运行。

## 二、 常用桩实现范式

### 1. 内存存储桩 (In-Memory Storage Stub)
```typescript
export class InMemoryStore<T> {
  private readonly map = new Map<string, T>();
  get(key: string): T | undefined { return this.map.get(key); }
  set(key: string, value: T): void { this.map.set(key, value); }
  clear(): void { this.map.clear(); }
}
```

### 2. 确定性时钟桩 (Deterministic Clock)
提供手动拨动时间轴的时钟接口，使超时逻辑、心跳检测与时间聚合算法能够在可控时间轴下被稳定复现。
