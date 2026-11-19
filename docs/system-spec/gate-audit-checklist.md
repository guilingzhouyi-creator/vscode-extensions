# 门禁系统季度审计清单

- 适用范围：仓库根目录级门禁（`pre-commit` / `pre-merge-commit` / `commit-msg` / `post-commit` / `post-merge` / `pre-push` / `audit-all` / CI）
- 执行频率：每季度一次；重大门禁变更后追加一次
- 产出：审计结论并入统一审查快照 `.audit-logs/audit-latest.md`（由 `record-workspace-audit.js` 按统一模板渲染）

---

## 一、审计前准备

| 序号 | 动作 | 命令 | 通过标准 |
| :---: | :--- | :--- | :--- |
| 1 | 同步主干并确认干净树 | `git status --porcelain` | 输出为空 |
| 2 | 安装门禁依赖 | `npm run gate:bootstrap` | 钩子激活、依赖与构建就绪 |
| 3 | 确认六类钩子已激活（pre-commit / pre-merge-commit / commit-msg / post-commit / post-merge / pre-push） | `git config --get core.hooksPath` | 输出 `.githooks` |

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
| 10 | Pillar-2 治理守卫并发核验 | `node scripts/common/run-workspace-guards.js --group pillar2` | 退出码 0，全组守卫全部 PASS |
| 11 | VS Code 扩展单源发现 | `node scripts/common/project-registry-resolver.js --vscode-extensions` | 退出码 0，按目录输出含 `engines.vscode` 的顶层扩展（支持 `--json` / `--matrix-json`） |
| 12 | 单源影响面路由自检 | `node scripts/common/validate-impact-slices.js` | 影响面收敛、未知路径保守回退及 `--resolve-range` fail-closed 全通过 |

---

## 三、行为有效性检查

| 序号 | 检查项 | 命令 | 通过标准 |
| :---: | :--- | :--- | :--- |
| 13 | 门禁三态自检 | `npm run gate:selftest` | 全矩阵 PASS（含缺依赖 fail-closed） |
| 14 | 双实现行为与通用 CLI 参数同构 | `npm run gate:parity` | 样例两端一致，四根门禁 `-Help`/`--help`、`-Json`/`--json`、`-Agent`/`--agent`、`-ViewLog`/`--view-log` 对齐 |
| 15 | 物理卫生八维 | `node scripts/common/validate-physical-hygiene.js` | 100 分且 0 违规 |
| 16 | 失败信封新鲜度 | 触发一次受控失败后查看 `.audit-logs/last-failure.json` | 含 `runId` 且为本次运行 |
| 17 | 单源失败信封脱敏与契约 | `node scripts/common/test-gate-telemetry.js` | ANSI 剥离、本地路径脱敏及 `GateFailureEnvelope` 校验全通过 |

---

## 四、绕过路径抽查

| 序号 | 绕过场景 | 验证方式 | 预期 |
| :---: | :--- | :--- | :--- |
| 18 | 部分暂存（索引违规、工作区合规） | 构造索引与工作区内容不同的样例 | 以索引内容判定并阻断 |
| 19 | 引号/反引号包裹禁词 | 提交信息中包含 `“临时”` | 阻断 |
| 20 | 大写提交类型 | 标题使用 `FEAT(...)` | 两端均阻断 |
| 21 | 非当前分支推送 | 在分支 A 工作区推送分支 B | 扫描 B 的提交 |
| 22 | 重命名后修改 | `git mv` 后修改内容并暂存 | 新路径内容被检查 |

---

## 五、审计结论模板

| 字段 | 填写要求 |
| :--- | :--- |
| 审计日期 | YYYY-MM-DD |
| 执行人 | 姓名或 Agent 标识 |
| 通过项 / 总项 | 例：21 / 22 |
| 新增问题 | 按 P0/P1/P2/P3 分级，附证据命令 |
| 规则目录计数 | 引用 `rule-catalog.json` 的 `totalRules`，不写入正文数字 |
| 整改计划 | 复用改造计划表格式，标注任务 ID 与验收命令 |

---

## 六、退出条件

1. 第二、三节全部检查通过；
2. 第四节抽查无未修复的绕过路径；
3. 新增问题均已录入改造计划表并指派；
4. 审计结论随统一审查快照落盘至 `.audit-logs/`（运行期产物，不入库），并在提交信息中声明 `[Project: governance]`。
