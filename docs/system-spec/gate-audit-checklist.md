# 门禁系统季度审计清单

- 适用范围：仓库根目录级门禁（`pre-commit` / `commit-msg` / `pre-push` / `audit-all` / CI）
- 执行频率：每季度一次；重大门禁变更后追加一次
- 产出：审计报告（沿用 `.workbuddy/reports/root-gate-system-audit-<date>.md` 模板）

---

## 一、审计前准备

| 序号 | 动作 | 命令 | 通过标准 |
| :---: | :--- | :--- | :--- |
| 1 | 同步主干并确认干净树 | `git status --porcelain` | 输出为空 |
| 2 | 安装门禁依赖 | `npm run gate:bootstrap` | 钩子激活、依赖与构建就绪 |
| 3 | 确认三类钩子已激活 | `git config --get core.hooksPath` | 输出 `.githooks` |

---

## 二、结构一致性检查

| 序号 | 检查项 | 命令 | 通过标准 |
| :---: | :--- | :--- | :--- |
| 4 | 规则目录零漂移 | `npm run gate:rules` | 退出码 0 |
| 5 | 规则 ID 闭包 | `npm run gate:closure` | 未登记 0 条 |
| 6 | 规则执行可达性 | `npm run gate:reach` | 无"声明未执行"的 error 规则 |
| 7 | 文档计数与引用 | `npm run gate:docs` | 无硬编码计数、无死链 |
| 8 | 跨平台脚本同构 | `node scripts/common/validate-script-isomorphism.js` | 所有同构对合规 |
| 9 | 技能集与插件同构 | `node scripts/common/validate-skills.js` | PASS，且插件缺失时标注 skipped |

---

## 三、行为有效性检查

| 序号 | 检查项 | 命令 | 通过标准 |
| :---: | :--- | :--- | :--- |
| 10 | 门禁三态自检 | `npm run gate:selftest` | 全矩阵 PASS（含缺依赖 fail-closed） |
| 11 | 双实现行为差分 | `npm run gate:parity` | 所有样例两端一致 |
| 12 | 物理卫生八维 | `node scripts/common/validate-physical-hygiene.js` | 100 分且 0 违规 |
| 13 | 失败信封新鲜度 | 触发一次受控失败后查看 `.audit-logs/last-failure.json` | 含 `runId` 且为本次运行 |

---

## 四、绕过路径抽查

| 序号 | 绕过场景 | 验证方式 | 预期 |
| :---: | :--- | :--- | :--- |
| 14 | 部分暂存（索引违规、工作区合规） | 构造索引与工作区内容不同的样例 | 以索引内容判定并阻断 |
| 15 | 引号/反引号包裹禁词 | 提交信息中包含 `“临时”` | 阻断 |
| 16 | 大写提交类型 | 标题使用 `FEAT(...)` | 两端均阻断 |
| 17 | 非当前分支推送 | 在分支 A 工作区推送分支 B | 扫描 B 的提交 |
| 18 | 重命名后修改 | `git mv` 后修改内容并暂存 | 新路径内容被检查 |

---

## 五、审计结论模板

| 字段 | 填写要求 |
| :--- | :--- |
| 审计日期 | YYYY-MM-DD |
| 执行人 | 姓名或 Agent 标识 |
| 通过项 / 总项 | 例：17 / 18 |
| 新增问题 | 按 P0/P1/P2/P3 分级，附证据命令 |
| 规则目录计数 | 引用 `rule-catalog.json` 的 `totalRules`，不写入正文数字 |
| 整改计划 | 复用改造计划表格式，标注任务 ID 与验收命令 |

---

## 六、退出条件

1. 第二、三节全部检查通过；
2. 第四节抽查无未修复的绕过路径；
3. 新增问题均已录入改造计划表并指派；
4. 审计报告归档至 `.workbuddy/reports/`，并在提交信息中声明 `[Project: governance]`。
