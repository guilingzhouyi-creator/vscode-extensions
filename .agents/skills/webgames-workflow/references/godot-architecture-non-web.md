# Godot 4.7 Three-Layer Decoupling & Zero-Alloc Object Pooling (`ADV-PRF-002`)

Strict non-Web engine stack constraints and zero-allocation pool rules for `WebGames/`.

---

## 1. Non-Web Red Line & Three-Layer Unidirectional Topology

`WebGames/` targets desktop and headless **Godot 4.7 / GDScript** exclusively; forbid DOM, HTML, CSS, Web APIs, or JS/TS runtime dependencies:

```text
[Presentation Views: frontend/views/** (Godot Control tree)]
  - Zero domain math/RNG; receives read-only DTOs via apply_snapshot()
        ▲ (unidirectional snapshot injection)
[Headless Domain Core: domains/** (RefCounted solvers & FSMs)]
  - Zero UI node dependencies; headless unit-testable
  - Zero per-frame heap allocs (ADV-PRF-002); pooled reset_state()
        ▲ (GameConfig dot-path reads)
[Single-Source Config: config/domains/<domain>/core.json]
```

---

## 2. Pooled Frame Loops & Symmetric `reset_state()` (`ADV-PRF-002`)

Never call `.new()` per frame inside `_process` / `_physics_process` or combat ticks:
1. Pre-allocate fixed-capacity pools for projectiles, floating numbers, and event payloads.
2. Reset all fields cleanly on `acquire()` and `release()` via `reset_state() -> void`.
3. Reuse caller-supplied pre-allocated `Dictionary`/`Array` buffers across high-frequency calls instead of allocating transient return objects.

```gdscript
class_name PooledBullet
extends RefCounted

var position: Vector2 = Vector2.ZERO
var damage: int = 0
var is_active: bool = false

func reset_state() -> void:
    position = Vector2.ZERO
    damage = 0
    is_active = false
```
