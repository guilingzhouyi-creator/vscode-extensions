//! Module: fg-gate — Commit Style Guard
//! File Path: crates/fg-gate/src/commit_guard/style.rs
//! Architecture Role: Enforces the linguistic contract of a commit message: an imperative subject
//!   verb, an objective zero-person perspective, and canonical project nomenclature.
//! Dependencies & Triggers: Consumed by `commit_guard::verify` for the header and body.
//! Responsibilities: Detect narrative or past-tense subjects, first-person pronouns, and project
//!   name drift, reporting the exact word that triggered each finding.
//! Exit Semantics & Design Rationale: The tables are explicit rather than statistical. A commit
//!   history is a long-lived technical record, so the gate states which words are unacceptable
//!   instead of scoring tone, which would make the verdict depend on corpus tuning.
//!
//! Domain Governance Rules: FGT-MSG-004 (vocabulary), FGT-MSG-007 (project nomenclature).

use std::borrow::Cow;

/// A detected style violation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyleFinding {
    /// Rule identifier the finding attributes to.
    pub rule_id: &'static str,
    /// Offending word exactly as it appeared.
    pub token: String,
    /// Explanation aimed at the author.
    pub message: String,
}

/// Chinese verbs that may open an imperative subject.
const APPROVED_CHINESE_VERBS: &[&str] = &[
    "新增",
    "实现",
    "重构",
    "修复",
    "优化",
    "对齐",
    "消除",
    "加固",
    "演进",
    "登记",
    "消融",
    "提取",
    "完善",
    "升级",
    "降维",
    "收口",
    "支持",
    "规范",
    "统一",
    "引入",
    "删除",
    "移除",
    "补充",
    "初始化",
    "回滚",
    "加锁",
    "解耦",
    "重写",
    "配置",
    "接入",
    "封装",
    "调度",
    "清理",
    "压降",
    "同步",
    "导出",
    "合并",
    "拆分",
    "推进",
    "适配",
    "改进",
    "构建",
    "打包",
    "发布",
    "归档",
    "更新",
    "调整",
    "集成",
    "定义",
    "自愈",
    "拦截",
    "放行",
    "裁剪",
    "替换",
    "核算",
    "审计",
    "校验",
    "生成",
    "绑定",
    "迁移",
];

/// English imperative verbs that may open a subject.
const APPROVED_ENGLISH_VERBS: &[&str] = &[
    "add",
    "implement",
    "refactor",
    "fix",
    "optimize",
    "align",
    "eliminate",
    "harden",
    "evolve",
    "register",
    "extract",
    "enhance",
    "upgrade",
    "support",
    "standardize",
    "unify",
    "introduce",
    "remove",
    "supplement",
    "init",
    "revert",
    "decouple",
    "rewrite",
    "configure",
    "integrate",
    "encapsulate",
    "schedule",
    "clean",
    "sync",
    "export",
    "merge",
    "split",
    "adapt",
    "improve",
    "build",
    "package",
    "release",
    "archive",
    "update",
    "adjust",
    "define",
    "heal",
    "intercept",
    "replace",
    "audit",
    "validate",
    "generate",
    "bind",
    "migrate",
    "prevent",
    "resolve",
    "streamline",
    "record",
    "enforce",
    "verify",
    "expose",
    "retain",
    "guard",
];

/// Narrative or non-imperative openings that must not start a subject.
const DISALLOWED_PREFIXES: &[&str] = &[
    "修改了",
    "增加了",
    "修复了",
    "优化了",
    "完成了",
    "进行了",
    "做出了",
    "做了",
    "已修复",
    "已完成",
    "已通过",
    "已经",
    "被",
    "关于",
    "针对",
    "通过",
    "打算",
    "准备",
    "计划",
    "尝试",
    "开始",
    "想要",
    "希望",
    "拟",
    "本提交",
    "本次提交",
    "本次改动",
    "本次更新",
    "主要修复",
    "主要是",
    "主要",
];

/// First-person pronouns that break the zero-person perspective.
const FIRST_PERSON_PRONOUNS: &[&str] =
    &["我们", "我", "本Agent", "笔者", "团队", "俺", "咱", "本人"];

/// Compounds where the first-person character is a bound morpheme, not a narrator.
const BOUND_MORPHEME_COMPOUNDS: &[&str] = &["自我", "自举", "自身", "自省"];

/// Non-canonical project spellings mapped to their canonical form and pre-lowercased target.
const CANONICAL_PROJECT_TRIPLETS: &[(&str, &str, &str)] = &[
    ("autorefactor", "auto-refactor", "auto-refactor"),
    ("workspacetiming", "workspace-timing", "workspace-timing"),
    ("fractalgit", "fractal-git", "fractal-git"),
    ("网页游戏", "WebGames", "webgames"),
];

/// Checks the header subject for imperative mood.
///
/// Only the subject text after the `type(scope):` prefix is examined, because the type itself is
/// already a closed vocabulary.
pub fn check_imperative_subject(subject: &str) -> Option<StyleFinding> {
    let trimmed = subject.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(prefix) = DISALLOWED_PREFIXES
        .iter()
        .find(|prefix| trimmed.starts_with(**prefix))
    {
        return Some(StyleFinding {
            rule_id: fg_core::constants::rules::RULE_FGT_MSG_004,
            token: (*prefix).to_string(),
            message: format!(
                "Commit subject opens with narrative '{}'; state the action in the imperative instead",
                prefix
            ),
        });
    }

    let first_word = trimmed
        .split([' ', '　', '，', '。', '：', ':'])
        .find(|word| !word.is_empty())
        .unwrap_or("");
    let lower = first_word.to_lowercase();
    if APPROVED_ENGLISH_VERBS.contains(&lower.as_str()) {
        return None;
    }
    if APPROVED_CHINESE_VERBS
        .iter()
        .any(|verb| first_word.starts_with(*verb))
    {
        return None;
    }
    if is_likely_english_past_tense(&lower) {
        return Some(StyleFinding {
            rule_id: fg_core::constants::rules::RULE_FGT_MSG_004,
            token: first_word.to_string(),
            message: format!(
                "Commit subject opens with past-tense '{}'; use the base imperative verb",
                first_word
            ),
        });
    }
    None
}

/// Whether an English word looks like a past participle rather than an imperative.
fn is_likely_english_past_tense(word: &str) -> bool {
    if !word
        .chars()
        .all(|character| character.is_ascii_alphabetic())
    {
        return false;
    }
    const EXCEPTIONS: &[&str] = &["need", "seed", "feed", "embed", "bed", "red", "shed"];
    if EXCEPTIONS.contains(&word) || APPROVED_ENGLISH_VERBS.contains(&word) {
        return false;
    }
    word.ends_with("ed") && word.chars().count() > 3
}

/// Scans every line for first-person pronouns and non-canonical project names.
pub fn scan_body_lines(lines: &[&str]) -> Vec<StyleFinding> {
    let mut findings = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let masked_code = mask_code_spans(line);
        let masked_bound = mask_bound_morphemes(&masked_code);
        let lowered = if masked_bound.bytes().any(|byte| byte.is_ascii_uppercase()) {
            Cow::Owned(masked_bound.to_lowercase())
        } else if masked_bound.is_ascii() {
            masked_bound
        } else {
            Cow::Owned(masked_bound.to_lowercase())
        };

        if let Some(pronoun) = find_first_person_pronoun(&lowered) {
            findings.push(StyleFinding {
                rule_id: fg_core::constants::rules::RULE_FGT_MSG_004,
                token: pronoun.to_string(),
                message: format!(
                    "Commit message uses first-person '{}'; a version history is written in the objective voice",
                    pronoun
                ),
            });
        }

        for &(misnomer, canonical, canonical_lower) in CANONICAL_PROJECT_TRIPLETS {
            if lowered.contains(misnomer) && !lowered.contains(canonical_lower) {
                findings.push(StyleFinding {
                    rule_id: fg_core::constants::rules::RULE_FGT_MSG_007,
                    token: misnomer.to_string(),
                    message: format!(
                        "Commit message spells the project '{}'; the canonical name is '{}'",
                        misnomer, canonical
                    ),
                });
            }
        }
    }
    findings
}

/// Finds the first matching first-person pronoun, skipping ASCII lines that cannot match.
fn find_first_person_pronoun(lowered: &str) -> Option<&'static str> {
    if lowered.is_ascii() {
        return None;
    }
    FIRST_PERSON_PRONOUNS
        .iter()
        .find(|pronoun| lowered.contains(**pronoun))
        .copied()
}

/// Blanks out inline code spans so quoted identifiers are not mistaken for prose.
fn mask_code_spans<'a>(line: &'a str) -> Cow<'a, str> {
    if !line.contains('`') {
        return Cow::Borrowed(line);
    }
    let mut output = String::with_capacity(line.len());
    let mut in_code = false;
    for character in line.chars() {
        if character == '`' {
            in_code = !in_code;
            output.push(' ');
            continue;
        }
        output.push(if in_code { ' ' } else { character });
    }
    Cow::Owned(output)
}

/// Blanks out bound-morpheme compounds before the pronoun scan.
fn mask_bound_morphemes<'a>(line: &'a str) -> Cow<'a, str> {
    if !line.contains('自') {
        return Cow::Borrowed(line);
    }
    if !BOUND_MORPHEME_COMPOUNDS
        .iter()
        .any(|compound| line.contains(compound))
    {
        return Cow::Borrowed(line);
    }
    let mut masked = line.to_string();
    for compound in BOUND_MORPHEME_COMPOUNDS {
        if masked.contains(compound) {
            masked = masked.replace(compound, " ");
        }
    }
    Cow::Owned(masked)
}
