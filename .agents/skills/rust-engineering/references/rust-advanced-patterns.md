# Advanced Industrial Rust Engineering Patterns

Deep patterns for compile-time state closure, `RSM-*` idioms, RAII buffer pools, bounds-check elimination (BCE), SWAR scanning, lock-free CAS ordering, and `catch_unwind` FFI boundaries.

---

## 1. Type-State + Sealed Trait + Newtype (`FGT-COR-001` / `FGT-TRN-001`)

Prevent cross-domain ID confusion and invalid state forgery via `#[repr(transparent)]` newtypes paired with a private `Sealed` supertrait and `#[must_use]` Type-State structs:

```rust
use std::marker::PhantomData;

#[repr(transparent)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CellId(u64);

mod private { pub trait Sealed {} }
pub trait WorktreeState: private::Sealed {}
pub struct Uninitialized;
pub struct Clean;
impl private::Sealed for Uninitialized {}
impl private::Sealed for Clean {}
impl WorktreeState for Uninitialized {}
impl WorktreeState for Clean {}

#[must_use = "Worktree must transition to Clean or drop explicitly"]
pub struct Worktree<S: WorktreeState> {
    cell_id: CellId,
    _state: PhantomData<S>,
}
```

---

## 2. `RSM-*` Modern Idioms Matrix

| Rule ID | Forbidden Anti-Pattern | Mandatory Idiomatic Form |
| :--- | :--- | :--- |
| **`RSM-ELSE-001`** | `let x = match opt { Some(v) => v, None => return Err(e) };` | `let Some(x) = opt else { return Err(e); };` guard let-else |
| **`RSM-STR-001`** | `pub fn parse(input: &String, items: &Vec<u8>)` | `pub fn parse(input: &str, items: &[u8])` slice borrows |
| **`RSM-CLONE-001`** | `if a.clone() == b` or `vec.clone().len()` | `if a == b`, `vec.len()`, or `Cow<'_, str>` |
| **`RSM-FIND-001`** | Manual `for` search loop returning `Some(item)` | `list.iter().find(|item| pred(item))` |
| **`RSM-FORMAT-001`** | `format!("{}:{}", cell_id, agent_uid)` | `format!("{cell_id}:{agent_uid}")` inline captures |
| **`RSM-CAST-001`** | `let len32 = total_len as u32;` silent truncation | `u32::try_from(total_len).map_err(...)?` |
| **`RSM-LOCK-001`** | Holding `MutexGuard` across `.await` | Drop guard in tight block before `.await` |
| **`STDLIB-CONST-001`** | Short-circuit `==` on tokens/HMACs | Constant-time XOR fold `.fold(0u8, \|a, (x, y)\| a \| (x ^ y)) == 0` |

---

## 3. RAII Buffer Reuse Pool (`FGT-PRF-001` / `FGT-POL-001`)

Guard pooled `Vec<u8>` buffers with a custom `Drop` handle that clears length (`buf.clear()`, retaining capacity) and returns up to a bounded pool cap (e.g. `64` buffers) on normal return or early `?`.

---

## 4. Bounds-Check Elimination (BCE) & 64-Bit SWAR

- **BCE**: Slice once up front (`let h = bytes.get(..8)?;`) so fixed offsets `h[0..7]` elide repeat bounds checks.
- **SWAR**: Scan 8 ASCII bytes per instruction via `(xor.wrapping_sub(0x0101_0101_0101_0101) & !xor & 0x8080_8080_8080_8080) != 0`.

---

## 5. Lock-Free Ordering, Minimal `unsafe` & FFI (`FGT-LCK-001` / `FGT-SAF-001`)

1. **Minimal Ordering**: Counters use `Relaxed`; loads `Acquire`; stores `Release`; CAS epoch promotion `compare_exchange(..., AcqRel, Acquire)`.
2. **3-Part `// SAFETY:` Contract**: Every `unsafe` block must document (a) pointer/slice validity & non-null invariants, (b) alignment/lifetime bounds tied to caller guarantees, and (c) aliasing exclusivity / bounds check proof.
3. **FFI / N-API Guard**: Wrap `extern "C"` / N-API entrypoints with `std::panic::catch_unwind`, validate raw slice bounds before `from_raw_parts`, and pass `cargo clippy --all-targets -- -D warnings`.
