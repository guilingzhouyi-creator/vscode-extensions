# Rust 工业级高级系统工程深水区实战图谱

本指南深入拆解全工作区 Rust 系统级工程落地中的五大深水区技术：编译期状态机（Type-State）、零瞬态堆分配复用池、边界检查消除（BCE）、并发无锁 CAS 内存序以及 FFI 异常故障隔离。

---

## 一、 Type-State 模式：将状态图编译进类型系统

### 1.1 核心思想
传统的状态机使用运行时 `enum State` 配合 `match` 判断，容易因疏漏导致非法调用（例如在未暂存状态下直接提交）。
Type-State 模式利用 Rust 的泛型参数与零大小类型（ZST, Zero-Sized Types），将状态机的合法迁移完全交由编译器静态判定：

```rust
use std::marker::PhantomData;

// 定义状态标记 Trait 与零大小状态实体
pub trait WorktreeState {}
pub struct Uninitialized;
pub struct Clean;
pub struct Staged;

impl WorktreeState for Uninitialized {}
impl WorktreeState for Clean {}
impl WorktreeState for Staged {}

// 实体结构体持有泛型状态标记
pub struct Worktree<S: WorktreeState> {
    id: u64,
    root_path: String,
    _state: PhantomData<S>,
}

// 仅在 Uninitialized 状态下允许 initialize
impl Worktree<Uninitialized> {
    pub fn new(id: u64, root_path: String) -> Self {
        Self {
            id,
            root_path,
            _state: PhantomData,
        }
    }

    pub fn initialize(self) -> Result<Worktree<Clean>, WorktreeError> {
        // 执行底层初始化逻辑...
        Ok(Worktree {
            id: self.id,
            root_path: self.root_path,
            _state: PhantomData,
        })
    }
}

// 仅在 Clean 状态下允许 stage
impl Worktree<Clean> {
    pub fn stage_file(self, path: &str) -> Worktree<Staged> {
        // 执行暂存逻辑...
        Worktree {
            id: self.id,
            root_path: self.root_path,
            _state: PhantomData,
        }
    }
}

// 仅在 Staged 状态下允许 commit
impl Worktree<Staged> {
    pub fn commit(self, message: &str) -> Result<Worktree<Clean>, WorktreeError> {
        // 执行提交逻辑...
        Ok(Worktree {
            id: self.id,
            root_path: self.root_path,
            _state: PhantomData,
        })
    }
}
```

### 1.2 零成本保证 (Zero-Cost Guarantee)
- `PhantomData<S>` 在编译期被完全擦除，不占用任何运行时堆栈字节；
- 状态迁移方法通过消耗 `self`（按值传递）获取所有权，调用后旧状态变量立即失效，在编译期杜绝使用已迁移状态（Use-After-Move）。

---

## 二、 零瞬态堆分配复用池与 RAII 借用守卫 (`FGT-PRF-001`)

在分形 Git 与高性能词法分析等热路径中，严禁在紧凑循环内频繁触发系统分配器（`malloc/free`）。

### 2.1 RAII Guard 自动归还机制
通过自定义 `Deref` / `DerefMut` 与 `Drop` 实现借用守卫，确保调用方在离开作用域时无论正常返回还是发生分支跳转，缓冲区均自动被清空并返还池中：

```rust
use std::sync::{Arc, Mutex};

pub struct BufferPool {
    pool: Mutex<Vec<Vec<u8>>>,
    default_capacity: usize,
}

pub struct PooledBuffer<'a> {
    buf: Option<Vec<u8>>,
    pool: &'a BufferPool,
}

impl BufferPool {
    pub fn new(default_capacity: usize) -> Self {
        Self {
            pool: Mutex::new(Vec::with_capacity(32)),
            default_capacity,
        }
    }

    pub fn acquire(&self) -> PooledBuffer {
        let buf = self.pool.lock().ok().and_then(|mut p| p.pop())
            .unwrap_or_else(|| Vec::with_capacity(self.default_capacity));
        PooledBuffer {
            buf: Some(buf),
            pool: self,
        }
    }

    fn release(&self, mut buf: Vec<u8>) {
        buf.clear(); // 清空内容但保留堆容量
        if let Ok(mut p) = self.pool.lock() {
            if p.len() < 64 { // 防止过度膨胀
                p.push(buf);
            }
        }
    }
}

impl<'a> std::ops::Deref for PooledBuffer<'a> {
    type Target = Vec<u8>;
    fn deref(&self) -> &Self::Target {
        self.buf.as_ref().unwrap()
    }
}

impl<'a> std::ops::DerefMut for PooledBuffer<'a> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.buf.as_mut().unwrap()
    }
}

impl<'a> Drop for PooledBuffer<'a> {
    fn drop(&mut self) {
        if let Some(buf) = self.buf.take() {
            self.pool.release(buf);
        }
    }
}
```

---

## 三、 边界检查消除 (BCE) 与 SWAR 位级并行技巧

### 3.1 边界检查消除 (Bounds Check Elimination)
Rust 在直接使用 `slice[i]` 时会在汇编层面生成额外的边界检查与 panic 分支。在极端性能关键的热路径中，指导编译器消除冗余检查：

1. **切片迭代器优先**：使用 `for &byte in bytes` 或 `iter()`，LLVM 会自动生成零边界检查的向量化汇编；
2. **前置切片断言 (Slicing Assertion)**：
   ```rust
   pub fn parse_header(data: &[u8]) -> Option<(u32, u32)> {
       if data.len() < 8 {
           return None;
       }
       // 告诉编译器后续 [0..8] 的索引绝对安全
       let slice = &data[..8];
       let a = u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]);
       let b = u32::from_le_bytes([slice[4], slice[5], slice[6], slice[7]]);
       Some((a, b))
   }
   ```

### 3.2 SWAR 64-bit 字节级无分支扫描
在 Myers Diff 或源码脱敏扫描中，单指令扫描 8 字节是否包含特定分隔符（如换行符 `\n` 即 `0x0A`）：

```rust
#[inline(always)]
pub fn has_byte_swar(chunk: u64, target: u8) -> bool {
    let mask = 0x0101_0101_0101_0101u64 * (target as u64);
    let xor = chunk ^ mask;
    // 经典 Alan Mycroft 位运算技巧: 判断 xor 中是否存在 0 字节
    (xor.wrapping_sub(0x0101_0101_0101_0101u64) & !xor & 0x8080_8080_8080_8080u64) != 0
}
```

---

## 四、 并发无锁控制与原子内存序 (`FGT-LCK-001`)

在构建无锁树或 CAS 暂存区时，合理使用最弱而安全的原子内存序，避免全局总线锁死：

| 内存序 (`Ordering`) | 适用场景 | 硬件行为与约束 |
| :--- | :--- | :--- |
| **`Relaxed`** | 纯计数器自增、指标统计 | 仅保证原子性，不提供任何跨指令重排同步保证 |
| **`Acquire`** | 读操作（加锁检查、读取状态） | 确保该读操作之后的读写指令绝对不会被重排到该操作之前 |
| **`Release`** | 写操作（发布数据、解锁） | 确保该写操作之前的所有数据准备工作绝对不会被重排到发布之后 |
| **`AcqRel`** | 读-改-写原子操作（CAS、Swap） | 同时具备 Acquire 与 Release 语义，建立双向内存同步栅栏 |
| **`SeqCst`** | 严格全局顺序一致性 | 全局内存屏障，开销最高，仅在多变量协同拓扑中必要时使用 |

### 4.1 CAS 快照置换范式
```rust
use std::sync::atomic::{AtomicPtr, Ordering};

pub struct LocklessCasTree<T> {
    root: AtomicPtr<T>,
}

impl<T> LocklessCasTree<T> {
    pub fn swap_root(&self, old_ptr: *mut T, new_ptr: *mut T) -> bool {
        self.root.compare_exchange(
            old_ptr,
            new_ptr,
            Ordering::AcqRel,
            Ordering::Acquire,
        ).is_ok()
    }
}
```

---

## 五、 FFI / C-ABI / N-API 跨边界安全与 `catch_unwind` 隔离

Rust 允许发生 panic，但当 panic 跨越 `extern "C"` 或 N-API 动态库导出边界时，会导致未定义行为（Undefined Behavior, UB）或直接引发进程异常终止。

### 5.1 边界防御模板
```rust
use std::panic::catch_unwind;

#[no_mangle]
pub extern "C" fn taxis_compute_diff(
    input_ptr: *const u8,
    len: usize,
    out_status: *mut i32,
) -> i32 {
    let result = catch_unwind(|| {
        if input_ptr.is_null() {
            return -1;
        }
        // SAFETY: input_ptr 已经经过非空校验，len 属于外部传入的有效切片长度
        let slice = unsafe { std::slice::from_raw_parts(input_ptr, len) };
        // 执行实际计算...
        0
    });

    match result {
        Ok(code) => code,
        Err(_panic_err) => {
            // 捕获 panic，记录错误并返回专用错误码，严防进程崩溃
            if !out_status.is_null() {
                // SAFETY: out_status 非空且指向单整数指针
                unsafe { *out_status = -999; }
            }
            -999
        }
    }
}
```
