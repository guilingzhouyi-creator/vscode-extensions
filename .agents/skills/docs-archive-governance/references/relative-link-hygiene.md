# Markdown Relative Link Hygiene & Reachability Guide (`DOC-LNK-001` / `HC-ABS-PATH`)

Rules for portable workspace Markdown links and section anchors enforced by `audit_docs.py` and `validate-docs.js`.

---

## 1. Ban Absolute Paths & Local URIs (`DOC-LNK-001` / `HC-ABS-PATH`)

- **Blocked**: Local file URI prefixes, OS drive-letter prefixes, and machine-specific user-home prefixes break across CI runners and OS hosts.
- **Required**: Express every workspace file reference as a **relative path** computed from the current Markdown file's directory.

---

## 2. Relative Path Examples

```markdown
Same folder:     [stage-2](stage-2-contract.md)
Sibling folder:  [service-guide](../domain/service-guide.md)
```

Deep subtree to root docs (`WebGames/docs/路线图/01_短期施工区/blueprint_combat/doc.md`):
```markdown
[Governance](../../../../AGENTS.md)
[Blueprint](../../../../docs/agent-native-system-blueprint.md)
```

---

## 3. Section Anchor Slug Rules (`DOC-LNK-001`)

Verify target headings exist verbatim. GitHub slugification lowercases ASCII, converts spaces to `-`, and strips non-alphanumeric punctuation while preserving hyphens and CJK characters.

---

## 4. Automated Link Audit Commands

```powershell
python WebGames/scripts/py/audit_docs.py
node auto-refactor/scripts/validate-docs.js
```
