# 控制流平铺与认知降维实战模式参考指南

本指南收录了工作区降低圈复杂度（$\text{CC} \le 15$）与消除深层缩进（$\text{Depth} \le 4$, `CPX-NEST-001`）的具体代码重构模式与前后对比实现。

---

## 一、 卫语句提前返回 (Guard Clauses)

### 1. 核心原则
将先验断言、参数校验与异常分支置于函数顶部提前退出，确保主干逻辑保持在 0~1 级缩进。

### 2. 重构前后对比

#### ❌ 错误示范：深层嵌套箭头反模式 (Depth = 4, CC = 6)
```typescript
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
```

#### ✅ 正确示范：卫语句提前返回 + 循环内早跳 (Depth = 2, CC = 4)
```typescript
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

---

## 二、 复杂数据管道与日志解析解耦

### 1. 核心原则
在处理包含 JSON 序列化、多格式容错与异常捕获的流式数据解析时，**严禁在主循环中内联 `try-catch` 和多重字段判断**。应将解析抽象为独立的无副作用纯函数。

### 2. 独立解析函数与扁平主循环模式
```typescript
interface TrajectoryStep {
  readonly stepIndex: number;
  readonly type: string;
  readonly content: string;
}

// 独立解析纯函数：聚焦单行解析，全量应用卫语句，Depth <= 2
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

// 主流转循环：零深度嵌套，线性平铺消费
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

---

## 三、 策略映射表替代级联分支 (Strategy Map Dispatch)

### 1. 核心原则
当分支属于命令分发、事件路由或类型转换时，使用顶层不可变字典或 `Map` 替代庞大的 `switch-case` 或 `if-else` 阶梯，将圈复杂度从 $\mathcal{O}(N)$ 降至 $\mathcal{O}(1)$。

### 2. 实战模式
```typescript
type CommandHandler = (payload: unknown) => void;

const HANDLER_REGISTRY: Readonly<Record<string, CommandHandler>> = Object.freeze({
  INIT: (payload) => handleInit(payload),
  SYNC: (payload) => handleSync(payload),
  DISPOSE: (payload) => handleDispose(payload),
});

export function dispatchCommand(commandType: string, payload: unknown): void {
  const handler = HANDLER_REGISTRY[commandType];
  if (!handler) {
    handleUnknownCommand(commandType);
    return;
  }
  handler(payload);
}
```
