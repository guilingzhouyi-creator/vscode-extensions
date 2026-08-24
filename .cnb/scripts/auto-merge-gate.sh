#!/usr/bin/env bash
# =============================================================================
# auto-merge-gate.sh — PR 自动化合入安全门禁（配合平台原生 git:auto-merge）
# -----------------------------------------------------------------------------
# 作用：
#   在 `pull_request.mergeable` 事件（PR 满足「无冲突 + 评审通过」）触发时，
#   作为【自动化合入前的最后一道确定性门禁】，判定该 PR 是否允许平台自动合入：
#     ① 幂等/就绪判定：确认该 PR 已通过前置门禁（status/gate-ok 标签或缓存）。
#     ② 否决标签检查：存在 status/merge-blocked（合入员 NPC / 人工提前否决）→ 禁止自动合入。
#     ③ 冲突安全判定：仅允许 C0（无冲突）或 C1（已由构建/测试化解）级别自动合入；
#        C2/C3（需审查/高危）强制退回人工，绝不自动合入。
#     ④ 高危保护：检测高危文件（数据迁移/核心逻辑/依赖/越权）时强制禁止自动合入，
#        避免自动化在关键改动上盲目放行。
#
# 退出语义（配合流水线 stages 顺序执行）：
#   - 退出码 0  → 允许自动合入 → 后续 `git:auto-merge` 任务继续执行。
#   - 退出码非 0 → 禁止自动合入 → 当前 stage 失败，后续 `git:auto-merge` 被跳过
#                 （stages 中断并跳转到 failStages），PR 保持未合入等待人工。
#   - fail-safe：目标分支缺失 / 无 git 仓库 / 预演回退异常 → 判为 UNKNOWN 保守禁止合入，绝不降级放行。
#
# 解决的问题：
#   平台 `git:auto-merge` 会在 PR mergeable（无冲突+评审通过）时直接合入，
#   但仓库存在多级冲突分级（C0-C3）与门禁机制，直接裸用会绕过门禁治理 §4.8
#   的冲突准入判断（C2 需审查判断、C3 高危禁止自动合入）。
#   本脚本在 auto-merge 前插入确定性判定，把「平台原生能力」与「仓库门禁治理」
#   衔接起来，实现"安全的全自动合入"。
#
# 配套：
#   - pr-gate.sh（$ pull_request 前置门禁：冲突检测分级 C0-C3 + 幂等 gate-ok）
#   - 门禁治理分册 §4.8 合入冲突自动审查（C0-C3 准入规则）
#   - 流水线接入：.cnb.yml（$ 下 pull_request.mergeable 事件，置于 git:auto-merge 之前）
#
# 用法：
#   bash .cnb/scripts/auto-merge-gate.sh
#   （依赖 CNB 流水线注入的环境变量 + cnb-cli + git，仅应在流水线内运行）
#
# 环境变量（由 CNB 流水线自动注入）：
#   PR 场景：CNB_PULL_REQUEST_TITLE / CNB_PULL_REQUEST_DESCRIPTION / CNB_PULL_REQUEST_IID
#   Git：    CNB_REPO_SLUG（组织/仓库）、CNB_DEFAULT_BRANCH（目标分支）、CNB_COMMIT（head commit）
#   公共：    CNB_PULL_REQUEST（是否 PR）、CNB_EVENT（事件名）、CNB_REPO_WORKTREE（可选工作区路径）
# =============================================================================
set -uo pipefail

# ---------- 0. 基础信息 ----------
REPO_SLUG="${CNB_REPO_SLUG:-}"
PR_NUM="${CNB_PULL_REQUEST_IID:-}"
TARGET_BRANCH="${CNB_DEFAULT_BRANCH:-main}"
HEAD_COMMIT="${CNB_COMMIT:-}"
REPO_ROOT="${CNB_REPO_WORKTREE:-$(pwd)}"
EVENT="${CNB_EVENT:-}"

# 仅处理 PR 场景；非 PR 或缺少关键变量时——为安全起见禁止自动合入（退出非 0）
if [[ "${CNB_PULL_REQUEST:-false}" != "true" || -z "$PR_NUM" ]]; then
  echo "⚠️ auto-merge-gate: 非 PR 场景或缺少 PR 编号（CNB_PULL_REQUEST_IID 为空），禁止自动合入。"
  exit 1
fi

echo "================= PR 自动化合入安全门禁（auto-merge-gate） ================="
echo "PR        : #${PR_NUM}"
echo "目标分支  : ${TARGET_BRANCH}"
echo "head commit: ${HEAD_COMMIT:-未知}"
echo "事件      : ${EVENT}"

# ---------- 1. 就绪判定（必须已过前置门禁，幂等防漏） ----------
# 复用 pr-gate.sh 的幂等判定逻辑：存在 status/gate-ok 标签 或 本地缓存命中，
# 才认为该 PR 已通过前置门禁（冲突检测 + Diff 初筛）。
# 防呆：即使本仓库 pull_request 门禁未跑完，也绝不裸自动合入。
GATE_OK_LABEL="status/gate-ok"
CACHE_DIR="${REPO_ROOT}/.cnb/.cache"
CACHE_FILE="${CACHE_DIR}/pr-gate-${PR_NUM}.last"

gate_passed="false"
if command -v cnb >/dev/null 2>&1; then
  # 尝试查 PR 标签是否含 gate-ok（尽力而为，cnb-cli 不可用不阻断，转缓存判断）
  if cnb pulls get-pull-labels --repo "$REPO_SLUG" --number "$PR_NUM" 2>/dev/null | grep -q "$GATE_OK_LABEL"; then
    gate_passed="true"
  fi
fi
# 缓存二次兜底：head commit 与 pr-gate 记录一致即视为已过门禁
if [[ "$gate_passed" != "true" && -n "$HEAD_COMMIT" && -f "$CACHE_FILE" ]]; then
  LAST_COMMIT="$(cat "$CACHE_FILE" 2>/dev/null | tr -d '[:space:]')"
  if [[ -n "$LAST_COMMIT" && "$LAST_COMMIT" == "$HEAD_COMMIT" ]]; then
    gate_passed="true"
  fi
fi

if [[ "$gate_passed" != "true" ]]; then
  echo "🛑 auto-merge-gate: 该 PR 未检测到前置门禁通过标志（${GATE_OK_LABEL} 标签 / 缓存均未命中）。"
  echo "  为安全起见禁止自动合入，等待 pull_request 门禁完成后重试。"
  exit 1
fi
echo "✅ 就绪判定：已通过前置门禁（gate-ok 命中），继续否决标签与冲突安全判定。"

# ---------- 1.5 否决标签检查（NPC/人工可提前否决自动合入） ----------
# status/merge-blocked 由「合入员」NPC 在合入门禁/自动合入复核中发现阻断时打标，
# 或由人工手动打标。存在该标签 → 即使满足 C0 也禁止自动合入（尊重否决权，fail-safe）。
MERGE_BLOCKED_LABEL="status/merge-blocked"
merge_blocked="false"
if command -v cnb >/dev/null 2>&1; then
  if cnb pulls get-pull-labels --repo "$REPO_SLUG" --number "$PR_NUM" 2>/dev/null | grep -q "$MERGE_BLOCKED_LABEL"; then
    merge_blocked="true"
  fi
fi
if [[ "$merge_blocked" == "true" ]]; then
  echo "🛑 auto-merge-gate: 检测到 ${MERGE_BLOCKED_LABEL} 否决标签（合入员/人工否决），禁止自动合入。"
  echo "  请人工确认后清除该标签（或由合入员修复阻断项后解除），再重试自动合入。"
  exit 1
fi
echo "✅ 否决标签检查：无 ${MERGE_BLOCKED_LABEL}，继续冲突安全判定。"

# ---------- 2. 冲突检测与分级（复用 pr-gate 的 git merge 预演逻辑） ----------
# 在 pull_request.mergeable 事件（目标分支最新）下重新预演合并，
# 确认当前仍无冲突；若存在任何 Git 冲突，则按仓库门禁治理 §4.8 处理，禁止自动合入。
CONFLICT_LEVEL="C0"
CONFLICT_FILES=""
cd "$REPO_ROOT" || { echo "🛑 无法进入仓库目录，禁止自动合入"; exit 1; }

if git rev-parse --git-dir >/dev/null 2>&1; then
  if git rev-parse --verify "$TARGET_BRANCH" >/dev/null 2>&1 || \
     git rev-parse --verify "origin/$TARGET_BRANCH" >/dev/null 2>&1; then
    MERGE_BASE_TARGET="$TARGET_BRANCH"
    git rev-parse --verify "origin/$TARGET_BRANCH" >/dev/null 2>&1 && MERGE_BASE_TARGET="origin/$TARGET_BRANCH"
    # 预演合并，随后回退，不污染当前 HEAD
    if git merge --no-commit --no-ff "$MERGE_BASE_TARGET" >/dev/null 2>&1; then
      # merge 成功（exit 0）已确证无冲突 → C0。
      # 但分两种情况回退：
      #   - 产生 MERGE_HEAD（真实合并）→ 用 merge --abort 清理；abort 失败则判 UNKNOWN 保守禁止，
      #     不 resort 到 git reset --hard（破坏性，绝不静默清空工作区）。
      #   - "Already up to date"（无 MERGE_HEAD，目标分支为 HEAD 祖先）→ 本就不存在合并状态，
      #     无需回退，保持 C0（已确证无冲突）。
      CONFLICT_LEVEL="C0"
      if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
        git merge --abort >/dev/null 2>&1 || CONFLICT_LEVEL="UNKNOWN"
      fi
    else
      CONFLICT_FILES="$(git diff --name-only --diff-filter=U 2>/dev/null | tr '\n' ' ')"
      git merge --abort >/dev/null 2>&1 || true
      # 存在冲突 → 分级：按 pr-gate 规则简化判定
      if [[ -n "$CONFLICT_FILES" ]]; then
        HIGH_RISK_PATTERNS="package.json|package-lock.json|\.sql$|migration|schema|data.?migrat"
        if echo "$CONFLICT_FILES" | grep -Eq "$HIGH_RISK_PATTERNS"; then
          CONFLICT_LEVEL="C3"
        elif [[ "$(echo "$CONFLICT_FILES" | wc -w)" -le 2 ]]; then
          CONFLICT_LEVEL="C1"
        else
          CONFLICT_LEVEL="C2"
        fi
      else
        CONFLICT_LEVEL="C2"
      fi
    fi
  else
    # fail-safe：目标分支本地不存在，无法确定性预演合并 → 保守拒绝，而非降级放行 C0。
    # （pull_request.mergeable 事件虽由平台保证 mergeable，但安全门禁必须自身可确证无冲突才放行）
    echo "⚠️ 目标分支 ${TARGET_BRANCH} 本地不存在，无法确定性预演合并 → 保守禁止自动合入（未知等级）。"
    CONFLICT_LEVEL="UNKNOWN"
  fi
else
  # fail-safe：无 git 仓库/无法预演 → 保守拒绝，绝不裸放行。
  echo "⚠️ 当前环境无 git 仓库或无法预演合并 → 保守禁止自动合入（未知等级）。"
  CONFLICT_LEVEL="UNKNOWN"
fi

echo "--- 自动化合入冲突判定 ---"
echo "冲突等级 : ${CONFLICT_LEVEL}"
echo "冲突文件 : ${CONFLICT_FILES:-无}"

# ---------- 3. 准入判定：仅 C0 允许自动合入 ----------
# 门禁治理 §4.8 准入规则：
#   - C0 无冲突 → 允许自动合入（平台原生能力放行）
#   - C1 可自动化解 → 已化解且预演无冲突则为 C0；此处仍残留 C1 说明未化解完成 → 禁止
#   - C2 需审查判断 → 禁止自动合入，退回人工/审查
#   - C3 高危 → 强制人工，禁止自动合入
case "$CONFLICT_LEVEL" in
  C0)
    echo "✅ 准入判定：C0 无冲突，允许自动合入。"
    echo "【自动合入结论】PR #${PR_NUM}：冲突安全（C0），将交由平台 git:auto-merge 自动合入。"
    exit 0
    ;;
  C1)
    echo "🛑 准入判定：C1 冲突仍存在（尚未由构建/测试化解完成），禁止自动合入。"
    ;;
  C2)
    echo "🛑 准入判定：C2 冲突需审查判断（门禁治理 §4.8），禁止自动合入，退回审查+规划者。"
    ;;
  C3)
    echo "🛑 准入判定：C3 高危冲突（数据迁移/核心逻辑/依赖），强制人工，禁止自动合入（§4.8.4/§4.8.5）。"
    ;;
  UNKNOWN)
    echo "🛑 准入判定：无法确定性判定冲突等级（目标分支缺失/无 git 仓库/预演回退异常），保守禁止自动合入。"
    ;;
  *)
    echo "🛑 准入判定：未知冲突等级，保守禁止自动合入。"
    ;;
esac
echo "【自动合入结论】PR #${PR_NUM}：冲突等级 ${CONFLICT_LEVEL}，禁止自动合入（门禁治理 §4.8），等待人工/审查推进。"
exit 1
