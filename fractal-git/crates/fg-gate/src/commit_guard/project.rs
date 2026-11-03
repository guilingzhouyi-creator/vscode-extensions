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

use super::sections::{SectionScan, SectionSlot};

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
    for project in declared {
        if !allowed.iter().any(|candidate| candidate == &project) {
            violations.push(format!(
                "{}: Project '{}' is not in the controlled list: {:?}",
                fg_core::constants::rules::RULE_FGT_MSG_007,
                project,
                policy.allowed_projects
            ));
        }
    }
}
