# 文档超链接存活性与相对路径避坑指南 (`LINK-DEAD` / `LINK-ABS-FILE-URI`)

本指南规范了在工作区 Markdown 文档中编写超链接与相对路径的标准实践，防止触发静态文档门禁阻断。

---

## 一、 严禁绝对路径与本地协议 URI (`LINK-ABS-FILE-URI`)

在自动化文档门禁（`audit_docs.py` / `validate-docs.js`）中：
- **违规特征**：包含 `file:///`、Windows 盘符（如 `C:\...`、`c:/...`）或特定机器的用户根目录（如 `/Users/...`）；
- **门禁后果**：直接触发非零退出码一票否决阻断；
- **核心根由**：绝对路径在远端 CI 流水线、其他团队成员机器或跨操作系统（Windows / Linux / macOS）时必然解析失效；
- **刚性要求**：必须统一采用**项目工作区内的相对路径**（Relative Path）。

---

## 二、 相对路径计算与跨目录跳转范例

相对路径应以当前 Markdown 文件所在的物理目录为基准计算：

1. **同目录文件互跳**：
   ```markdown
   [阶段2契约](阶段2_架构拓扑与接口契约设计.md)
   ```
2. **跳转至上层或兄弟目录**：
   ```markdown
   [领域服务规范](../domain/service-guide.md)
   ```
3. **跨多级目录跳转至仓库顶层文档**（以 `WebGames/docs/路线图/01_短期施工区/Phase_01/doc.md` 为例）：
   ```markdown
   [工作区总规](../../../../AGENTS.md)
   [顶层蓝图](../../../../docs/agent-native-system-blueprint.md)
   ```

---

## 三、 锚点链接与标题对齐规则 (`LINK-ANCHOR-DEAD`)

1. **标题存在性校验**：锚点（`#section-name`）指向的 Markdown 标题必须在目标文档中真实存在；
2. **标准 GitHub Slug 规则**：
   - 字母转换为全小写；
   - 空格替换为短横线 `-`；
   - 移除非字母数字的特殊标点（保留短横线与中文标点匹配模式）；
   - 示例：`## 一、 快速作业路由中枢` $\rightarrow$ `[路由中枢](#一-快速作业路由中枢)`。

---

## 四、 自动化审查与死链排查指令

```powershell
# 1. 运行 WebGames 专项文档审计（全面检测死链、绝对路径、标题锚点）
python WebGames/scripts/py/audit_docs.py

# 2. 运行 auto-refactor 文档质量门禁
node auto-refactor/scripts/validate-docs.js
```
