//! Module: taxis_cmd::tag — Native 'tag' Command Dispatcher
//! File Path: src/bin/taxis_cmd/tag.rs
//! Architecture Role: Implements Git-compatible tag lifecycle: lightweight reference tagging,
//!   annotated GitTag object serialization with cryptographic/author metadata, tag enumeration,
//!   and tag deletion.
//! Dependencies & Triggers: Dispatched by `taxis tag`.
//! Responsibilities: Create, list, and delete lightweight and annotated Git tags.
//! Exit Semantics & Design Rationale:
//!   - Lightweight tags store a bare commit OID in `refs/tags/<name>`.
//!   - Annotated tags persist a true GitTag object in the ODB and point `refs/tags/<name>` to it.
//!   - Enumeration lists tags sorted alphabetically, matching Git output format.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-OBJ-001`: Git object model serialization guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use fg_core::constants::git::OBJ_TAG;
use fg_core::models::{GitSignature, Oid};
use fg_core::traits::OdbStore;
use fg_object::GitTag;
use fg_storage::LooseOdb;
use fractal_git::constants::cli::CliTag;
use fractal_git::fractal::refs::validate_ref_name;
use fractal_git::{DiskRefStore, RefStore};

use super::common::{fail_fatal, fail_io, print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Options for `taxis tag`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TagOptions {
    name: Option<String>,
    target: String,
    annotated: bool,
    delete: bool,
    message: Option<String>,
}

/// Dispatches the `tag` command.
pub fn handle_tag(ctx: &CliContext) {
    let opts = parse_tag_options(&ctx.args);
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };

    let Some(ref tag_name) = opts.name else {
        if !opts.delete {
            list_all_tags(&view, ctx);
            return;
        }
        reject(CliTag::ERROR, "tag name required for deletion");
    };

    if opts.delete {
        delete_tag(&view, tag_name, ctx);
        return;
    }

    if tag_name == "HEAD" || validate_ref_name(&format!("refs/tags/{tag_name}")).is_err() {
        fail_fatal(format!("'{tag_name}' is not a valid tag name."));
    }

    let target_oid = match view.resolve(&opts.target) {
        Ok(oid) => oid,
        Err(err) => reject(
            CliTag::ERROR,
            format!("could not resolve target '{}': {err}", opts.target),
        ),
    };

    let ref_store = DiskRefStore::new(view.git_dir());
    let tag_ref = format!("refs/tags/{tag_name}");

    if ref_store.get_ref(&tag_ref).is_ok_and(|opt| opt.is_some()) {
        fail_fatal(format!("tag '{tag_name}' already exists"));
    }

    if opts.annotated {
        create_annotated_tag(&view, &ref_store, tag_name, target_oid, &opts, ctx);
    } else {
        create_lightweight_tag(&view, &ref_store, tag_name, target_oid, ctx);
    }
}

/// Parses CLI flags into structured tag options.
fn parse_tag_options(args: &[String]) -> TagOptions {
    let mut name = None;
    let mut target = "HEAD".to_string();
    let mut annotated = false;
    let mut delete = false;
    let mut message = None;

    let mut cursor = 0;
    while cursor < args.len() {
        let arg = &args[cursor];
        match arg.as_str() {
            "-a" if cursor + 1 < args.len() => {
                annotated = true;
                name = Some(args[cursor + 1].clone());
                cursor += 1;
            }
            "-d" | "--delete" if cursor + 1 < args.len() => {
                delete = true;
                name = Some(args[cursor + 1].clone());
                cursor += 1;
            }
            "-m" if cursor + 1 < args.len() => {
                message = Some(args[cursor + 1].clone());
                cursor += 1;
            }
            other if !other.starts_with('-') => {
                if name.is_none() {
                    name = Some(other.to_string());
                } else if target == "HEAD" {
                    target = other.to_string();
                }
            }
            _ => {}
        }
        cursor += 1;
    }

    TagOptions {
        name,
        target,
        annotated,
        delete,
        message,
    }
}

/// Lists all tags in standard alphabetical order.
fn list_all_tags(view: &RepoView, ctx: &CliContext) {
    let ref_store = DiskRefStore::new(view.git_dir());
    let all_refs = ref_store.list_all().unwrap_or_default();
    let mut tags = Vec::new();

    for (name, oid) in all_refs {
        if let Some(tag_sub) = name.strip_prefix("refs/tags/") {
            tags.push((tag_sub.to_string(), oid));
        }
    }
    tags.sort_by(|a, b| a.0.cmp(&b.0));

    if ctx.json_mode {
        let list: Vec<serde_json::Value> = tags
            .iter()
            .map(|(t, o)| serde_json::json!({ "tag": t, "oid": o.to_hex() }))
            .collect();
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "tag",
            "tag_count": tags.len(),
            "tags": list,
        }));
    } else {
        for (tag_name, _) in tags {
            println!("{tag_name}");
        }
    }
}

/// Deletes an existing tag reference, whether it is stored loose or only in `packed-refs`.
fn delete_tag(view: &RepoView, tag_name: &str, ctx: &CliContext) {
    let ref_store = DiskRefStore::new(view.git_dir());
    let tag_ref = format!("refs/tags/{tag_name}");
    let existing_oid = match ref_store.get_ref(&tag_ref) {
        Ok(Some(oid)) => oid,
        _ => reject(CliTag::ERROR, format!("error: tag '{tag_name}' not found.")),
    };

    let hook_runner = super::git_hooks::discover(view.git_dir(), view.work_root());
    let update = super::git_hooks::ReferenceUpdate {
        previous: Some(existing_oid),
        next: "0".repeat(40),
        name: tag_ref.clone(),
    };
    if let Err(err_msg) =
        super::git_hooks::execute_reference_transaction(&hook_runner, &[update], || match ref_store
            .delete_ref(&tag_ref)
        {
            Ok(true) => Ok(()),
            Ok(false) => Err(format!("error: tag '{tag_name}' not found.")),
            Err(delete_err) => Err(format!("delete tag '{tag_name}': {delete_err}")),
        })
    {
        reject(CliTag::ERROR, err_msg);
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "tag",
            "status": "deleted",
            "tag": tag_name,
            "deleted_oid": existing_oid.to_hex(),
        }));
    } else {
        println!(
            "Deleted tag '{}' (was {})",
            tag_name,
            &existing_oid.to_hex()[..7]
        );
    }
}

/// Creates a lightweight tag ref pointing directly to target_oid.
fn create_lightweight_tag(
    view: &RepoView,
    ref_store: &DiskRefStore,
    tag_name: &str,
    target_oid: Oid,
    ctx: &CliContext,
) {
    let tag_ref = format!("refs/tags/{tag_name}");
    let hook_runner = super::git_hooks::discover(view.git_dir(), view.work_root());
    let update = super::git_hooks::ReferenceUpdate {
        previous: None,
        next: target_oid.to_hex(),
        name: tag_ref.clone(),
    };
    if let Err(err_msg) =
        super::git_hooks::execute_reference_transaction(&hook_runner, &[update], || {
            ref_store
                .update_ref(&tag_ref, &target_oid, None)
                .map_err(|err| format!("write tag ref '{tag_ref}': {err}"))
        })
    {
        reject(CliTag::ERROR, err_msg);
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "tag",
            "type": "lightweight",
            "tag": tag_name,
            "target": target_oid.to_hex(),
        }));
    }
}

/// Creates a full GitTag annotated object and points `refs/tags/<name>` to it.
fn create_annotated_tag(
    view: &RepoView,
    ref_store: &DiskRefStore,
    tag_name: &str,
    target_oid: Oid,
    opts: &TagOptions,
    ctx: &CliContext,
) {
    let timestamp_sec = chrono::Utc::now().timestamp();
    let tagger = GitSignature::new("Taxis Operator", "operator@taxis.internal", timestamp_sec);
    let msg = opts.message.as_deref().unwrap_or(tag_name);
    let target_kind = match view.object(&target_oid) {
        Ok(object) => object.kind,
        Err(kind_err) => reject(
            CliTag::ERROR,
            format!(
                "cannot read tag target '{}': {kind_err}",
                target_oid.to_hex()
            ),
        ),
    };

    let tag_obj = GitTag {
        target_oid,
        target_kind,
        name: tag_name.to_string(),
        tagger: Some(tagger),
        message: format!("{msg}\n"),
        signature: None,
    };

    let payload = tag_obj.to_payload();
    let odb = LooseOdb::new(view.git_dir());
    let tag_oid = match odb.write_object(OBJ_TAG, &payload) {
        Ok(oid) => oid,
        Err(err) => fail_io("write annotated tag object", err),
    };

    let tag_ref = format!("refs/tags/{tag_name}");
    let hook_runner = super::git_hooks::discover(view.git_dir(), view.work_root());
    let update = super::git_hooks::ReferenceUpdate {
        previous: None,
        next: tag_oid.to_hex(),
        name: tag_ref.clone(),
    };
    if let Err(err_msg) =
        super::git_hooks::execute_reference_transaction(&hook_runner, &[update], || {
            ref_store
                .update_ref(&tag_ref, &tag_oid, None)
                .map_err(|err| format!("write tag ref '{tag_ref}': {err}"))
        })
    {
        reject(CliTag::ERROR, err_msg);
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "tag",
            "type": "annotated",
            "tag": tag_name,
            "tag_oid": tag_oid.to_hex(),
            "target": target_oid.to_hex(),
        }));
    }
}
