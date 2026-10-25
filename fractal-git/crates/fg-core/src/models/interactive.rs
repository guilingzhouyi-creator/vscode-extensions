//! Module: fg-core::models::interactive — Interactive Operations and Headless Plan Models
//! File Path: crates/fg-core/src/models/interactive.rs
//! Architecture Role: Domain data models for dual-mode interactive Git operations:
//!   headless JSON/Stdin plans for autonomous SubAgents and standard instruction scripts for human CLI interaction.
//! Dependencies & Triggers: Consumed by `taxis rebase -i` and interactive patch staging (`-p`).
//! Responsibilities: Define rebase actions, rebase plan serializations, plan legality validation,
//!   and patch hunk decision matrices.
//! Exit Semantics & Design Rationale:
//!   - Headless First: full JSON serialization allows Agent orchestrators to submit structured rebase plans.
//!   - Git Porcelain parity: bidirectional parsing/formatting of standard Git interactive rebase instruction text.
//!   - Legality is machine-checked before replay: a first instruction of `squash`/`fixup` has no previous
//!     commit to meld into, and Git refuses it; accepting it here produced a parentless root commit inside
//!     the replayed range. An `exec` step without a command, a commit step without a commit, or a `reword`
//!     without a replacement message are equally unexecutable, so [`RebasePlan::validate`] rejects them
//!     before the CLI touches a reference.

use serde::{Deserialize, Serialize};

use crate::error::{FractalError, FractalResult};
use crate::models::Oid;

/// Actions available for each commit in an interactive rebase instruction list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RebaseAction {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
    Exec,
}

impl RebaseAction {
    /// Parses an action string (both full word and single-character abbreviation).
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "p" | "pick" => Some(Self::Pick),
            "r" | "reword" => Some(Self::Reword),
            "e" | "edit" => Some(Self::Edit),
            "s" | "squash" => Some(Self::Squash),
            "f" | "fixup" => Some(Self::Fixup),
            "d" | "drop" => Some(Self::Drop),
            "x" | "exec" => Some(Self::Exec),
            _ => None,
        }
    }

    /// Canonical lowercase verb for instruction lists.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pick => "pick",
            Self::Reword => "reword",
            Self::Edit => "edit",
            Self::Squash => "squash",
            Self::Fixup => "fixup",
            Self::Drop => "drop",
            Self::Exec => "exec",
        }
    }
}

/// A single step in an interactive rebase plan.
///
/// `commit` and `command` are mutually exclusive projections of the two kinds of step: an
/// instruction list entry names either a commit to replay or a shell command to run. Modelling both as
/// one nullable pair is what lets a deserialized plan express an `exec` step at all; the alternative
/// (mandatory commit plus a free-form summary) forced every `exec` line to masquerade as a commit and
/// silently degraded to `pick`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RebaseItem {
    /// Step verb.
    pub action: RebaseAction,
    /// Commit the step replays; absent exactly for `exec` steps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<Oid>,
    /// Human-facing subject carried through instruction text.
    pub summary: String,
    /// Replacement message for `reword`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_message: Option<String>,
    /// Shell command for `exec`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

impl RebaseItem {
    /// Seven-character form of the replayed commit, or an explicit marker when no commit is attached.
    pub fn short_commit(&self) -> String {
        match self.commit {
            Some(oid) => oid.to_hex()[..7].to_string(),
            None => "<none>".to_string(),
        }
    }
}

/// A complete interactive rebase plan containing the upstream commit and ordered operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RebasePlan {
    pub upstream: Oid,
    pub items: Vec<RebaseItem>,
}

impl RebasePlan {
    /// Creates a new rebase plan.
    ///
    /// This constructor stays infallible because stored plans deserialize straight into the struct; a
    /// caller that built a plan by hand must call [`Self::validated`] or [`Self::validate`] before it
    /// reaches a reference update.
    pub fn new(upstream: Oid, items: Vec<RebaseItem>) -> Self {
        Self { upstream, items }
    }

    /// Creates a plan only if it is executable, returning the same rejection as [`Self::validate`].
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::PolicyViolation`] naming the first illegal instruction.
    pub fn validated(upstream: Oid, items: Vec<RebaseItem>) -> FractalResult<Self> {
        let plan = Self::new(upstream, items);
        plan.validate()?;
        Ok(plan)
    }

    /// Rejects plans Git itself would refuse or that cannot be replayed deterministically.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::PolicyViolation`] naming the first illegal instruction.
    pub fn validate(&self) -> FractalResult<()> {
        if self.items.is_empty() {
            return Err(FractalError::PolicyViolation(
                "rebase plan has no instructions".to_string(),
            ));
        }
        if let Some(first) = self.items.first() {
            match first.action {
                RebaseAction::Squash => {
                    return Err(FractalError::PolicyViolation(
                        "cannot 'squash' without a previous commit".to_string(),
                    ));
                }
                RebaseAction::Fixup => {
                    return Err(FractalError::PolicyViolation(
                        "cannot 'fixup' without a previous commit".to_string(),
                    ));
                }
                _ => {}
            }
        }
        for item in &self.items {
            validate_item(item)?;
        }
        Ok(())
    }

    /// Formats the plan into standard Git interactive rebase instruction text.
    pub fn format_todo_text(&self) -> String {
        let mut out = self.format_instruction_lines();

        out.push_str(
            "\n# Rebase Instructions:\n\
             # Commands:\n\
             # p, pick <commit> = use commit\n\
             # r, reword <commit> = use commit, but edit the commit message\n\
             # e, edit <commit> = use commit, but stop for amending\n\
             # s, squash <commit> = use commit, but meld into previous commit\n\
             # f, fixup <commit> = like \"squash\", but discard this commit's log message\n\
             # d, drop <commit> = remove commit\n\
             # x, exec <command> = run command (the rest of the line) using shell\n\
             #\n\
             # Lines starting with '#' will be ignored.\n",
        );

        out
    }

    /// Formats only the executable instruction lines, without the trailing comment block.
    ///
    /// The instruction list and the progress file share this shape: the instruction list may carry
    /// comments, while the progress file records the instructions already consumed and must not.
    pub fn format_instruction_lines(&self) -> String {
        let mut out = String::new();
        for item in &self.items {
            if item.action == RebaseAction::Exec {
                out.push_str(&format!(
                    "{} {}\n",
                    item.action.as_str(),
                    item.command.as_deref().unwrap_or("")
                ));
            } else {
                out.push_str(&format!(
                    "{} {} {}\n",
                    item.action.as_str(),
                    item.short_commit(),
                    item.summary
                ));
            }
        }
        out
    }

    /// Parses a Git interactive rebase instruction text back into a list of items.
    pub fn parse_todo_text(
        text: &str,
        known_commits: &[Oid],
    ) -> Result<Vec<RebaseItem>, FractalError> {
        let mut items = Vec::new();

        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() < 2 {
                return Err(FractalError::PolicyViolation(format!(
                    "Invalid rebase instruction line: '{trimmed}'"
                )));
            }

            let action = RebaseAction::parse(parts[0]).ok_or_else(|| {
                FractalError::PolicyViolation(format!("Unknown rebase command: '{}'", parts[0]))
            })?;

            if action == RebaseAction::Exec {
                let command = parts[1..].join(" ");
                if command.trim().is_empty() {
                    return Err(FractalError::PolicyViolation(format!(
                        "Exec instruction carries no command: '{trimmed}'"
                    )));
                }
                items.push(RebaseItem {
                    action,
                    commit: None,
                    summary: command.clone(),
                    new_message: None,
                    command: Some(command),
                });
                continue;
            }

            let commit = resolve_commit_prefix(parts[1], known_commits)?;
            let summary = if parts.len() > 2 {
                parts[2..].join(" ")
            } else {
                String::new()
            };

            items.push(RebaseItem {
                action,
                commit: Some(commit),
                summary,
                new_message: None,
                command: None,
            });
        }

        Ok(items)
    }
}

/// Resolves a hexadecimal commit prefix against the commits the caller knows about.
fn resolve_commit_prefix(prefix: &str, known_commits: &[Oid]) -> Result<Oid, FractalError> {
    known_commits
        .iter()
        .find(|oid| oid.to_hex().starts_with(prefix))
        .copied()
        .ok_or_else(|| {
            FractalError::PolicyViolation(format!(
                "Could not resolve commit prefix '{prefix}' in rebase plan"
            ))
        })
}

/// Validates one instruction's action/commit/command/message combination.
fn validate_item(item: &RebaseItem) -> FractalResult<()> {
    if item.action == RebaseAction::Exec {
        let command = item.command.as_deref().map(str::trim).unwrap_or("");
        if command.is_empty() {
            return Err(FractalError::PolicyViolation(
                "exec requires a command".to_string(),
            ));
        }
        if item.commit.is_some() {
            return Err(FractalError::PolicyViolation(
                "exec must not name a commit".to_string(),
            ));
        }
        return Ok(());
    }

    if item.command.is_some() {
        return Err(FractalError::PolicyViolation(format!(
            "{} must not carry an exec command",
            item.action.as_str()
        )));
    }
    if item.commit.is_none() {
        return Err(FractalError::PolicyViolation(format!(
            "{} requires a commit",
            item.action.as_str()
        )));
    }
    if item.action == RebaseAction::Reword {
        match item.new_message.as_deref().map(str::trim) {
            Some(message) if !message.is_empty() => {}
            _ => {
                return Err(FractalError::PolicyViolation(format!(
                    "reword {} requires a new message",
                    item.short_commit()
                )));
            }
        }
    }
    Ok(())
}

/// Decisions available when interactively staging diff hunks (`-p`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PatchHunkChoice {
    Yes,
    No,
    Quit,
    Edit,
    Split,
}

impl PatchHunkChoice {
    /// Parses interactive patch hunk choice from string input.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "y" | "yes" => Some(Self::Yes),
            "n" | "no" => Some(Self::No),
            "q" | "quit" => Some(Self::Quit),
            "e" | "edit" => Some(Self::Edit),
            "s" | "split" => Some(Self::Split),
            _ => None,
        }
    }
}

/// Headless plan for staging or unstaging hunks within a file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PatchPlan {
    pub file_path: String,
    pub hunk_decisions: Vec<PatchHunkChoice>,
}
