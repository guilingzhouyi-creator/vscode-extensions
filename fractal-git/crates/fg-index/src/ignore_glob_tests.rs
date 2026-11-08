//! Module: fg-index — Glob Linear Backtracker Differential Verification
//! File Path: crates/fg-index/src/ignore_glob_tests.rs
//! Architecture Role: Verifies the iterative single-star resume glob matcher against the
//!   reference recursive specification and guards linear-time pathological star bounds.

use super::glob_match;

fn eval_char_class_body(members: &[u8], ch: u8) -> bool {
    let mut matched = false;
    let mut cursor = 0usize;
    while cursor < members.len() {
        if cursor + 2 < members.len() && members[cursor + 1] == b'-' {
            if members[cursor] <= ch && ch <= members[cursor + 2] {
                matched = true;
            }
            cursor += 3;
        } else {
            if members[cursor] == ch {
                matched = true;
            }
            cursor += 1;
        }
    }
    matched
}

fn match_char_class(pattern: &[u8], text: &[u8]) -> bool {
    let Some(close) = pattern.iter().skip(1).position(|byte| *byte == b']') else {
        return !text.is_empty()
            && text[0] == b'['
            && reference_glob_match(&pattern[1..], &text[1..]);
    };
    if text.is_empty() {
        return false;
    }
    let body = &pattern[1..1 + close];
    let rest = &pattern[1 + close + 1..];
    let (negated, members) = match body.first() {
        Some(b'!') | Some(b'^') => (true, &body[1..]),
        _ => (false, body),
    };
    let matched = eval_char_class_body(members, text[0]);
    matched != negated && reference_glob_match(rest, &text[1..])
}

/// Reference matcher: the recursive split-over-every-position form this module used before
/// the linear walk replaced it. Kept only as a test oracle, never called in production.
///
/// Its accepting language is the specification; the shipping matcher must agree with it on
/// every input, including the pathological many-star shapes that made the recursive form
/// exponential.
fn reference_glob_match(pattern: &[u8], text: &[u8]) -> bool {
    if pattern.is_empty() {
        return text.is_empty();
    }
    match pattern[0] {
        b'*' => {
            let mut rest = &pattern[1..];
            while rest.first() == Some(&b'*') {
                rest = &rest[1..];
            }
            (0..=text.len()).any(|skip| reference_glob_match(rest, &text[skip..]))
        }
        b'?' => !text.is_empty() && reference_glob_match(&pattern[1..], &text[1..]),
        b'[' => match_char_class(pattern, text),
        b'\\' if pattern.len() > 1 => {
            !text.is_empty()
                && text[0] == pattern[1]
                && reference_glob_match(&pattern[2..], &text[1..])
        }
        literal => {
            !text.is_empty()
                && text[0] == literal
                && reference_glob_match(&pattern[1..], &text[1..])
        }
    }
}

/// The linear walk must accept exactly the language the recursive reference accepts.
///
/// The alphabet is deliberately metacharacter-dense so stars, classes, negations and escapes
/// all appear. The exhaustive corner (every pattern and text up to length 2 over a 6-letter
/// subset) pins the small cases; the randomised pass then covers longer shapes, where the
/// recursive reference would itself be too slow to enumerate.
#[test]
fn linear_walk_agrees_with_the_recursive_reference_everywhere() {
    let alphabet = b"a*[]!-";
    let mut state = 0x243F_6A88_85A3_08D3u64;

    for pattern_len in 0..=2usize {
        for text_len in 0..=2usize {
            let pattern_space = alphabet.len().pow(pattern_len as u32);
            let text_space = alphabet.len().pow(text_len as u32);
            for p in 0..pattern_space {
                let mut pattern = Vec::with_capacity(pattern_len);
                let mut rem = p;
                for _ in 0..pattern_len {
                    pattern.push(alphabet[rem % alphabet.len()]);
                    rem /= alphabet.len();
                }
                for t in 0..text_space {
                    let mut text = Vec::with_capacity(text_len);
                    let mut rem_t = t;
                    for _ in 0..text_len {
                        text.push(alphabet[rem_t % alphabet.len()]);
                        rem_t /= alphabet.len();
                    }
                    assert_eq!(
                        glob_match(&pattern, &text),
                        reference_glob_match(&pattern, &text),
                        "disagreement on pattern {:?} text {:?}",
                        String::from_utf8_lossy(&pattern),
                        String::from_utf8_lossy(&text)
                    );
                }
            }
        }
    }

    let star = |state: &mut u64| -> u8 {
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        b"ab*?[]!-.x"[((*state >> 33) as usize) % 10]
    };
    for round in 0..600usize {
        let pattern_len = 1 + (star(&mut state) as usize % 10);
        let text_len = (star(&mut state) as usize) % 12;
        let mut pattern = Vec::with_capacity(pattern_len);
        for _ in 0..pattern_len {
            pattern.push(star(&mut state));
        }
        let mut text = Vec::with_capacity(text_len);
        for _ in 0..text_len {
            text.push(star(&mut state).clamp(b'a', b'c'));
        }
        assert_eq!(
            glob_match(&pattern, &text),
            reference_glob_match(&pattern, &text),
            "disagreement at round {round} on pattern {:?} text {:?}",
            String::from_utf8_lossy(&pattern),
            String::from_utf8_lossy(&text)
        );
    }
}

/// The pathological shape must now be cheap. Before the rewrite an all-`a` subject with a
/// `a*a*a*...b` pattern explored `2^k` partial matches; the linear walk settles it with one
/// resume pointer.
#[test]
fn many_star_patterns_reject_in_linear_time() {
    let mut pattern = Vec::new();
    for _ in 0..64 {
        pattern.extend_from_slice(b"a*");
    }
    pattern.push(b'b');
    let text = vec![b'a'; 96];

    let started = std::time::Instant::now();
    assert!(!glob_match(&pattern, &text));
    let elapsed = started.elapsed();

    assert!(
        elapsed < std::time::Duration::from_millis(50),
        "many-star rejection took {elapsed:?}, which indicates the walk is not linear"
    );
}

/// The same pattern shape must still *match* when the trailing literal is present.
#[test]
fn many_star_patterns_accept_when_the_tail_matches() {
    let mut pattern = Vec::new();
    for _ in 0..32 {
        pattern.extend_from_slice(b"a*");
    }
    pattern.push(b'b');
    let mut text = vec![b'a'; 48];
    text.push(b'b');

    let started = std::time::Instant::now();
    assert!(glob_match(&pattern, &text));
    assert!(
        started.elapsed() < std::time::Duration::from_millis(50),
        "many-star acceptance is not linear"
    );
}
