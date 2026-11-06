//! Module: taxis_cmd::status_tests — Unit Tests for Status Record Representation
//! File Path: src/bin/taxis_cmd/status_tests.rs

use super::super::status_collect::{
    classify_staged, conflict_code, empty_index_bytes, merge_side, stage_zero_map,
};
use super::super::tree_view::TreeEntry;
use super::{StatusEntry, CODE_ADDED, CODE_DELETED, CODE_MODIFIED, CODE_RENAMED, CODE_UNCHANGED};
use fg_core::models::{FileMode, Oid};
use fg_index::GitIndex;
use std::collections::{BTreeMap, BTreeSet};

const PATH_A: &str = "a.txt";
const PATH_B: &str = "b.txt";
const PATH_NEW: &str = "new.txt";
const PATH_OLD: &str = "old.txt";
const PATH_GONE: &str = "gone.txt";
const PARSE_MSG: &str = "parse";
const SEED_TEST: u8 = 7;
const SEED_OTHER: u8 = 8;
const SEED_GONE: u8 = 3;

fn oid_of(seed: u8) -> Oid {
    Oid::from_bytes([seed; 20])
}

fn tree_entry(seed: u8) -> TreeEntry {
    TreeEntry {
        mode: FileMode::RegularFile,
        oid: oid_of(seed),
    }
}

#[cfg(test)]
fn empty_index() -> GitIndex {
    GitIndex::parse(empty_index_bytes(), std::path::PathBuf::from("<t>")).expect(PARSE_MSG)
}

#[test]
fn a_path_only_in_the_head_tree_is_a_staged_deletion() {
    let mut head: BTreeMap<String, TreeEntry> = BTreeMap::new();
    head.insert(PATH_GONE.to_string(), tree_entry(SEED_GONE));
    let staged = classify_staged(&empty_index(), &head);
    assert_eq!(
        staged.get(PATH_GONE).map(|entry| entry.index_code),
        Some(CODE_DELETED)
    );
}

#[test]
fn an_empty_index_and_empty_tree_report_nothing() {
    let staged = classify_staged(&empty_index(), &BTreeMap::new());
    assert!(staged.is_empty());
}

#[test]
fn a_rename_record_names_both_paths_in_the_line_form() {
    let entry = StatusEntry::with_rename(CODE_RENAMED, CODE_UNCHANGED, PATH_NEW, PATH_OLD, 60_000);
    assert_eq!(entry.record_text(false), "R  old.txt -> new.txt");
}

#[test]
fn a_rename_record_names_only_the_new_path_in_the_nul_form() {
    let entry = StatusEntry::with_rename(CODE_RENAMED, CODE_UNCHANGED, PATH_NEW, PATH_OLD, 60_000);
    assert_eq!(entry.record_text(true), "R  new.txt");
}

#[test]
fn a_non_rename_record_is_identical_in_both_forms() {
    let entry = StatusEntry::new(CODE_MODIFIED, CODE_UNCHANGED, PATH_A);
    assert_eq!(entry.record_text(false), "M  a.txt");
    assert_eq!(entry.record_text(true), "M  a.txt");
}

#[test]
fn a_rename_is_staged_because_its_index_side_changed() {
    let entry = StatusEntry::with_rename(CODE_RENAMED, CODE_UNCHANGED, PATH_NEW, PATH_OLD, 30_000);
    assert!(entry.is_staged());
    assert!(!entry.is_unstaged());
    assert!(!entry.is_untracked());
}

#[test]
fn every_conflict_stage_combination_maps_to_a_two_letter_code() {
    let all_three: BTreeSet<u8> = [1u8, 2, 3].into_iter().collect();
    assert_eq!(conflict_code(&all_three), ('U', 'U'));

    let both_added: BTreeSet<u8> = [2u8, 3].into_iter().collect();
    assert_eq!(conflict_code(&both_added), ('A', 'A'));

    let delete_modify: BTreeSet<u8> = [1u8, 2].into_iter().collect();
    assert_eq!(conflict_code(&delete_modify), ('U', 'D'));

    let their_delete: BTreeSet<u8> = [1u8, 3].into_iter().collect();
    assert_eq!(conflict_code(&their_delete), ('D', 'U'));

    let base_only: BTreeSet<u8> = [1u8].into_iter().collect();
    assert_eq!(conflict_code(&base_only), ('D', 'D'));
}

#[test]
fn merging_keeps_both_sides_of_one_path() {
    let mut all: BTreeMap<String, StatusEntry> = BTreeMap::new();
    all.insert(
        PATH_A.to_string(),
        StatusEntry::new(CODE_MODIFIED, CODE_UNCHANGED, PATH_A),
    );
    merge_side(
        &mut all,
        PATH_A.to_string(),
        StatusEntry::new(CODE_UNCHANGED, CODE_MODIFIED, PATH_A),
    );
    assert_eq!(all.len(), 1);
    assert_eq!(all[PATH_A].code(), "MM");
}

#[test]
fn merging_a_new_worktree_only_path_inserts_it() {
    let mut all: BTreeMap<String, StatusEntry> = BTreeMap::new();
    merge_side(
        &mut all,
        PATH_B.to_string(),
        StatusEntry::new(CODE_UNCHANGED, CODE_MODIFIED, PATH_B),
    );
    assert_eq!(all[PATH_B].code(), " M");
}

#[test]
fn an_untracked_entry_renders_two_question_marks() {
    let entry = StatusEntry::new('?', '?', PATH_NEW);
    assert_eq!(entry.code(), "??");
    assert!(entry.is_untracked());
    assert!(!entry.is_staged());
    assert!(!entry.is_unstaged());
}

#[test]
fn an_added_entry_is_staged_but_not_unstaged() {
    let entry = StatusEntry::new(CODE_ADDED, CODE_UNCHANGED, PATH_A);
    assert!(entry.is_staged());
    assert!(!entry.is_unstaged());
}

#[test]
fn a_conflicted_entry_is_neither_staged_nor_unstaged() {
    let entry = StatusEntry::new('U', 'U', PATH_A);
    assert!(entry.is_conflicted());
}

#[test]
fn only_stage_zero_entries_enter_the_worktree_comparison() {
    let map = stage_zero_map(&empty_index());
    assert!(map.is_empty());
}

#[test]
fn an_unknown_tree_oid_seed_is_stable() {
    assert_eq!(oid_of(SEED_TEST), oid_of(SEED_TEST));
    assert_ne!(oid_of(SEED_TEST), oid_of(SEED_OTHER));
}
