//! Module: fg-gate — Commit Project Scope Guard
//! File Path: crates/fg-gate/src/commit_guard/project.rs
//! Architecture Role: Parses project declarations from structured slots and validates against allowed lists.
//! Dependencies & Triggers: Consumed by `commit_guard::validate_body_spacing_and_trailers`.
//! Responsibilities: Extract project tags from inline and list formats, filter empty shells, and
//!   match declared projects against repository policies.
//! Exit Semantics & Design Rationale: Fails closed when required project tag is missing or not in
//!   the controlled allowed list.
//!
//! Domain Governance Rules: FGT-MSG-007 (project attribution).

use fg_core::models::TaxisPolicy;
use std::collections::HashMap;
use std::path::Path;

use super::sections::{SectionScan, SectionSlot};

/// Normalizes project aliases (`web-games` -> `webgames`, `fractalgit` -> `fractal-git`, `timing` -> `workspace-timing`).
fn normalize_project_alias(raw: &str) -> &str {
    match raw {
        "web-games" => "webgames",
        "fractalgit" => "fractal-git",
        "timing" => "workspace-timing",
        other => other,
    }
}

/// Evaluates a single lease entry against the declared project slice.
fn check_single_lease_record(
    lease_value: &serde_json::Value,
    declared: &[String],
    violations: &mut Vec<String>,
) {
    let Some(raw_id) = lease_value.get("id").and_then(|val| val.as_str()) else {
        return;
    };
    let Some(raw_status) = lease_value.get("status").and_then(|val| val.as_str()) else {
        return;
    };
    if !raw_status.eq_ignore_ascii_case("frozen") {
        return;
    }
    let canonical_id = normalize_project_alias(raw_id.trim());
    for candidate in declared {
        if normalize_project_alias(candidate.as_str()) == canonical_id {
            violations.push(format!(
                "{}: Project '{}' TTL lease has expired and is Frozen; commit privileges locked",
                fg_core::constants::rules::RULE_FGT_MSG_007,
                raw_id
            ));
            break;
        }
    }
}

/// Parses an existing project cache file and evaluates frozen leases against declared projects.
fn inspect_cache_file(
    cache_path: &Path,
    declared: &[String],
    violations: &mut Vec<String>,
) -> bool {
    let Ok(content) = std::fs::read_to_string(cache_path) else {
        return false;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    let Some(leases_val) = parsed.get("leases") else {
        return true;
    };
    if let Some(map) = leases_val.as_object() {
        for entry_val in map.values() {
            check_single_lease_record(entry_val, declared, violations);
        }
        return true;
    }
    if let Some(arr) = leases_val.as_array() {
        for entry_val in arr {
            check_single_lease_record(entry_val, declared, violations);
        }
        return true;
    }
    true
}

/// Inspects active project cache files upward from `search_start` to enforce Frozen lease lockdown.
pub fn check_project_leases_at(
    search_start: &Path,
    declared: &[String],
    violations: &mut Vec<String>,
) {
    for ancestor in search_start.ancestors() {
        let taxis_cache = ancestor
            .join(".taxis")
            .join("projects")
            .join("active_projects.json");
        if taxis_cache.is_file() && inspect_cache_file(&taxis_cache, declared, violations) {
            return;
        }
        let git_cache = ancestor
            .join(".git")
            .join("projects")
            .join("active_projects.json");
        if git_cache.is_file() && inspect_cache_file(&git_cache, declared, violations) {
            return;
        }
        let runtime_cache = ancestor
            .join(".taxis")
            .join("runtime")
            .join("active_projects.json");
        if runtime_cache.is_file() && inspect_cache_file(&runtime_cache, declared, violations) {
            return;
        }
    }
}

/// Collects every project name declared in the project slot.
///
/// Both the inline form (`[Project: a, b]`) and the list form (`[Project]` then `- a`) are
/// accepted, and all three separators are recognized.
pub fn collect_declared_projects(
    sections_map: &HashMap<String, String>,
    scan: &SectionScan,
) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    if let Some(section) = scan.find(SectionSlot::Project) {
        for line in &section.lines {
            push_project_names(line, &mut names);
        }
        // The heading may carry the declaration inline: `[Project: fractal-git]`.
        if let Some(heading_name) = section.heading.split(':').nth(1) {
            push_project_names(heading_name, &mut names);
        }
    }
    if names.is_empty() {
        if let Some(content) = sections_map
            .iter()
            .find(|(key, _)| key.to_lowercase().contains("project") || key.contains("项目"))
            .map(|(_, value)| value)
        {
            for line in content.lines() {
                push_project_names(line, &mut names);
            }
        }
    }
    names
}

/// Appends every project name found in one declaration line.
fn push_project_names(line: &str, names: &mut Vec<String>) {
    let stripped = line.trim().trim_start_matches('-').trim();
    if stripped.is_empty() {
        return;
    }
    for part in stripped.split([',', '，', '、']) {
        let cleaned = part
            .trim()
            .trim_start_matches('-')
            .trim()
            .split(['(', '（'])
            .next()
            .unwrap_or("")
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        if !cleaned.is_empty() && !names.contains(&cleaned) {
            names.push(cleaned);
        }
    }
}

/// Validates that mandatory project tag is present and in the controlled list.
pub fn check_project_tag(
    sections_map: &HashMap<String, String>,
    scan: &SectionScan,
    policy: &TaxisPolicy,
    violations: &mut Vec<String>,
) {
    if !policy.require_project_tag {
        return;
    }
    let declared = collect_declared_projects(sections_map, scan);
    if declared.is_empty() {
        violations.push(format!(
            "{}: Missing mandatory [Project] section or it declares no project",
            fg_core::constants::rules::RULE_FGT_MSG_007
        ));
        return;
    }
    if policy.allowed_projects.is_empty() {
        return;
    }
    // Exact comparison, not substring: `fractal-git-evil` must not satisfy `fractal-git`.
    let allowed: Vec<String> = policy
        .allowed_projects
        .iter()
        .map(|name| name.trim().to_lowercase())
        .collect();
    for project in &declared {
        if !allowed.iter().any(|candidate| candidate == project) {
            violations.push(format!(
                "{}: Project '{}' is not in the controlled list: {:?}",
                fg_core::constants::rules::RULE_FGT_MSG_007,
                project,
                policy.allowed_projects
            ));
        }
    }

    if let Ok(current_path) = std::env::current_dir() {
        check_project_leases_at(&current_path, &declared, violations);
    }
}
