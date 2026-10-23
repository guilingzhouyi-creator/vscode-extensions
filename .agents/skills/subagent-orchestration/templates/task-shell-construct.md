# SubAgent 双态任务外壳与可重入会话交接检查点样板

## 一、 写入态（Construct / Refactor）独占文件任务外壳

```markdown
[Task Scope & Zero-Intersection Path Jail]
- 授权独占文件列表（严格两两互斥，仅允许修改以下指定文件）：
  1. <path/to/exclusive_file_1>
  2. <path/to/exclusive_file_2>
- 严禁触碰路径前缀（越界操作立即阻断）：
  - <forbidden/prefix/1/>

[Objective]
<详细说明增量开发或定点重构的具体目标、输入输出契约与设计意图>

[Quality & Discipline Checklist]
1. 物理卫生与复杂度：零 0 字节文件，单函数 CC <= 15、Depth <= 4，双轨体积 ELOC <= 900 / LOC <= 1400；
2. 零分配与门面纪律：循环体零瞬态堆分配 (CPX-SPACE-001 / ADV-PRF-002 / FGT-PRF-001)，消融 <= 3 行跳板 (ARCH-ABS-001)；
3. 六大规范性思维：状态空间闭合、单源双向闭包、反机械应付、负空间污点防御、对称生命周期、可证伪自检探针；
4. 零高危债务红线：保持 High/Critical 债务 0 项基线，引用规则 ID 必须在 rule-catalog.json 真实登记 (RCFG-RULE-DRIFT)。

[Pre-Delivery Verification]
  $ <local_build_and_test_command>
  $ <local_static_guard_command>
```

---

## 二、 只读态（Review / Explore）客观事实任务外壳

```markdown
[Task Scope & Path Jail]
- 授权只读审查范围：<allowed/prefix/1/> (enable_write_tools: false，严禁创建或修改任何文件)

[Objective]
<说明静态审查或拓扑勘测的目标领域与比对基准，要求输出精确 file:line 与已登记规则 ID>
```

---

## 三、 可重入会话与长程分卷交接检查点 (`mark_chapter`)

```markdown
## Chapter <N> Checkpoint: <章节标题>
- **已落盘验证文件**：`<path/to/file1>`, `<path/to/file2>`
- **已通过自检命令与断言**：`<command> -> PASS`
- **下一原子任务与前置不变式**：`<next_module>`（严守 CC <= 15 与循环零分配）
```
