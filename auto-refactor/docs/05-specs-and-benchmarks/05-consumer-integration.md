# 消费方接入规范（Consumer Integration）

> **用途**：把本引擎接入任意语言/项目时，项目侧**只**需要三样东西——一份配置、一个 runner 调用、一条基线；引擎仓库保持项目无关。
> **随仓库提供**：[`templates/consumer/run.mjs`](../../templates/consumer/run.mjs)（通用 runner）、[`templates/consumer/config.template.json`](../../templates/consumer/config.template.json)（配置模板）、语言级预设 [`presets/`](../../presets)。
> **中立性判据**：新接入第 N 个语言/项目时，引擎仓库零改动（`npm test` 的 `validate-project-neutrality` 强制）。

---

## 1. 快速开始

```bash
# ① 部署项目侧目录
mkdir -p <project>/.auto-refactor
cp <engine>/templates/consumer/config.template.json <project>/.auto-refactor/config.json
# ② 编辑 include / exclude / thresholds / analyzers（层映射与注释门禁按项目政策决定）
# ③ 冻结基线（可先只读跑一遍看量）
node <engine>/templates/consumer/run.mjs --root <project> --update-baseline
# ④ 日常执行：只对「新增」发现阻断
node <engine>/templates/consumer/run.mjs --root <project> --fail-on-severity warning
```

引擎定位顺序：`--engine <dir>` → `$AUTO_REFACTOR_ENGINE` → 从项目根逐级向上查找 `package.json` 名为 `auto-refactor` 的目录。

## 2. 退出码契约

| 退出码 | 含义 | 触发条件 |
| ---: | :--- | :--- |
| **0** | 通过 | 无达到阈值的发现；有基线时仅比较**新增**发现 |
| **1** | 阻断 | 存在达到 `--fail-on-severity`（默认 `warning`）的发现 |
| **2** | 用法/环境错误 | 配置缺失、engine 未构建、参数非法、阈值双处声明不一致 |

> `--report-only` 下不会出现 1：引擎不再按阈值退出，消费方读取报告自行裁决。

> **fail-closed**：engine 缺失默认退出 2——"没跑"绝不能等于"通过"。仅当工具确实可选时才用 `--allow-missing-engine` 显式降级。

**两个逃生阀**（供已有自研桥接的项目按需使用）：

- `--report-only`：不向引擎传 `--fail-on-severity`，退出码只反映引擎故障（0/2），裁决交给消费方——适用于把发现映射进自有信封、由自己判定阻断的项目。
- `--engine-arg <arg>`（可重复，亦支持 `--engine-arg=value`）：把引擎 CLI 原生参数原样透传（如 `--engine-arg --analyzers --engine-arg "complexity,constants"`），消费方无需为本 runner 未建模的开关等待升级。

## 3. 基线棘轮（Ratchet）

- 基线文件默认 `<project>/.auto-refactor/baseline.json`，粒度默认 `grouped`（`analyzer|rule|file` 计数），对行号漂移容忍、对**新增**敏感。
- 刷新基线：`--update-baseline`（**必须走评审**：基线变大等于接受新债务）。
- 只收紧不放宽：存量收敛后同步刷新基线，避免历史发现长期占用额度。

## 4. 阈值单一来源

阈值优先声明在 `analyzers.*.options`（生效位置）。若项目同时在全局 `thresholds` 与 `options` 声明同名键，runner 的 `--check-threshold-parity` 会在扫描前拒绝**取值不一致**的双处声明，防止口径漂移。

## 5. CI 集成

引擎与项目不在同一仓库时，CI 需要同时检出两者（私有仓库用 PAT/App token）：

```yaml
  auto-refactor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { path: project }
      - uses: actions/checkout@v4
        with:
          repository: <org>/vscode-extensions
          path: engine
          token: ${{ secrets.ENGINE_CHECKOUT_TOKEN }}
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm run build
        working-directory: engine/auto-refactor
      - run: node engine/auto-refactor/templates/consumer/run.mjs --root project --fail-on-severity warning
```

工作区风格（多仓同机）可省去第二次 checkout，直接用相对路径 `--engine ../vscode-extensions/auto-refactor`。

## 6. 与自研桥接脚本的关系

项目已自建桥接（如在扫描前后做 SARIF 上传、徽章、报告渲染）时，**保留项目特有部分**，把「定位引擎 + 组装参数 + 基线 + 退出码映射」交给本 runner：典型退化是自研脚本只做 `spawnSync(node, [runner, ...])` 再消费 `report.json`。这样引擎升级时，只有 runner 需要跟进。

## 7. 常见反模式

| 反模式 | 后果 | 正确做法 |
| :--- | :--- | :--- |
| 语言包默认关闭却当作已审查 | 把「没跑」读成「零违规」 | 看 `summary.disabledAnalyzers` 与 `analyzer coverage:` 提示，或直接启用该语言包 |
| 无基线直接用 `--fail-on-issue` | 存量债务导致 CI 永远红 | 先冻结基线，再按新增阻断 |
| suppression 不带 reason | 豁免变成静默丢弃 | `reason` 必填，说明项目政策依据 |
| 阈值在全局与 options 双处声明 | 生效值随合并顺序漂移 | 单一来源 + `--check-threshold-parity` |
| 缺 engine 时静默跳过 | 门禁形同虚设 | 默认 fail-closed；确需可选才 `--allow-missing-engine` |
