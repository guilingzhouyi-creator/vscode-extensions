# Control-Flow Flattening & Cognitive Complexity Reduction Patterns

Concrete refactoring patterns keeping per-function cyclomatic complexity $\text{CC} \le 15$ and nesting $\text{Depth} \le 4$ (`CPX-NEST-001`).

---

## 1. Guard Clauses (Early Returns)

Place validation and boundary exits at the top of each function and loop (`continue`) so main control flow remains at indentation depth `0..1`:

```typescript
function processEvent(event: Event): void {
  if (!event.isValid || !event.payload || event.payload.type !== 'DATA') {
    return;
  }
  for (const item of event.payload.items) {
    if (!item.active) continue;
    handleItem(item);
  }
}
```

---

## 2. Isolate Parsing Pipelines From Streaming Loops

Never embed `try-catch` blocks and multi-field validation inside iteration loops; extract pure single-record parsers (`Depth <= 2`):

```typescript
function parseTrajectoryStep(rawLine: string): TrajectoryStep | null {
  const trimmed = rawLine.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.step_index !== 'number' || typeof parsed.type !== 'string') return null;
    return { stepIndex: parsed.step_index, type: parsed.type, content: String(parsed.content ?? '') };
  } catch {
    return null;
  }
}
```

---

## 3. Strategy Map Dispatch ($O(N) \to O(1)$ CC)

Replace cascading `switch-case` or `if-else` command dispatchers with top-level frozen `Record` / `Map` tables:

```typescript
const HANDLER_REGISTRY: Readonly<Record<string, (payload: unknown) => void>> = Object.freeze({
  INIT: (payload) => handleInit(payload),
  SYNC: (payload) => handleSync(payload),
  DISPOSE: (payload) => handleDispose(payload),
});
```
