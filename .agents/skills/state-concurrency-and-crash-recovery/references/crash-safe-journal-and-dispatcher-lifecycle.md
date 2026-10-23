# 崩溃安全原子落盘、幂等日志回放与异步派发器排空协议深水区指南

本指南阐述跨项目通用的崩溃安全持久化（Staging + Atomic Rename + Append-Only Journal）与并发派发器排空生命周期（`pump / flush / teardown`）设计细节。

---

## 一、 暂存分流与原子落盘四步状态机 (`FGT-STO-001` / `DAT-RES-001`)

直接执行 `fs.writeFile(targetPath, data)` 包含 `open(O_TRUNC)` 与多次 `write()` 系统调用：一旦在 `O_TRUNC` 后进程被强杀或断电，`targetPath` 即变为 0 字节损坏文件。标准四步原子落盘流程如下：

```text
[内存状态序列化 payload]
       │
       ▼ (1) 写入同目录独立暂存路径 (stagingPath / compactStagingPath)
[stagingPath: 完整写入并校验 byteLength > 0 & Checksum]
       │
       ▼ (2) 校验失败则清理 stagingPath 并保留原 targetPath 不变
       │
       ▼ (3) POSIX/NTFS 同卷原子 rename(stagingPath -> targetPath)
[targetPath: 瞬时切换至新快照，零半写窗口]
```

- **同卷约束**：`stagingPath` 必须与 `targetPath` 位于同一物理目录或同一挂载卷下，禁止跨盘符 `rename`（跨卷会退化为非原子的拷贝+删除）。

---

## 二、 RingBuffer + Journal 幂等崩溃回放模型 (`UUID-REENTRANT-001`)

1. **写入路径（Write-Ahead / Dual-Write）**：
   每次状态变更携带单调递增序列号 `seqId`（或确定性 `checkpointId`）：
   - 先追加一行紧凑 NDJSON 记录至 `journalPath`；
   - 再更新内存定长 `RingBuffer`（固定槽位 $N$，通过 `writeCursor = (writeCursor + 1) % capacity` $O(1)$ 写入，零数组扩容分配）。
2. **重放路径（Idempotent Replay）**：
   启动恢复时读取快照基线 `lastCommittedSeqId`，流式扫描 Journal：
   - 若记录 `entry.seqId <= lastCommittedSeqId`，作为已提交历史幂等跳过；
   - 若单行尾部因崩溃半写导致 JSON 解析失败，忽略该残缺尾行并记录诊断告警，绝不中断前序有效记录的恢复。
3. **封账截断（Checkpoint Compaction）**：
   当快照经原子落盘成功后，重置 Journal，防止日志文件无界膨胀（`VSC-MEM-001`）。

---

## 三、 异步派发器排空与无头测试防死锁契约 (`ADV-EVT-001` / `PRF-LEAK-001`)

任何持有后台队列、Worker 线程或定时刷盘任务的协调器，必须实现三阶生命周期状态（`Active -> Draining -> Terminated`）与三个标准管理方法：

1. **`pump(): number`**：在单线程/确定性测试中同步消费当前队列中所有就绪任务并返回处理条数，零异步等待；
2. **`flush(): Promise<void>`**：进入 `Draining` 态，等待所有在途异步 I/O 或 Worker 任务执行完毕并清空队列；
3. **`teardown(): Promise<void>`**：先执行 `flush()`，随后解绑全部事件监听器（`off`）、清理定时器（`clearInterval`）并将状态锁死为 `Terminated`，后续任何 `dispatch()` 立即返回显式拒绝结果。
