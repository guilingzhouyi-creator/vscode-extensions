#!/usr/bin/env bash
# ==============================================================================
# 模块归属: CI/CD 自动化流水线 (Automation · PR 统一前置门禁)
# 文件路径: scripts/sh/pr-gate.sh
# 架构定位: PR 门禁调度 Runner (Linux Bash)
# 依赖与触发: 触发方: GitHub Actions (pull_request) | 上游: git diff | 下游: 门禁检查状态 | 运行时: Bash 4+
# 职责说明: 执行 PR 差异预审、黑名单关键字过滤与自动化门禁调度，保障合流前质量
# 退出语义与设计依据: 退出码: 0=门禁通过, 1=存在阻断违规 | 设计依据: AGENTS.md 构建门禁通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/pr-gate.sh
# ==============================================================================
set -uo pipefail

# 冲突分级单源规则（与 auto-merge-gate.sh 共享，防两道门禁规则漂移）
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gate-common.sh"

# ---------- 0. 基础信息 ----------
REPO_SLUG="${CNB_REPO_SLUG:-}"
PR_NUM="${CNB_PULL_REQUEST_IID:-}"
TARGET_BRANCH="${CNB_DEFAULT_BRANCH:-main}"
HEAD_COMMIT="${CNB_COMMIT:-}"
REPO_ROOT="${CNB_REPO_WORKTREE:-$(pwd)}"
EVENT="${CNB_EVENT:-}"

# 本程序仅处理 PR 场景；非 PR 或缺少关键变量时优雅退出（不报错，不阻塞）
if [[ "${CNB_PULL_REQUEST:-false}" != "true" ]]; then
  echo "pr-gate: 非 PR 场景，跳过。"
  exit 0
fi
if [[ -z "$PR_NUM" ]]; then
  echo "⚠️ pr-gate: 缺少 PR 编号环境变量（CNB_PULL_REQUEST_IID 为空），跳过前置门禁。"
  exit 0
fi

echo "================= PR 统一前置门禁（pr-gate） ================="
echo "PR        : #${PR_NUM}"
echo "目标分支  : ${TARGET_BRANCH}"
echo "head commit: ${HEAD_COMMIT:-未知}"
echo "事件      : ${EVENT}"

# ---------- 1. 幂等去重（防卡死核心 · 对应容错兜底分册 §4 幂等保护 R16） ----------
# 规则：若该 PR 的 head commit 已审查过（存在 status/gate-ok 标签 或 本地缓存记录），
# 说明本次触发是"重复事件"（如：同一 commit 被平台重复推送 / 编辑评论重触发），
# 直接跳过，不再拉起任何 NPC，避免重复审查、重复修复、级联无限触发。
# 对应门禁治理分册 §4.7.3：门禁失败才需重跑；已通过则不重做。
#
# 幂等判断采用双保险：
#   a) 检查 PR 标签是否含 status/gate-ok（脚本上次通过时打上）
#   b) 本地缓存文件记录上次 head commit（二次防重）
GATE_OK_LABEL="status/gate-ok"
CACHE_DIR="${REPO_ROOT}/.workbuddy/pr-gate-cache"
CACHE_FILE="${CACHE_DIR}/pr-gate-${PR_NUM}.last"

already_gated="false"
if [[ -n "$HEAD_COMMIT" && -f "$CACHE_FILE" ]]; then
  LAST_COMMIT="$(cat "$CACHE_FILE" 2>/dev/null | tr -d '[:space:]')"
  if [[ -n "$LAST_COMMIT" && "$LAST_COMMIT" == "$HEAD_COMMIT" ]]; then
    already_gated="true"
  fi
fi

if [[ "$already_gated" == "true" ]]; then
  echo "🛑 pr-gate: PR #${PR_NUM} 的 head commit（${HEAD_COMMIT}）已审查过，本次为重复触发，跳过（幂等防卡死）。"
  echo "【门禁结论】跳过：重复触发，已审查，无需拉起 NPC。"
  exit 0
fi

# 附加标签校验（尽力而为，CNB CLI 不可用时不阻断）
# 标签清单只拉取一次：幂等检查与 5.4 合入状态读取共用，避免重复 API 调用
CUR_LABELS=""
if command -v cnb >/dev/null 2>&1; then
  CUR_LABELS=$(cnb pulls list-pull-labels --repo "$REPO_SLUG" --number "$PR_NUM" 2>/dev/null || true)
  if echo "$CUR_LABELS" | grep -q "$GATE_OK_LABEL"; then
    echo "🛑 pr-gate: PR #${PR_NUM} 已打 ${GATE_OK_LABEL} 标签（已审查），本次重复触发，跳过（幂等防卡死）。"
    echo "【门禁结论】跳过：已审查（标签幂等），无需拉起 NPC。"
    exit 0
  fi
fi

echo "--- 幂等检查通过：本次为新提交，进入冲突检测与 Diff 初筛 ---"

# ---------- 2. 冲突检测（对应门禁治理分册 §4.8 合入冲突自动审查） ----------
# 用 git merge --no-commit 预演目标分支合并，判断是否存在 Git 合并冲突。
CONFLICT_LEVEL="C0"      # C0=无冲突 C1=可自动化解 C2=需审查判断 C3=高危
CONFLICT_FILES=""

if git rev-parse --git-dir >/dev/null 2>&1; then
  # 先确认目标分支存在（本地或 origin 前缀），不存在则无法预演，按无冲突（C0）处理
  # （避免目标分支不存在时 merge 报错被误判为冲突）
  MERGE_TARGET=""
  if git rev-parse --verify -q "${TARGET_BRANCH}" >/dev/null 2>&1; then
    MERGE_TARGET="${TARGET_BRANCH}"
  elif git rev-parse --verify -q "origin/${TARGET_BRANCH}" >/dev/null 2>&1; then
    MERGE_TARGET="origin/${TARGET_BRANCH}"
  fi

  if [[ -n "$MERGE_TARGET" ]]; then
    # 预演合并：git merge --no-commit，再回退，不污染当前 HEAD
    if git merge --no-commit --no-ff "$MERGE_TARGET" >/dev/null 2>&1; then
      CONFLICT_LEVEL="C0"
      git merge --abort >/dev/null 2>&1 || git reset --merge >/dev/null 2>&1 || true
    else
      CONFLICT_LEVEL="C2"
      CONFLICT_FILES=$(git diff --name-only --diff-filter=U 2>/dev/null | tr '\n' ' ')
      git merge --abort >/dev/null 2>&1 || git reset --merge >/dev/null 2>&1 || true
      echo "⚠️ pr-gate: 检测到 Git 合并冲突。冲突文件: ${CONFLICT_FILES:-未知}"
    fi
  else
    echo "ℹ️ pr-gate: 目标分支 ${TARGET_BRANCH} 本地不存在，跳过冲突预演（按 C0 无冲突处理）。"
  fi
else
  echo "ℹ️ pr-gate: 当前环境无 git 仓库或无法预演合并，默认按无冲突（C0）处理。"
fi

# 冲突分级细化（单源规则，见 gate-common.sh）：
#   - 高危文件（数据迁移/核心逻辑/依赖） → C3 高危
#   - 冲突文件少 → C1（冲突双方可自动化解，交由构建/测试主责处理）
#   - 其余 → C2（需审查判断）
if [[ "$CONFLICT_LEVEL" == "C2" ]]; then
  NEW_LEVEL=$(gate_classify_conflicts "$CONFLICT_FILES")
  if [[ "$NEW_LEVEL" == "C3" ]]; then
    CONFLICT_LEVEL="C3"
    echo "⚠️ pr-gate: 冲突涉及高危文件（数据迁移/核心逻辑/依赖），升级为 C3 高危。"
  elif [[ "$NEW_LEVEL" == "C1" ]]; then
    CONFLICT_LEVEL="C1"
    echo "ℹ️ pr-gate: 冲突文件较少且非高危，判定为 C1（可自动化解）。"
  fi
fi

# ---------- 3. Diff 质量初筛（对应门禁治理分册 §4.5 自动化审查范围） ----------
DIFF_STATS=""
CHANGED_FILES_CNT=0
ADDED_LINES=0
DELETED_LINES=0
QUALITY_FLAGS=()

if git rev-parse --git-dir >/dev/null 2>&1; then
  # 确定可用的 diff 基准（尽力而为）：优先 origin/<目标分支>，其次 <目标分支>，
  # 最后退化为 HEAD~1（仅当能拿到父提交时），避免分支不存在导致的多行/语法错误。
  DIFF_BASE=""
  if git rev-parse --verify -q "origin/${TARGET_BRANCH}" >/dev/null 2>&1; then
    DIFF_BASE="origin/${TARGET_BRANCH}"
  elif git rev-parse --verify -q "${TARGET_BRANCH}" >/dev/null 2>&1; then
    DIFF_BASE="${TARGET_BRANCH}"
  elif git rev-parse --verify -q "HEAD~1" >/dev/null 2>&1; then
    DIFF_BASE="HEAD~1"
  fi

  if [[ -n "$DIFF_BASE" ]]; then
    # 单次 git diff --numstat 同时取文件数与增删行（每文件一行，二进制行以 "-" 计入文件数不计量）
    read -r CHANGED_FILES_CNT ADDED_LINES DELETED_LINES <<< "$(git diff --numstat "${DIFF_BASE}...HEAD" 2>/dev/null | awk '$1 ~ /^[0-9]+$/ {a+=$1} $2 ~ /^[0-9]+$/ {d+=$2} END{print NR, a+0, d+0}')"
    DIFF_STATS="${CHANGED_FILES_CNT} 文件 / +${ADDED_LINES} -${DELETED_LINES}"
  else
    DIFF_STATS="（无可用 diff 基准，跳过统计）"
    CHANGED_FILES_CNT=0; ADDED_LINES=0; DELETED_LINES=0
  fi

  # 质量信号初筛（关键词扫描 diff 文本，供审查聚焦；不替代正式审查）
  # 全量 diff 落临时文件一次，三类信号共用，避免重复生成 diff
  QUALITY_TMP=$(mktemp)
  trap 'rm -f "$QUALITY_TMP"' EXIT
  if [[ -n "$DIFF_BASE" ]]; then
    git diff "${DIFF_BASE}...HEAD" > "$QUALITY_TMP" 2>/dev/null || true
  fi
  # 硬编码扫描：字符串字面量（单引号以变量传入正则，避免 \x27 转义在不同 grep 间的可移植差异）
  HC_QUOTE="'"
  if grep -qE "^\+\s*(const|let|var).{0,20}=[\"${HC_QUOTE}][0-9a-zA-Z_./]{3,}[\"${HC_QUOTE}]" "$QUALITY_TMP"; then
    QUALITY_FLAGS+=("疑似硬编码（字符串字面量，建议抽配置/常量）")
  fi
  if grep -qE '^\+\s*(TODO|FIXME|HACK)\b' "$QUALITY_TMP"; then
    QUALITY_FLAGS+=("新增 TODO/FIXME 待办（需确认是否遗留）")
  fi
  if grep -qE '^\+\s*console\.(log|debug)\b' "$QUALITY_TMP"; then
    QUALITY_FLAGS+=("新增调试输出 console.log（生产代码建议移除）")
  fi
  rm -f "$QUALITY_TMP"
  if [[ "${CHANGED_FILES_CNT:-0}" -gt 30 ]]; then
    QUALITY_FLAGS+=("改动文件数大（${CHANGED_FILES_CNT} 个）——疑似大重构/越权，需审查确认 R2")
  fi
  if [[ "${ADDED_LINES:-0}" -gt 800 ]]; then
    QUALITY_FLAGS+=("净增行数大（${ADDED_LINES} 行）——疑似超大规模改动，需审查确认")
  fi
else
  DIFF_STATS="（无法获取 git diff，跳过统计）"
fi

echo ""
echo "--- Diff 质量初筛 ---"
echo "变更文件数 : ${CHANGED_FILES_CNT:-0}"
echo "净增行     : ${ADDED_LINES:-0}  净删行: ${DELETED_LINES:-0}"
if [[ "${#QUALITY_FLAGS[@]}" -gt 0 ]]; then
  echo "质量信号    :"
  for flag in "${QUALITY_FLAGS[@]}"; do
    echo "  ⚠️ ${flag}"
  done
else
  echo "质量信号    : 未发现明显硬编码/临时文件/超大规模信号 ✅"
fi

# ---------- 4. 冲突分级派单（防卡死核心 · 对应门禁治理分册 §4.8.2） ----------
# 核心目标：避免 4 个 NPC 全部并行拉起后互相等待。按分级只唤醒"本轮必须推进"的对象，
# 并明确"谁主导、谁补位"，其余不重复触发。
case "$CONFLICT_LEVEL" in
  C0)
    WAKE_GUIDE="无冲突 → 由【协作员·审查】主导执行 PR 门禁（规范门禁主审+四眼复核），
构建/测试补位各自门禁；合入员汇总合入门禁（决策，R21）。无重复触发。"
    ;;
  C1)
    WAKE_GUIDE="冲突可自动化解 → 由冲突双方【协作员·构建】/【协作员·测试】按主责定点化解并重跑门禁，
审查复核；不额外拉起规划者。"
    ;;
  C2)
    WAKE_GUIDE="冲突需审查判断 → 由【协作员·审查】（主审）+【合入员】（合入门禁）推进，
冲突方定点修复；构建/测试补位门禁验证。"
    ;;
  C3)
    WAKE_GUIDE="高危冲突 → 由【协作员·审查】+ 官方 CodeBuddy 复核 + 提出者（强制人工），
禁止自动合入（门禁治理 §4.8.4/§4.8.5）。其余执行体暂停推进，避免盲目改坏核心。"
    ;;
esac

echo ""
echo "--- 冲突分级与派单 ---"
echo "冲突等级  : ${CONFLICT_LEVEL}"
echo "唤醒建议  : ${WAKE_GUIDE}"

# ---------- 5. 输出结构化【门禁结论】 + 幂等落盘 ----------
# 5.1 幂等缓存落盘（head commit 记录，防重复触发）
if [[ -n "$HEAD_COMMIT" ]]; then
  mkdir -p "$CACHE_DIR" 2>/dev/null || true
  echo "$HEAD_COMMIT" > "$CACHE_FILE" 2>/dev/null || true
fi

# 5.2 尝试打上 status/gate-ok 标签（幂等；CNB CLI 不可用时忽略，不阻断）
if command -v cnb >/dev/null 2>&1; then
  cnb pulls post-pull-labels --repo "$REPO_SLUG" --number "$PR_NUM" --labels "$GATE_OK_LABEL" >/dev/null 2>&1 || true
fi

# 5.3 输出门禁结论（供后续 NPC 读取，避免各自盲目重扫）
echo ""
echo "【门禁结论】PR #${PR_NUM}"
echo "  冲突等级 : ${CONFLICT_LEVEL}"
echo "  冲突文件 : ${CONFLICT_FILES:-无}"
echo "  变更规模 : ${CHANGED_FILES_CNT:-0} 文件 / +${ADDED_LINES:-0} -${DELETED_LINES:-0} 行"
echo "  质量信号 : ${QUALITY_FLAGS[*]:-未发现明显信号}"
echo "  唤醒建议 : ${WAKE_GUIDE}"
echo "【唤醒提示】后续 NPC（审查/构建/测试/合入员）请读取本结论后再分工，避免重复拉起与互相等待；"
echo "  已打 ${GATE_OK_LABEL} 标签用于幂等防重（同一 head commit 重复触发将跳过）。"

# ---------- 5.4 合入状态读取（专职合入员配套 · 2026-08-21 增强） ----------
# 读取 PR 的合入决策标签（status/merge-ready / status/merge-blocked），
# 供合入员 Stage 4 决策与 pull_request.mergeable 复核参考。
# 陈旧否决识别：本 PR 有新提交（已过幂等检查 = head commit 更新）却仍带 merge-blocked，
# 说明否决可能针对旧 commit → 提示合入员复核；人工否决不自动清除（保否决权）。
MERGE_STATE_LINE="无合入决策标签（尚未由合入员判定）"
if [[ -n "$CUR_LABELS" ]]; then
  if echo "$CUR_LABELS" | grep -q "status/merge-blocked"; then
    MERGE_STATE_LINE="status/merge-blocked（存在否决 → 自动合入被阻断）"
    echo "⚠️ 陈旧否决提示：PR #${PR_NUM} 存在 status/merge-blocked 否决标签，但本次为新提交（head ${HEAD_COMMIT:-未知}）。"
    echo "  请【合入员】在 Stage 4 合入门禁复核该否决是否仍有效；人工否决需人工确认解除，脚本不自动清除。"
  elif echo "$CUR_LABELS" | grep -q "status/merge-ready"; then
    MERGE_STATE_LINE="status/merge-ready（已放行 → 满足条件可自动合入）"
  fi
fi
echo "  合入状态 : ${MERGE_STATE_LINE}"

exit 0
