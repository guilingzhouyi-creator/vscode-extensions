//! Module: fg-gate — Commit Lexicon Guard
//! File Path: crates/fg-gate/src/commit_guard/lexicon.rs
//! Architecture Role: Detects provisional vocabulary, stylistic hyperbole, batch codenames and
//!   unresolved markers in a commit message, with code-span masking and whitelist subtraction.
//! Dependencies & Triggers: Consumed by `commit_guard::verify` after section resolution.
//! Responsibilities: Mask inline code and URLs, match whole tokens rather than substrings, subtract
//!   the shared whitelist, and report the exact token and line that triggered a finding.
//! Exit Semantics & Design Rationale: Matching is token-anchored because substring matching made
//!   a short provisional stem fire on a longer legitimate word (for example the abbreviation inside
//!   "commit template") and rejected engineering prose. A finding always names the token, so an
//!   author can act on it without re-reading the whole rule table.
//!
//! Domain Governance Rules: FGT-MSG-004 (vocabulary), FGT-MSG-005 (unresolved markers),
//!   FGT-MSG-008 (batch codenames).

use std::borrow::Cow;

/// A detected lexical violation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LexiconFinding {
    /// Rule identifier that the finding attributes to.
    pub rule_id: &'static str,
    /// Offending token exactly as it appeared.
    pub token: String,
    /// One-based line number inside the message.
    pub line: usize,
    /// Human readable explanation.
    pub message: String,
}

/// Provisional or offhand wording that must not stand in for a technical statement.
const PROVISIONAL_TERMS: &[&str] = &[
    "wip",
    "temp",
    "tmp",
    "hack",
    "hacky",
    "hacks",
    "placeholder",
    "placeholders",
    "bandaid",
    "stopgap",
    "patchy",
    "tentative",
    "provisional",
    "临时",
    "暂存",
    "暂时",
    "凑合",
    "随便",
    "粗略",
    "先这样",
    "待处理",
    "后续再看",
    "占位",
    "随便改改",
    "打补丁",
    "临时方案",
    "草率",
];

/// Stylistic hyperbole that asserts quality instead of describing behaviour.
const HYPERBOLE_TERMS: &[&str] = &[
    "perfect",
    "perfection",
    "flawless",
    "ultimate",
    "bulletproof",
    "unbeatable",
    "invincible",
    "godtier",
    "peerless",
    "industrialgrade",
    "enterprisegrade",
    "stateoftheart",
    "bestinclass",
    "oracle",
    "oracles",
    "绝对",
    "彻底",
    "完美",
    "完美无瑕",
    "极致",
    "终极",
    "史无前例",
    "彻底解决",
    "完全消除",
    "永不",
    "绝不",
    "绝无",
    "工业级",
    "顶尖",
    "顶级",
    "天花板",
    "最强",
    "无懈可击",
    "超强",
    "万能",
    "零缺陷",
    "永不崩溃",
    "九重门禁",
    "9重防御",
    "九重防御",
    "案卷施工",
    "四阶段案卷",
    "规则金字塔",
    "神喻",
    "神谕",
];

/// Peerless and dismissive wording that carries no technical meaning.
const DISMISSIVE_TERMS: &[&str] = &[
    "garbage",
    "rubbish",
    "trash",
    "shitty",
    "horrible",
    "terrible",
    "worthless",
    "disaster",
    "catastrophe",
    "useless",
    "idiotic",
    "垃圾",
    "一团糟",
    "稀烂",
    "稀碎",
    "毫无意义",
    "彻底失败",
    "毫无价值",
    "致命缺陷",
    "严重崩溃",
    "烂代码",
    "废物",
];

/// Promotional and meta narrative vocabulary.
const PROMOTIONAL_TERMS: &[&str] = &[
    "gamechanger",
    "groundbreaking",
    "paradigmshift",
    "revolutionary",
    "monumental",
    "milestone",
    "humble",
    "pragmatic",
    "pragmatism",
    "低调中肯",
    "求真务实",
    "宣扬性词汇",
    "移除宣扬性词汇",
    "调整文案语调",
    "风格升级",
    "实事求是",
    "语调优化",
    "拒绝浮夸",
    "自吹自擂",
    "标杆",
    "跨时代",
    "划时代",
    "重磅",
    "里程碑式",
    "突破性",
    "颠覆性",
    "重塑",
    "飞跃",
    "震撼",
    "史诗级",
    "跨越式",
    "全部pass",
    "全部通过",
    "退出码0全部验证完毕",
    "门禁全部pass",
    "全部验证完毕",
    "完美闭环",
    "彻底清零",
    "全量通过并合规",
    "零违规零错误",
    "零缺陷全部达标",
];

/// Subset of provisional terms in CJK script that require containment matching.
const CJK_PROVISIONAL_TERMS: &[&str] = &[
    "临时",
    "暂存",
    "暂时",
    "凑合",
    "随便",
    "粗略",
    "先这样",
    "待处理",
    "后续再看",
    "占位",
    "随便改改",
    "打补丁",
    "临时方案",
    "草率",
    "绝对",
    "彻底",
    "完美",
    "完美无瑕",
    "极致",
    "终极",
    "史无前例",
    "彻底解决",
    "完全消除",
    "永不",
    "绝不",
    "绝无",
    "工业级",
    "顶尖",
    "顶级",
    "天花板",
    "最强",
    "无懈可击",
    "超强",
    "万能",
    "零缺陷",
    "永不崩溃",
    "九重门禁",
    "9重防御",
    "九重防御",
    "案卷施工",
    "四阶段案卷",
    "规则金字塔",
    "神喻",
    "神谕",
    "垃圾",
    "一团糟",
    "稀烂",
    "稀碎",
    "毫无意义",
    "彻底失败",
    "毫无价值",
    "致命缺陷",
    "严重崩溃",
    "烂代码",
    "废物",
    "低调中肯",
    "求真务实",
    "宣扬性词汇",
    "移除宣扬性词汇",
    "调整文案语调",
    "风格升级",
    "实事求是",
    "语调优化",
    "拒绝浮夸",
    "自吹自擂",
    "标杆",
    "跨时代",
    "划时代",
    "重磅",
    "里程碑式",
    "突破性",
    "颠覆性",
    "重塑",
    "飞跃",
    "震撼",
    "史诗级",
    "跨越式",
    "全部pass",
    "全部通过",
    "退出码0全部验证完毕",
    "门禁全部pass",
    "全部验证完毕",
    "完美闭环",
    "彻底清零",
    "全量通过并合规",
    "零违规零错误",
    "零缺陷全部达标",
];

/// Bilingual engineering vocabulary exempted before token and phrase matching.
const WHITELIST_PHRASES: &[&str] = &[
    "临时文件",
    "临时目录",
    "临时语料目录",
    "临时语料",
    "临时表",
    "临时对象",
    "临时缓冲区",
    "临时变量",
    "临时存储",
    "暂存区",
    "暂存切片",
    "占位符",
    "格式占位符",
    "模板占位符",
    "参数占位符",
    "占位内容",
    "占位参数",
    "占位节点",
    "空占位",
    "占位字符",
    "绝对路径",
    "绝对地址",
    "绝对值",
    "绝对像素尺寸",
    "绝对坐标",
    "绝对定位",
    "全量编译",
    "全量检查点",
    "完全限定名",
    "垃圾回收",
    "测试神谕",
    "断言神谕",
    "脆性神谕",
    "差分神谕",
    "神谕基准",
    "神谕验证",
    "测试神喻",
    "断言神喻",
    "差分神喻",
    "测试预言机",
    "断言预言机",
    "差分预言机",
    "test oracle",
    "brittle oracle",
    "assertion oracle",
    "differential oracle",
    "absolute path",
    "absolute address",
    "absolute value",
    "absolute coordinate",
    "absolute position",
    "temp file",
    "temporary file",
    "temporary directory",
    "temporary table",
    "temporary object",
    "temporary buffer",
    "temporary variable",
    "temporary storage",
    "full build",
    "full checkpoint",
    "garbage collection",
    "garbage collector",
    "garbage-collected",
    "garbage-collection",
    "quick fix action",
    "quick-fix action",
    "format placeholder",
    "template placeholder",
    "parameter placeholder",
    "empty placeholder",
    "placeholder node",
    "placeholder pattern",
    "placeholder bag",
    "placeholder archive",
    "vacuous placeholder",
    "positional placeholder",
    "staging area",
    "two-pass",
    "multi-pass",
    "single-pass",
    "pass by value",
    "pass by reference",
    "pass parameter",
    "pass parameters",
    "pass argument",
    "pass arguments",
    "pass through",
    "pass-through",
    "passing parameter",
    "passing parameters",
    "passing argument",
    "passing arguments",
    "passing options",
    "message passing",
];

/// Unresolved markers that defer a decision instead of stating one.
const UNRESOLVED_MARKERS: &[&str] = &[
    "todo",
    "fixme",
    "tbd",
    "xxx",
    "待补充",
    "待确认",
    "待办",
    "未完待续",
];

/// Scans a full commit message for lexical violations.
///
/// Returns findings in message order. Code spans and URLs are masked first so a term quoted as
/// code is not treated as prose.
///
/// Also returns the masked and whitelist-subtracted text, because the policy-specific term check
/// needs exactly that intermediate result. Recomputing it separately meant the whole message was
/// masked, lowered and scrubbed twice per commit.
pub fn scan(message: &str) -> (Vec<LexiconFinding>, String) {
    let mut findings = Vec::new();
    let mut prepared = String::with_capacity(message.len());
    for (index, raw_line) in message.lines().enumerate() {
        let line_number = index + 1;
        let masked = mask_uppercase_rule_ids(raw_line);
        // Whitelisted phrases are removed before tokenizing, not compared afterwards.
        // CJK has no word delimiters, so `临时文件` arrives as one token and an equality test
        // against the whitelist would only ever match a line that was *exactly* the phrase.
        // Subtracting the phrase from the text is the only way containment can be made honest.
        let lower_line: Cow<'_, str> = if masked.bytes().any(|byte| byte.is_ascii_uppercase()) {
            Cow::Owned(masked.to_lowercase())
        } else if masked.is_ascii() {
            masked
        } else {
            Cow::Owned(masked.to_lowercase())
        };
        let scrubbed = subtract_whitelist(&lower_line);
        prepared.push_str(&scrubbed);
        prepared.push('\n');
        for_each_token(&scrubbed, |token| {
            if let Some(rule) = classify_token(token) {
                findings.push(LexiconFinding {
                    rule_id: rule,
                    token: token.to_string(),
                    line: line_number,
                    message: describe_token(rule, token),
                });
            }
        });

        if let Some(marker) = find_unresolved_marker(&scrubbed) {
            findings.push(LexiconFinding {
                rule_id: fg_core::constants::rules::RULE_FGT_MSG_005,
                token: marker,
                line: line_number,
                message: "Commit message defers a decision instead of stating a verified fact"
                    .to_string(),
            });
        }

        if let Some(code) = find_batch_codename(&scrubbed) {
            findings.push(LexiconFinding {
                rule_id: fg_core::constants::rules::RULE_FGT_MSG_008,
                token: code,
                line: line_number,
                message: "Commit message names a construction batch instead of a technical fact"
                    .to_string(),
            });
        }

        if let Some(placeholder) = find_template_placeholder(raw_line) {
            findings.push(LexiconFinding {
                rule_id: fg_core::constants::rules::RULE_FGT_MSG_005,
                token: placeholder,
                line: line_number,
                message: "Commit message still contains an unreplaced template placeholder"
                    .to_string(),
            });
        }
    }
    (findings, prepared)
}

/// Replaces inline code spans and URLs with spaces so their contents are never scanned.
fn is_uppercase_rule_shape(token: &str) -> bool {
    let mut seg_count = 0usize;
    let mut head_ok = false;
    let mut seg_start = 0usize;
    let bytes = token.as_bytes();
    for idx in 0..=bytes.len() {
        if idx == bytes.len() || bytes[idx] == b'-' {
            let seg = &token[seg_start..idx];
            if seg.is_empty()
                || !seg
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
            {
                return false;
            }
            if seg_count == 0 {
                head_ok = (2..=6).contains(&seg.len())
                    && seg.bytes().all(|byte| byte.is_ascii_uppercase());
            }
            seg_count += 1;
            seg_start = idx + 1;
        }
    }
    head_ok && seg_count >= 3
}

fn mask_uppercase_rule_ids(line: &str) -> Cow<'_, str> {
    if !line.contains('-') || !line.bytes().any(|byte| byte.is_ascii_uppercase()) {
        return Cow::Borrowed(line);
    }
    let bytes = line.as_bytes();
    let mut masked: Option<Vec<u8>> = None;
    let mut idx = 0usize;
    while idx < bytes.len() {
        if bytes[idx].is_ascii_uppercase() {
            let start = idx;
            while idx < bytes.len()
                && (bytes[idx].is_ascii_uppercase()
                    || bytes[idx].is_ascii_digit()
                    || bytes[idx] == b'-')
            {
                idx += 1;
            }
            let slice = &line[start..idx];
            let prev_ok = start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
            let next_ok = idx == bytes.len() || !bytes[idx].is_ascii_alphanumeric();
            if prev_ok && next_ok && is_uppercase_rule_shape(slice) {
                let buf = masked.get_or_insert_with(|| line.as_bytes().to_vec());
                buf[start..idx].fill(b' ');
            }
        } else {
            idx += 1;
        }
    }
    match masked {
        Some(buf) => match String::from_utf8(buf) {
            Ok(text) => Cow::Owned(text),
            Err(_) => Cow::Borrowed(line),
        },
        None => Cow::Borrowed(line),
    }
}

/// Prepares a message for policy-specific term matching.
///
/// Retained for callers that only need the prepared text; [`scan`] returns the same text alongside
/// its findings so the common path masks and scrubs once.
pub fn scrub_for_policy_terms(message: &str) -> String {
    scan(message).1
}

/// Removes whitelisted phrases from already-masked, lower-cased text.
///
/// Longer phrases are subtracted first so `临时文件` or `quick fix action` is removed before a
/// prohibited sub-term could fire, and each removal leaves whitespace behind so surrounding tokens
/// remain delimited.
fn subtract_whitelist<'a>(lower: &'a str) -> Cow<'a, str> {
    if !WHITELIST_PHRASES
        .iter()
        .any(|phrase| lower.contains(phrase))
    {
        return Cow::Borrowed(lower);
    }
    static ORDERED: std::sync::OnceLock<Vec<&'static str>> = std::sync::OnceLock::new();
    let ordered = ORDERED.get_or_init(|| {
        let mut phrases: Vec<&'static str> = WHITELIST_PHRASES.to_vec();
        phrases.sort_by_key(|phrase| std::cmp::Reverse(phrase.chars().count()));
        phrases
    });
    let mut scrubbed = lower.to_string();
    for phrase in ordered {
        if scrubbed.contains(phrase) {
            scrubbed = scrubbed.replace(phrase, " ");
        }
    }
    Cow::Owned(scrubbed)
}

/// Splits lower-cased text into word and CJK-run tokens and delivers each to a callback.
///
/// Avoids vector allocation entirely on the critical path.
fn for_each_token<'a, F: FnMut(&'a str)>(lower: &'a str, mut callback: F) {
    let mut start: Option<usize> = None;
    let mut current_is_cjk = false;
    for (offset, character) in lower.char_indices() {
        let is_cjk = is_cjk_char(character);
        let is_word = character.is_alphanumeric() || is_cjk || character == '_';
        if !is_word {
            if let Some(begin) = start.take() {
                callback(&lower[begin..offset]);
            }
            continue;
        }
        match start {
            None => {
                start = Some(offset);
                current_is_cjk = is_cjk;
            }
            Some(begin) => {
                if is_cjk != current_is_cjk {
                    callback(&lower[begin..offset]);
                    start = Some(offset);
                    current_is_cjk = is_cjk;
                }
            }
        }
    }
    if let Some(begin) = start {
        callback(&lower[begin..]);
    }
}

/// Splits lower-cased text into word and CJK-run tokens.
///
/// Retained for external callers; internally `for_each_token` operates with zero vector allocations.
#[allow(dead_code)]
pub fn tokenize(lower: &str) -> Vec<&str> {
    let mut tokens = Vec::with_capacity(lower.len() / 8 + 4);
    for_each_token(lower, |token| tokens.push(token));
    tokens
}

/// Whether a character belongs to a CJK block.
fn is_cjk_char(character: char) -> bool {
    let code = character as u32;
    (0x3040..=0x30FF).contains(&code)
        || (0x3400..=0x4DBF).contains(&code)
        || (0x4E00..=0x9FFF).contains(&code)
        || (0xF900..=0xFAFF).contains(&code)
}

/// Maps one token to the rule it violates, if any.
///
/// ASCII terms must match the token exactly: containment made a short provisional stem match a
/// longer legitimate word (the abbreviation inside the word "template"), which rejected ordinary
/// engineering prose. CJK has no word delimiters, so a CJK term is still matched by containment —
/// otherwise a compound like the temporary-file phrase could never be caught.
fn classify_token(token: &str) -> Option<&'static str> {
    if token.is_ascii() {
        if sorted_all_forbidden_table().binary_search(&token).is_ok() {
            return Some(fg_core::constants::rules::RULE_FGT_MSG_004);
        }
        return None;
    }

    if CJK_PROVISIONAL_TERMS
        .iter()
        .any(|term| token.contains(term))
    {
        return Some(fg_core::constants::rules::RULE_FGT_MSG_004);
    }
    if sorted_all_forbidden_table().binary_search(&token).is_ok() {
        return Some(fg_core::constants::rules::RULE_FGT_MSG_004);
    }
    None
}

/// Returns a pre-sorted, process-lifetime table of all forbidden vocabulary.
fn sorted_all_forbidden_table() -> &'static [&'static str] {
    static ALL_FORBIDDEN: std::sync::OnceLock<Vec<&'static str>> = std::sync::OnceLock::new();
    ALL_FORBIDDEN.get_or_init(|| {
        let mut combined = Vec::with_capacity(
            PROVISIONAL_TERMS.len()
                + HYPERBOLE_TERMS.len()
                + DISMISSIVE_TERMS.len()
                + PROMOTIONAL_TERMS.len(),
        );
        combined.extend_from_slice(PROVISIONAL_TERMS);
        combined.extend_from_slice(HYPERBOLE_TERMS);
        combined.extend_from_slice(DISMISSIVE_TERMS);
        combined.extend_from_slice(PROMOTIONAL_TERMS);
        combined.sort_unstable();
        combined.dedup();
        combined
    })
}

/// Builds the diagnostic for one vocabulary finding.
fn describe_token(rule_id: &str, token: &str) -> String {
    format!(
        "Commit message uses vocabulary '{}' that describes intent rather than behaviour (rule {})",
        token, rule_id
    )
}

/// Finds the first unresolved marker on a masked, lower-cased line.
fn find_unresolved_marker(lower_line: &str) -> Option<String> {
    if lower_line.is_ascii() {
        const ASCII_MARKERS: &[&str] = &["todo", "fixme", "tbd", "xxx"];
        ASCII_MARKERS
            .iter()
            .find(|marker| lower_line.contains(**marker))
            .map(|marker| (*marker).to_string())
    } else {
        UNRESOLVED_MARKERS
            .iter()
            .find(|marker| lower_line.contains(**marker))
            .map(|marker| (*marker).to_string())
    }
}

/// Finds a construction batch codename built from a schedule word plus an ordinal.
///
/// A bare codename (`<prefix><ordinal>`) anywhere on the line wins over a two-word
/// pairing, which is the precedence the two separate passes established: the bare-token pass
/// completed before the pairing pass started. One walk is enough to honour that, because the
/// pairing candidate can be remembered and only returned once the walk has proven no bare
/// codename exists further along.
///
/// The previous form ran `split_whitespace` twice and `trim_matches` on every word in each walk,
/// so each word paid the `char`-predicate trimming cost twice.
fn find_batch_codename(lower_line: &str) -> Option<String> {
    let mut previous: Option<&str> = None;
    let mut pairing: Option<String> = None;
    for raw_word in lower_line.split_whitespace() {
        let cleaned = raw_word.trim_matches(|character: char| !character.is_alphanumeric());
        if cleaned.is_empty() {
            continue;
        }
        // A bare codename outranks any pairing seen earlier.
        if is_batch_token(cleaned) {
            return Some(cleaned.to_string());
        }
        if pairing.is_none() {
            if let Some(first) = previous {
                if matches!(first, "sprint" | "pass" | "phase" | "段" | "批次")
                    && cleaned.chars().all(|character| character.is_ascii_digit())
                {
                    pairing = Some(format!("{first} {cleaned}"));
                }
            }
        }
        previous = Some(cleaned);
    }
    pairing
}

/// Whether a single token is a bare batch codename.
fn is_batch_token(token: &str) -> bool {
    if let Some(rest) = token.strip_prefix("phase") {
        return !rest.is_empty() && rest.chars().all(|character| character.is_ascii_digit());
    }
    if let Some(rest) = token.strip_prefix("sprint") {
        return !rest.is_empty() && rest.chars().all(|character| character.is_ascii_digit());
    }
    if let Some(rest) = token.strip_prefix('w') {
        return rest.len() == 1 && rest.chars().all(|character| character.is_ascii_digit());
    }
    false
}

/// Finds an unreplaced `<...>` template placeholder.
fn find_template_placeholder(line: &str) -> Option<String> {
    let start = line.find('<')?;
    let rest = &line[start..];
    let end = rest.find('>')?;
    let inner = &rest[1..end];
    if inner.is_empty() || inner.chars().count() > 40 {
        return None;
    }
    let looks_like_template = inner
        .chars()
        .all(|character| character.is_alphanumeric() || "-_/ |、".contains(character));
    let looks_like_markup = inner.contains("://") || inner.contains('=');
    if looks_like_template && !looks_like_markup {
        return Some(rest[..=end].to_string());
    }
    None
}

/// Whether `haystack` contains `needle` as a whole word rather than as a substring.
pub fn contains_whole_term(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let has_cjk = needle.chars().any(|character| {
        let code = character as u32;
        (0x3400..=0x9FFF).contains(&code)
    });
    if has_cjk {
        return haystack.contains(needle);
    }
    let mut search_from = 0;
    while let Some(offset) = haystack[search_from..].find(needle) {
        let start = search_from + offset;
        let end = start + needle.len();
        let bytes = haystack.as_bytes();
        let before_ok = start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
        let after_ok = end == bytes.len() || !bytes[end].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        search_from = end;
        if search_from >= haystack.len() {
            break;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reference form of [`find_batch_codename`]: two separate passes, the shape this function
    /// used before the single-pass rewrite.
    ///
    /// Kept only as a test oracle. The shipping version must agree with it on every input,
    /// including inputs where a bare codename and a schedule-word pairing appear on the same
    /// word, which is the case the merge order could plausibly get wrong.
    fn reference_find_batch_codename(lower_line: &str) -> Option<String> {
        for raw_word in lower_line.split_whitespace() {
            let cleaned = raw_word.trim_matches(|character: char| !character.is_alphanumeric());
            if !cleaned.is_empty() && is_batch_token(cleaned) {
                return Some(cleaned.to_string());
            }
        }
        let mut prev_word: Option<&str> = None;
        for raw_word in lower_line.split_whitespace() {
            let cleaned = raw_word.trim_matches(|character: char| !character.is_alphanumeric());
            if let Some(first) = prev_word {
                if matches!(first, "sprint" | "pass" | "phase" | "段" | "批次")
                    && cleaned.chars().all(|character| character.is_ascii_digit())
                    && !cleaned.is_empty()
                {
                    return Some(format!("{} {}", first, cleaned));
                }
            }
            if !cleaned.is_empty() {
                prev_word = Some(cleaned);
            }
        }
        None
    }

    #[test]
    fn single_pass_matches_the_two_pass_reference_on_realistic_lines() {
        let cases = [
            "",
            "plain commit message with no codename",
            "phase3 rollout",
            "sprint 2 closed",
            "phase 10",
            "段 5 完成",
            "批次 12",
            "w1 patch",
            "w9",
            "see phase3 and also sprint 2",
            // Bare codename appears *after* a schedule-word pairing: the two-pass form would
            // find the bare token first; the one-pass form must not return the pairing instead.
            "sprint 2 then w3",
            "phase 7 then sprint4",
            // Schedule word with no ordinal following it.
            "phase",
            "sprint",
            // Ordinal alone, no schedule word.
            "42",
            "release 1.2.3",
            // Punctuation-only words must not confuse the trimming.
            "--- phase 4 ---",
            "!!!",
            "phase -4",
            "phase 4x",
        ];
        for line in cases {
            assert_eq!(
                find_batch_codename(line),
                reference_find_batch_codename(line),
                "disagreement on {line:?}"
            );
        }
    }

    #[test]
    fn a_bare_codename_still_wins_over_a_pairing_on_the_same_line() {
        // Two-pass form returns the bare token because pass one completes before pass two starts.
        assert_eq!(
            find_batch_codename("sprint 2 then w3"),
            Some("w3".to_string())
        );
    }
}
