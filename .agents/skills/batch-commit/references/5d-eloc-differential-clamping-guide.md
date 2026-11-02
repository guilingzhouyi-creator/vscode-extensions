# 5D ELOC 差分双向钳制与经验后验最低准入更替规约

> 本文件是 `batch-commit` 技能的深水区技术规范，详述两层解耦差分双向钳制、5D 黎曼有效代码度量（5D ELOC）及自适应最低更替量门槛的数学模型与判定方程。

---

## 一、 第一性原理：杜绝虚假更替与双向钳制必要性

传统 Git 提交与代码审查仅依赖物理行（LOC）判定，极易导致以下反模式：
1. **为了新增而新增**：注入大段无实质逻辑的注释、空行、格式占位或 $\le 3$ 行透传跳板，制造高产出假象；
2. **为了删除而删除**：通过大面积删除功能或文档降低指标，制造高重构率假象；
3. **物理行粗暴重叠**：将单文件体积上限与每批次提交额度简单绑定，导致微观解耦重构时屡屡撞墙或诱发巨石提交。

因此，工作区在底层引擎（`auto-refactor` 与 `fractal-git`）中全面部署**两层解耦 5D ELOC 差分双向钳制体系**。

---

## 二、 五维流形有效代码（5D ELOC）加权模型

对改动中的物理行 $L$，词法与语法分析器提取 5D 黎曼流形相空间坐标：
$$\mathbf{D}(L) = [D_{\text{line}}, D_{\text{col}}, D_{\text{reuse}}, D_{\text{shared}}, D_{\text{payload}}]$$

### 2.1 行类型加权函数 $\omega(L)$
$$\omega(L) = \begin{cases}
0.0, & \text{纯空白行（包含仅含空格、Tab、换行符）} \\
0.0, & \text{纯文档注释（JSDoc } /** \dots */ \text{、Rustdoc } /// \text{、} //! \text{）} \\
0.0, & \text{纯行内注释（} // \text{、} /* \dots */ \text{）} \\
0.0, & \text{纯透传跳板（} \le 3 \text{ 行的转发函数或仅有 return self.xxx() 的样板）} \\
1.0, & \text{实质逻辑有效行（包含控制流、数据运算、类型定义、接口契约）}
\end{cases}$$

### 2.2 密度比率与健康约束
- **实质代码行比率**：$R_{\text{sub}} = \frac{\text{LOC}_{\text{total}} - \text{LOC}_{\text{blank}} - \text{LOC}_{\text{comment}}}{\text{LOC}_{\text{total}}} \ge 0.60$；
- **实体载荷留存率（TSPR）**：$\text{TSPR} = \frac{\text{ELOC}_{\text{5D}}}{\text{LOC}_{\text{total}}} \ge 0.40$。

---

## 三、 两层解耦差分形变包络 (Two-Tier Envelopes)

```text
+-------------------------------------------------------------------------------+
|                           Two-Tier Differential Envelopes                     |
+------------------------------------+------------------------------------------+
|  Layer A: 单文件微观形变包络        |  Layer B: 提交批次宏观聚合形变包络        |
|  (Single-File Micro Envelope)      |  (Commit-Batch Macro Bounds)             |
+------------------------------------+------------------------------------------+
| • 新增上限:                        | • 批次总新增上限:                        |
|   - 新建文件: E_add <= 180.0 ELOC  |   sum(E_add) <= 360.0 5D ELOC            |
|   - 已有文件: E_add <= 120.0 ELOC  |                                          |
| • 删除上限:                        | • 批次总删除上限:                        |
|   - E_del <= 100.0 ELOC            |   sum(E_del) <= 280.0 5D ELOC            |
|     (超限须有Verified Refactor见证)|                                          |
| • 实体比率:                        | • 最低准入更替量:                        |
|   - R_sub >= 0.60, TSPR >= 0.40    |   E_turnover >= Theta_admission          |
+------------------------------------+------------------------------------------+
```

---

## 四、 贝叶斯 Jeffreys 后验经验自适应最低更替量门槛

为了防止通过微小空白或无意义字符骗取提交通过，提交批次的净更替量 $E_{\text{turnover}}$ 必须跨越自适应准入门槛：
$$E_{\text{turnover}} = \sum E_{\text{add}} + 0.8 \times \sum E_{\text{del}}$$

### 4.1 经验后验推导
从最近 $N$ 次合法提交的有效更替历史样本集 $\mathcal{H} = \{T_1, T_2, \dots, T_N\}$ 中，利用无信息 Jeffreys 先验 $\text{Beta}(0.5, 0.5)$ 估算经验分布均值 $\mu_{\text{Jeffreys}}$ 与样本方差 $\sigma$：
$$\mu_{\text{Jeffreys}} = \frac{0.5 + \sum_{i=1}^N T_i}{1.0 + N}$$
$$\Theta_{\text{candidate}} = \mu_{\text{Jeffreys}} - 0.5 \sigma$$
$$\Theta_{\text{admission}} = \text{clamp}(\Theta_{\text{candidate}}, 3.0, 25.0)$$

- **冷启动回退**：当样本数 $N < 3$ 时，确定性采用刚性下界 $\Theta_{\text{floor}} = 3.0$ 5D ELOC；
- **防死锁封顶**：动态准入门槛硬封顶于 $\Theta_{\text{cap}} = 25.0$ 5D ELOC，防止历史暴增导致后续提交锁死。

---

## 五、 双轨交错提交节拍契约 (Dual-Beat Alternating Cadence)

当涉及复杂业务、系统重构或阶段性推进时，工作区强制执行双轨交错提交节拍：

```text
[Code Beat 生产提交] ───> [质量审查跑分落盘] ───> [Telemetry Beat 存证提交] ───> [下一循环]
 (仅包含生产与测试代码)      (生成审查报告/周报)       (仅包含报告与遥测账本)
```

1. **第一拍（Code Beat）**：
   - 仅暂存和提交当前批次的代码与单元测试变更；
   - 严禁夹带长篇审查报告、自检周报或宏观全景看板；
2. **第二拍（Telemetry Beat）**：
   - 针对第一拍代码运行本地审查（`audit-all`、`audit-taxis` 或项目专用审查器）；
   - 将生成的审查报告、指标增量快照和遥测账本原子提交入库；
3. **时空证据链闭环**：
   - 每一批生产代码变更都在 Git 历史中紧随一条不可伪造的客观质量存证，形成完整因果链条。
