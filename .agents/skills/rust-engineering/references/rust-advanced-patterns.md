# Rust 工业级高级系统工程深水区实战图谱

本指南深入拆解全工作区 Rust 系统级工程落地的六大深水区技术：编译期状态机与封闭特征（Type-State + Sealed Trait + Newtype）、`RSM-*` 现代控制流与借用惯用法、零瞬态堆分配 RAII 复用池、边界检查消除（BCE）与 SWAR 位并行、无锁 CAS 内存序以及 FFI `catch_unwind` 异常隔离。

---

## 一、 Type-State + Sealed Trait + Newtype：编译期状态闭合 (`FGT-COR-001` / `FGT-TRN-001`)

### 1.1 `#[repr(transparent)]` Newtype 与 Sealed Trait 封闭状态集
为防止外部模块伪造状态标记或混淆同底层类型的不同领域 ID（如 `CellId` 与 `SlotId`），资深 Rust 设计强制结合透明 Newtype 与私有 `Sealed` 超特征：

```rust
use std::marker::PhantomData;

/// 零运行时开销的透明领域标识 Newtype，杜绝 u64 原始类型混用
#[repr(transparent)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CellId(u64);

impl CellId {
    #[must_use]
    pub const fn new(raw: u64) -> Self {
        Self(raw)
    }
}

mod private {
    pub trait Sealed {}
}

/// 封闭状态特征：外部 crate 无法实现非法状态扩展
pub trait WorktreeState: private::Sealed {}

pub struct Uninitialized;
pub struct Clean;
pub struct Staged;

impl private::Sealed for Uninitialized {}
impl private::Sealed for Clean {}
impl private::Sealed for Staged {}
impl WorktreeState for Uninitialized {}
impl WorktreeState for Clean {}
impl WorktreeState for Staged {}

#[must_use = "Worktree state machine must be driven to completion or explicitly dropped"]
pub struct Worktree<S: WorktreeState> {
    cell_id: CellId,
    root_path: String,
    _state: PhantomData<S>,
}

impl Worktree<Uninitialized> {
    pub fn initialize(self) -> Result<Worktree<Clean>, WorktreeError> {
        Ok(Worktree {
            cell_id: self.cell_id,
            root_path: self.root_path,
            _state: PhantomData,
        })
    }
}

impl Worktree<Clean> {
    pub fn stage_file(self, rel_path: &str) -> Worktree<Staged> {
        let _ = rel_path;
        Worktree {
            cell_id: self.cell_id,
            root_path: self.root_path,
            _state: PhantomData,
        }
    }
}
```

---

## 二、 `RSM-*` 现代 Rust 资深写法对照矩阵

| 规则 ID | 反模式（禁止） | 资深标准写法（强制） |
| :--- | :--- | :--- |
| **`RSM-ELSE-001`** | `let x = match opt { Some(v) => v, None => return Err(e) };` 或深层 `if let` | `let Some(x) = opt else { return Err(e); };` 卫语句平铺解构 |
| **`RSM-STR-001`** | `pub fn parse(input: &String, items: &Vec<u8>)` | `pub fn parse(input: &str, items: &[u8])` 切片借用优先 |
| **`RSM-CLONE-001`** | `if a.clone() == b` 或 `vec.clone().len()` | `if a == b` 或 `vec.len()`；按需写时拷贝用 `Cow<'_, str>` |
| **`RSM-FIND-001`** | 手写 `for item in list { if pred(item) { return Some(item); } }` | `list.iter().find(|item| pred(item))` 迭代器组合子 |
| **`RSM-FORMAT-001`** | `format!("{}:{}", cell_id, agent_uid)` | `format!("{cell_id}:{agent_uid}")` 内联变量捕获 |
| **`RSM-CAST-001`** | `let len32 = total_len as u32;`（静默截断隐患） | `let len32 = u32::try_from(total_len).map_err(...)?;` |
| **`RSM-LOCK-001`** | 在 `async fn` 中持 `MutexGuard` 跨越 `.await` | `{ let guard = mu.lock(); ... } fut.await` 块内提前释放 |
| **`STDLIB-CONST-001`** | 用 `==` 短路比对安全令牌或 MAC 摘要 | 固定长度字节逐位异或累加 `fold(0u8, \|acc, (a, b)\| acc \| (a ^ b)) == 0` |

---

## 三、 零瞬态堆分配复用池与 RAII 借用守卫 (`FGT-PRF-001` / `FGT-POL-001`)

通过自定义 `Deref` 与 `Drop` 实现借用守卫，确保调用方离开作用域时无论正常返回还是 `?` 提前跳转，缓冲区均自动执行 `buf.clear()` 保留堆容量并归还池中：

```rust
use std::ops::Deref;
use std::sync::Mutex;

pub struct BufferPool {
    pool: Mutex<Vec<Vec<u8>>>,
    default_capacity: usize,
}

pub struct PooledBuffer<'a> {
    buf: Option<Vec<u8>>,
    pool: &'a BufferPool,
}

impl BufferPool {
    #[must_use]
    pub fn new(default_capacity: usize) -> Self {
        Self {
            pool: Mutex::new(Vec::with_capacity(32)),
            default_capacity,
        }
    }

    pub fn acquire(&self) -> PooledBuffer<'_> {
        let buf = self
            .pool
            .lock()
            .ok()
            .and_then(|mut guard| guard.pop())
            .unwrap_or_else(|| Vec::with_capacity(self.default_capacity));
        PooledBuffer {
            buf: Some(buf),
            pool: self,
        }
    }

    fn release(&self, mut buf: Vec<u8>) {
        buf.clear();
        if let Ok(mut guard) = self.pool.lock() {
            if guard.len() < 64 {
                guard.push(buf);
            }
        }
    }
}

impl Deref for PooledBuffer<'_> {
    type Target = [u8];
    fn deref(&self) -> &Self::Target {
        self.buf.as_deref().unwrap_or(&[])
    }
}

impl PooledBuffer<'_> {
    pub fn buffer_mut(&mut self) -> Option<&mut Vec<u8>> {
        self.buf.as_mut()
    }
}

impl Drop for PooledBuffer<'_> {
    fn drop(&mut self) {
        if let Some(buf) = self.buf.take() {
            self.pool.release(buf);
        }
    }
}
```

---

## 四、 边界检查消除 (BCE) 与 SWAR 64-bit 位级并行

1. **前置切片断言消除边界检查（BCE）**：
   ```rust
   #[must_use]
   pub fn parse_header(bytes: &[u8]) -> Option<(u32, u32)> {
       let header = bytes.get(..8)?;
       let magic = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
       let version = u32::from_be_bytes([header[4], header[5], header[6], header[7]]);
       Some((magic, version))
   }
   ```
2. **SWAR 单指令 8 字节定界符扫描**：
   ```rust
   #[inline(always)]
   #[must_use]
   pub const fn has_byte_swar(chunk: u64, target: u8) -> bool {
       let mask = 0x0101_0101_0101_0101_u64 * (target as u64);
       let xor = chunk ^ mask;
       (xor.wrapping_sub(0x0101_0101_0101_0101_u64) & !xor & 0x8080_8080_8080_8080_u64) != 0
   }
   ```

---

## 五、 无锁 CAS 内存序与 FFI `catch_unwind` 边界隔离 (`FGT-LCK-001` / `FGT-SAF-001`)

1. **原子内存序最小够用原则**：
   - 纯统计计数用 `Ordering::Relaxed`；快照读取用 `Ordering::Acquire`；快照发布用 `Ordering::Release`；CAS 世代晋升用 `compare_exchange(..., Ordering::AcqRel, Ordering::Acquire)`。
2. **FFI / C-ABI / N-API 零 Panic 跨越契约**：
   - 任何 `extern "C"` 或 N-API 导出函数必须以 `std::panic::catch_unwind` 包裹顶层逻辑，并在每个裸指针 `from_raw_parts` 前完成非空、对齐與长度上限校验，严禁未定义行为（UB）跨边界逃逸。
