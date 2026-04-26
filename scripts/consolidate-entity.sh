#!/usr/bin/env bash
#
# consolidate-entity — operator tool for context cleanup
#
# Subcommands:
#   merge   --from <a.md> --into <b.md>   Redirect refs from a.md to b.md, delete a.md, append a LOG note.
#   rename  <old.md> <new.md>             Rename old.md to new.md and redirect all references.
#   delete  <file.md>                     Delete file.md, remove its INDEX.md entry, optionally purge source_entities.
#   audit                                 Surface stale/noise/dup-candidate context pages.
#
# Common flags:
#   --workspace <path>   Workspace root (default: $HAMMIES_WORKSPACE or env-derived)
#   --dry-run            Print what would change; do not write
#   --no-purge           Skip source_entities DB purge (operator can run later)
#
# Examples:
#   ./consolidate-entity.sh merge --from sara-perez-distributionmgmt-com.md --into distribution-management.md
#   ./consolidate-entity.sh rename ecom-cpa.md ecomcpa.md
#   ./consolidate-entity.sh delete urgent.md
#   ./consolidate-entity.sh audit
#
# All operations:
#   - Operate against $WORKSPACE/context/
#   - Skip stage/, sessions/, LOG.md from sed redirects
#   - Append a row to context/LOG.md describing the change
#   - Purge matching source_entities rows (unless --no-purge)

set -euo pipefail

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

WORKSPACE="${HAMMIES_WORKSPACE:-}"
DRY_RUN=0
PURGE=1

err() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
say() { printf '%s\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then say "[dry-run] $*"; else eval "$@"; fi }

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \?//'
  exit 1
}

# Locate the workspace if not given. Walk up from the script's package.
resolve_workspace() {
  if [ -n "$WORKSPACE" ]; then echo "$WORKSPACE"; return; fi
  local script_dir; script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  # packages/inbox/scripts/.. → packages/inbox; up two more → workspace root
  local candidate="$script_dir/../../.."
  if [ -d "$candidate/packages/agent/context" ]; then
    echo "$(cd "$candidate" && pwd)/packages/agent"
    return
  fi
  err "could not auto-detect workspace; pass --workspace"
  exit 1
}

resolve_db_url() {
  local inbox_env="$1/../inbox/.env"
  if [ -f "$inbox_env" ]; then
    grep -h "^DATABASE_URL=" "$inbox_env" | head -1 | cut -d= -f2-
  fi
}

# Find all md files in context/ that should be redirected (excludes stage/,
# sessions/, LOG.md). We pass these to sed -i.
context_md_files() {
  local ctx="$1"
  find "$ctx" -name '*.md' \
    -not -path "$ctx/stage/*" \
    -not -path "$ctx/sessions/*" \
    -not -name 'LOG.md'
}

# Append a structured row to LOG.md so audits and future runs see the change.
append_log() {
  local ctx="$1" verb="$2" target="$3" note="$4"
  local date; date=$(date +%F)
  local line="| $date | $verb | $target | $note |"
  if [ "$DRY_RUN" = 1 ]; then
    say "[dry-run] log: $line"
  else
    printf '%s\n' "$line" >> "$ctx/LOG.md"
  fi
}

# Purge stale rows from source_entities. Best-effort — silent fail if DB
# unreachable (the operator can re-run later).
purge_source_entities() {
  local entity_value="$1"
  if [ "$PURGE" != 1 ]; then return; fi
  local db_url; db_url=$(resolve_db_url "$WORKSPACE")
  if [ -z "$db_url" ]; then
    err "warn: no DATABASE_URL found, skipping source_entities purge"
    return
  fi
  if [ "$DRY_RUN" = 1 ]; then
    say "[dry-run] DELETE FROM source_entities WHERE entity_value = '$entity_value'"
    return
  fi
  PGCONNECT_TIMEOUT=3 psql "$db_url" -c \
    "DELETE FROM source_entities WHERE entity_value = '$entity_value';" \
    2>/dev/null || err "warn: source_entities purge failed for '$entity_value'"
}

# Sed-replace one filename for another across all context md files.
redirect_refs() {
  local ctx="$1" from="$2" to="$3"
  # Escape any regex-special characters in filenames (safe for typical *.md).
  local from_esc; from_esc=$(printf '%s\n' "$from" | sed 's/[.[\*^$()+?{|]/\\&/g')
  local to_esc; to_esc=$(printf '%s\n' "$to" | sed 's/[&/\]/\\&/g')
  if [ "$DRY_RUN" = 1 ]; then
    local hits
    hits=$(context_md_files "$ctx" | xargs grep -l -- "$from" 2>/dev/null | wc -l | tr -d ' ' || true)
    say "[dry-run] would redirect $from -> $to in ${hits:-0} files"
    return
  fi
  context_md_files "$ctx" | while read -r f; do
    sed -i '' "s/${from_esc}/${to_esc}/g" "$f"
  done
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

cmd_merge() {
  local from="" into=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --from) from="$2"; shift 2;;
      --into) into="$2"; shift 2;;
      --dry-run) DRY_RUN=1; shift;;
      --no-purge) PURGE=0; shift;;
      --workspace) WORKSPACE="$2"; shift 2;;
      *) err "unknown flag: $1"; exit 1;;
    esac
  done
  [ -n "$from" ] && [ -n "$into" ] || { err "--from and --into required"; exit 1; }
  WORKSPACE=$(resolve_workspace)
  local ctx="$WORKSPACE/context"
  [ -f "$ctx/$from" ] || { err "missing: $ctx/$from"; exit 1; }
  [ -f "$ctx/$into" ] || { err "missing target: $ctx/$into"; exit 1; }

  say "merging $from -> $into"
  redirect_refs "$ctx" "$from" "$into"
  if [ "$DRY_RUN" = 1 ]; then
    say "[dry-run] would: rm $ctx/$from"
  else
    rm "$ctx/$from"
  fi
  append_log "$ctx" "merged" "$into" "consolidated $from into $into"
  # Purge the source_entities slug for the deleted file (best-effort).
  local slug="${from%.md}"
  purge_source_entities "$slug"
  say "✓ merged $from -> $into"
}

cmd_rename() {
  local old="" new=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1; shift;;
      --no-purge) PURGE=0; shift;;
      --workspace) WORKSPACE="$2"; shift 2;;
      -*) err "unknown flag: $1"; exit 1;;
      *)
        if [ -z "$old" ]; then old="$1"
        elif [ -z "$new" ]; then new="$1"
        else err "extra arg: $1"; exit 1
        fi
        shift
        ;;
    esac
  done
  [ -n "$old" ] && [ -n "$new" ] || { err "rename takes <old.md> <new.md>"; exit 1; }
  WORKSPACE=$(resolve_workspace)
  local ctx="$WORKSPACE/context"
  [ -f "$ctx/$old" ] || { err "missing: $ctx/$old"; exit 1; }
  [ -f "$ctx/$new" ] && { err "target exists: $ctx/$new (use merge instead)"; exit 1; }

  say "renaming $old -> $new"
  if [ "$DRY_RUN" = 1 ]; then
    say "[dry-run] would: mv $ctx/$old $ctx/$new"
  else
    mv "$ctx/$old" "$ctx/$new"
  fi
  redirect_refs "$ctx" "$old" "$new"
  append_log "$ctx" "renamed" "$new" "renamed from $old"
  # Source_entities slug rename: the entity_value associated with this slug
  # may need to follow. We can't infer the new slug without a hint, so just
  # purge the old one.
  local old_slug="${old%.md}"
  purge_source_entities "$old_slug"
  say "✓ renamed $old -> $new"
}

cmd_delete() {
  local file=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1; shift;;
      --no-purge) PURGE=0; shift;;
      --workspace) WORKSPACE="$2"; shift 2;;
      -*) err "unknown flag: $1"; exit 1;;
      *) file="$1"; shift;;
    esac
  done
  [ -n "$file" ] || { err "delete takes <file.md>"; exit 1; }
  WORKSPACE=$(resolve_workspace)
  local ctx="$WORKSPACE/context"
  [ -f "$ctx/$file" ] || { err "missing: $ctx/$file"; exit 1; }

  say "deleting $file"
  # Remove from INDEX.md (any line referencing this file).
  if [ "$DRY_RUN" = 1 ]; then
    local hits
    hits=$(grep -c "($file)" "$ctx/INDEX.md" || true)
    say "[dry-run] would remove $hits INDEX entries"
    say "[dry-run] would: rm $ctx/$file"
  else
    sed -i '' "/($file)/d" "$ctx/INDEX.md"
    rm "$ctx/$file"
  fi
  append_log "$ctx" "deleted" "$file" "removed (noise/superseded)"
  local slug="${file%.md}"
  purge_source_entities "$slug"
  say "✓ deleted $file"
}

cmd_audit() {
  WORKSPACE=$(resolve_workspace)
  local ctx="$WORKSPACE/context"

  say ""
  say "=== TLD-suffix files (potential consolidation candidates) ==="
  ls "$ctx"/*.md 2>/dev/null \
    | xargs -n1 basename \
    | grep -iE -- '-(com|net|org|io|ai|app|edu|us|au|ca|uk|co)\.md$' \
    | sort \
    || say "(none)"

  say ""
  say "=== Stub-like pages (<40 lines, no Role/Timeline/Related) ==="
  for f in "$ctx"/*.md; do
    local lines; lines=$(wc -l < "$f")
    if [ "$lines" -lt 40 ] && [ "$lines" -gt 5 ]; then
      if ! grep -qE '^## (Role|Timeline|Related|Relationships|Details)' "$f"; then
        printf '%4d  %s\n' "$lines" "$(basename "$f")"
      fi
    fi
  done | head -30

  say ""
  say "=== INDEX entries pointing to missing files ==="
  grep -oE '\(([a-z0-9_-]+\.md)\)' "$ctx/INDEX.md" \
    | tr -d '()' | sort -u \
    | while read -r f; do
        [ -f "$ctx/$f" ] || say "  MISSING: $f"
      done

  say ""
  say "=== Person pages where parent company page exists (merge candidates) ==="
  # Heuristic: page name ends in -<domain-form>-com / -net etc. AND a sibling
  # page exists at <domain-stem>.md
  for f in "$ctx"/*-com.md "$ctx"/*-net.md "$ctx"/*-co.md; do
    [ -f "$f" ] || continue
    local base; base=$(basename "$f" .md)
    # Strip trailing TLD form
    local stem="${base%-com}"
    stem="${stem%-net}"
    stem="${stem%-co}"
    # Try the rightmost token as the domain-stem candidate
    local domain_stem; domain_stem=$(echo "$stem" | awk -F'-' '{print $NF}')
    if [ -f "$ctx/$domain_stem.md" ]; then
      say "  $f → maybe merge into $domain_stem.md"
    fi
  done | sort -u | head -20
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

[ $# -lt 1 ] && usage

cmd="$1"; shift
case "$cmd" in
  merge) cmd_merge "$@";;
  rename) cmd_rename "$@";;
  delete) cmd_delete "$@";;
  audit) cmd_audit "$@";;
  -h|--help|help) usage;;
  *) err "unknown command: $cmd"; usage;;
esac
