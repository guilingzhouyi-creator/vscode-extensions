#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地提交前置门禁)
# 文件路径: scripts/sh/pre-commit-gate.sh
# 架构定位: 本地 Git 提交前置物理卫生与质量安全门禁 (Linux Bash)
# 依赖与触发: 触发方: .githooks/pre-commit / 本地 CLI 手动触发 | 上游: git commit | 下游: 提交暂存区 | 运行时: Bash 4+
# 职责说明: 执行提交前物理卫生与质量安全检查（换行契约、BOM、物理空文件、尾随空白、敏感词、AST 局部切片等）
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在卫生或质量违规阻断 | 设计依据: AGENTS.md 跨项目全局通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/pre-commit-gate.sh
# ==============================================================================
set -euo pipefail

echo "================================================================="
echo "🔒 执行本地 Pre-Commit 质量安全与物理卫生检查"
echo "================================================================="

NODE_BIN=$(command -v node 2>/dev/null || command -v node.exe 2>/dev/null || echo "node")
NPM_BIN=$(command -v npm 2>/dev/null || command -v npm.cmd 2>/dev/null || echo "npm")

# 获取当前暂存区中的文件列表（新增、修改、重命名）
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)

if [[ -z "$STAGED_FILES" ]]; then
    echo "ℹ️  暂存区无文件变更，跳过 pre-commit 检查。"
    exit 0
fi

FAILED=0

# --- Gate 1: 零 0 字节与纯空白空文件一票阻断 ---
echo "[1/9] 检查暂存区零空文件守卫..."
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if [[ -f "$file" ]]; then
        file_size=$(stat -c%s "$file" 2>/dev/null || wc -c < "$file" 2>/dev/null || echo "0")
        if [[ "$file_size" -eq 0 ]]; then
            echo "❌ [FAIL] Gate 1: 发现 0 字节物理空文件: $file"
            FAILED=1
        else
            non_ws=$(tr -d ' \t\r\n' < "$file" | wc -c 2>/dev/null || echo "0")
            if [[ "$non_ws" -eq 0 ]]; then
                echo "❌ [FAIL] Gate 1: 发现仅含空白字符的虚空文件: $file"
                FAILED=1
            fi
        fi
    fi
done <<< "$STAGED_FILES"

# --- Gate 2: 换行符 (EOL: ps1->CRLF, 其余->LF) 契约看守 ---
echo "[2/9] 检查换行符 (EOL: ps1->CRLF, 其余->LF) 契约..."
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if [[ -f "$file" ]]; then
        HAS_CR=0
        if grep -q $'\r' "$file" 2>/dev/null; then
            HAS_CR=1
        fi
        if [[ "$file" == *.ps1 ]]; then
            if [[ "$HAS_CR" != "1" ]]; then
                echo "❌ [FAIL] Gate 2: PowerShell 脚本必须使用 CRLF 换行符: $file"
                FAILED=1
            fi
        elif [[ "$file" == *.sh || "$file" == *.ts || "$file" == *.js || "$file" == *.gd || "$file" == *.json || "$file" == *.md ]]; then
            if [[ "$HAS_CR" == "1" ]]; then
                echo "❌ [FAIL] Gate 2: 代码/文档必须使用 LF 换行符，检测到 CRLF: $file"
                FAILED=1
            fi
        fi
    fi
done <<< "$STAGED_FILES"

# --- Gate 3: 绝对路径与盘符防泄漏 ---
echo "[3/9] 检查绝对路径与协议防泄漏..."
ADDED_DIFF=$(git diff --cached -U0 --no-color 2>/dev/null | grep '^+[^+]' || true)
if echo "$ADDED_DIFF" | grep -E "(file:///|[c-zC-Z]:\\\\|[c-zC-Z]:/)" | grep -v -E "(file://|\.gemini|node_modules)" >/dev/null 2>&1; then
    VIOLATING_LINES=$(echo "$ADDED_DIFF" | grep -E "(\b[A-Za-z]:[\\\\/][a-zA-Z0-9_-]+|file:///)" | grep -v "file://" || true)
    if [[ -n "$VIOLATING_LINES" ]]; then
        echo "❌ [FAIL] Gate 3: 检测到新增代码中包含绝对路径或盘符泄漏:"
        echo "$VIOLATING_LINES" | head -n 5
        FAILED=1
    fi
fi

# --- Gate 4: 零黑话与规范命名 ---
echo "[4/9] 检查零黑话与规范命名..."
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    basename_file=$(basename "$file")
    if [[ "$file" =~ WebGames/docs/路线图/ || "$file" =~ WebGames/docs/归档库/ || "$basename_file" =~ ^fe_[0-9]{2} ]]; then
        continue
    fi
    if echo "$basename_file" | grep -iE "(^|[-_.])(temp|wip|new|st[0-9]+|p[0-9]+)([-_.]|$)" >/dev/null 2>&1; then
        echo "❌ [FAIL] Gate 4: 文件名包含临时性违规黑话标记: $file"
        FAILED=1
    fi
done <<< "$STAGED_FILES"

# --- Gate 5: 检查源文件双轨体积预算 (ELOC <= 800, LOC <= 1200) ---
echo "[5/9] 检查源文件双轨体积预算 (ELOC <= 800, LOC <= 1200)..."
if [[ -f "scripts/common/evaluate-eloc-budget.js" ]]; then
    if ! "$NODE_BIN" scripts/common/evaluate-eloc-budget.js --staged --max-eloc 800 --max-loc 1200; then
        echo "❌ [FAIL] Gate 5: 暂存区存在文件超出双轨体积预算 (ELOC > 800 或 LOC > 1200)"
        FAILED=1
    fi
else
    MAX_LOC_BUDGET=1200
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if [[ -f "$file" && ( "$file" == *.ts || "$file" == *.gd || "$file" == *.js ) ]]; then
            if [[ "$file" == *dist/* || "$file" == *out/* || "$file" == *fixtures/* || "$file" == *baseline* || "$file" == *reports/* ]]; then
                continue
            fi
            loc=$(wc -l < "$file" 2>/dev/null || echo "0")
            if [[ "$loc" -gt "$MAX_LOC_BUDGET" ]]; then
                echo "❌ [FAIL] Gate 5: 单文件行数超标 ($loc > $MAX_LOC_BUDGET LOC): $file"
                FAILED=1
            fi
        fi
    done <<< "$STAGED_FILES"
fi

# --- Gate 6: 密钥与敏感 Token 防泄漏扫描 ---
echo "[6/9] 扫描高危密钥与敏感 Token 防泄漏..."
SECRET_PATTERN='(AIza[0-9A-Za-z_-]{35}|sk-[a-zA-Z0-9]{32,}|ghp_[a-zA-Z0-9]{36}|-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----)'
SECRET_MATCH=$(echo "$ADDED_DIFF" | grep -E "$SECRET_PATTERN" | grep -v -E "(\$\{env:|CODEX_API_KEY|OPENAI_API_KEY|test-secret|mock-key|placeholder)" || true)
if [[ -n "$SECRET_MATCH" ]]; then
    echo "❌ [FAIL] Gate 6: 检测到暂存代码中疑似包含未脱敏的真实密钥或私钥！"
    echo "$SECRET_MATCH" | head -n 3
    FAILED=1
else
    echo "  ✔ [PASS] 密钥扫描无泄漏"
fi

# --- Gate 7: 单源规则漂移熔断 ---
echo "[7/9] 校验单源规则元数据一致性..."
if [[ "$STAGED_FILES" =~ auto-refactor/src/core/rules/ || "$STAGED_FILES" =~ auto-refactor/src/analyzers/ ]]; then
    if ! "$NODE_BIN" auto-refactor/scripts/validate-rules-registry.js >/dev/null 2>&1; then
        echo "❌ [FAIL] Gate 7: 规则注册表元数据发生漂移 (RCFG-RULE-DRIFT)！"
        FAILED=1
    else
        echo "  ✔ [PASS] 规则元数据单源一致性校验通过"
    fi
fi

# --- Gate 8: 项目增量编译与语法验证 ---
echo "[8/9] 检查相关项目增量编译与语法..."
TOUCHED_WT=$(echo "$STAGED_FILES" | grep '^workspace-timing/' || true)
TOUCHED_AR=$(echo "$STAGED_FILES" | grep '^auto-refactor/' || true)
TOUCHED_WG=$(echo "$STAGED_FILES" | grep '^WebGames/' || true)

if [[ -n "$TOUCHED_WT" ]]; then
    echo "  ▶ 触发 workspace-timing 增量编译校验..."
    if ! "$NPM_BIN" --prefix workspace-timing run compile >/dev/null 2>&1; then
        echo "❌ [FAIL] Gate 8: workspace-timing 编译失败！"
        FAILED=1
    fi
fi

if [[ -n "$TOUCHED_AR" ]]; then
    echo "  ▶ 触发 auto-refactor 增量编译校验..."
    if ! "$NPM_BIN" --prefix auto-refactor run build >/dev/null 2>&1; then
        echo "❌ [FAIL] Gate 8: auto-refactor 编译失败！"
        FAILED=1
    fi
fi

if [[ -n "$TOUCHED_WG" ]]; then
    echo "  ▶ 触发 WebGames 增量配置架构审查..."
    PYTHON_BIN=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || command -v py 2>/dev/null || echo "python3")
    if ! "$PYTHON_BIN" WebGames/scripts/py/audit_config.py --strict >/dev/null 2>&1; then
        echo "❌ [FAIL] Gate 8: WebGames 配置架构审查未通过！"
        FAILED=1
    fi
fi

# --- Gate 9: 暂存区增量 AST 切片质量与复杂度审查 ---
echo "[9/9] 审查暂存区 AST 切片复杂度与代码稀释 (CC<=15, Depth<=4, Noise<=4.0)..."
TOUCHED_CODE=$(echo "$STAGED_FILES" | grep -E '\.(ts|js)$' | grep -v -E '(\.d\.ts|dist/|out/|fixtures/)' || true)
if [[ -n "$TOUCHED_CODE" ]]; then
    if ! "$NODE_BIN" auto-refactor/scripts/validate-staged-slice.js; then
        echo "❌ [FAIL] Gate 9: 暂存区 AST 切片审查未通过！"
        FAILED=1
    fi
else
    echo "  ✔ [PASS] 无暂存 TS/JS 代码需执行 AST 切片审查"
fi

echo "================================================================="
if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ 【门禁结论】Pre-Commit 检查未通过，已阻断提交！请根据上方提示修复后重试。"
    echo "================================================================="
    exit 1
else
    echo "✅ Pre-Commit 检查通过"
    echo "================================================================="
    exit 0
fi
