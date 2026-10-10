# 独占 Zero-Intersection Path Jail 机制与数学正交公理

> **规范地位**：本文件为 `subagent-orchestration` 技能的路径沙箱参考指南，定义多智能体并行写入时的正交隔离规则。

---

## 一、 数学正交公理

当多个具有写权限（`construct` / `refactor`）的 SubAgent 并发作业时，必须满足**独占文件集交集为空**的刚性数学公理：

$$\text{Jail}_A \cap \text{Jail}_B = \emptyset$$

任何两个并行写入专员的文件授权列表严禁存在交集。若存在重叠文件，修改将发生竞态写入与合并冲突，导致构建损坏或架构漂移。

---

## 二、 路径定义粒度规范

1. **只读姿态 (`review` / `explore`)**：
   - 可以在前缀级别（Prefix Level）共享目录范围；
   - 依赖平台级 `enable_write_tools: false` 物理防线，允许多个只读专员并发扫描相同路径。
2. **写入姿态 (`construct` / `refactor`)**：
   - **禁止粗粒度整目录授权**：严禁仅分配 `auto-refactor/` 或 `workspace-timing/` 等顶级前缀；
   - **精确到具名文件列表**：必须在任务外壳中显式列出编号独占文件列表（如专员 A 独占 21 个底层文件，专员 B 独占 25 个上层文件）；
   - **前缀级互斥禁区**：除独占列表外，必须注入其余所有子模块的硬性 `forbiddenPrefixes`。

---

## 三、 跨项目并行隔离模式

当改动横跨不同顶级项目（如同时推进 `auto-refactor` 与 `workspace-timing`）时：
- 推荐使用 `Workspace: "branch"` 创建独立分支沙箱；
- 避免共享未暂存的工作树，防止未提交的临时改动发生跨项目污染。
