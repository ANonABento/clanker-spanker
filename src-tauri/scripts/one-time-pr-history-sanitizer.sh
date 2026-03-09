#!/usr/bin/env bash
#
# One-time PR history checker + sanitizer.
# - Checker mode (default): summarizes changed files/commits for a PR branch.
# - Apply mode (--apply): rewrites PR branch to keep only selected paths.
#
# Safe defaults:
# - No branch rewrite unless --apply is passed.
# - No remote update unless --push is passed.
# - Uses a temporary git worktree to avoid disturbing current workspace.
#
# Examples:
#   ./one-time-pr-history-sanitizer.sh --pr 5793
#   ./one-time-pr-history-sanitizer.sh --pr 5793 --keep-path apps/evals-web --apply
#   ./one-time-pr-history-sanitizer.sh --pr 5793 --keep-path apps/evals-web --apply --push
#   ./one-time-pr-history-sanitizer.sh --pr 5793 --keep-from-threads
#

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  one-time-pr-history-sanitizer.sh --pr <number> [options]

Options:
  --pr <number>              PR number (required)
  --repo <owner/name>        Repo override (default: gh repo view current)
  --keep-path <path>         Keep only this path (repeatable, repo-relative)
  --keep-from-threads        Add keep paths from PR review thread file paths
  --apply                    Build sanitized rewritten branch state
  --push                     Force-push rewritten state back to PR branch (requires --apply)
  --show-commits             Print per-commit changed file lists in checker output
  -h, --help                 Show this help

Behavior:
  - Without --apply: checker-only mode (no git mutation)
  - With --apply and no --push: rewrite prepared locally, no remote update
  - With --apply --push: rewritten state pushed using --force-with-lease
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ Missing required command: $cmd" >&2
    exit 1
  fi
}

normalize_repo_from_remote() {
  local remote="$1"
  remote="${remote#ssh://git@github.com/}"
  remote="${remote#git@github.com:}"
  remote="${remote#https://github.com/}"
  remote="${remote#http://github.com/}"
  remote="${remote#git://github.com/}"
  remote="${remote%.git}"
  echo "$remote"
}

path_is_kept() {
  local file="$1"
  local keep
  for keep in "${KEEP_PATHS[@]}"; do
    keep="${keep%/}"
    [ -z "$keep" ] && continue
    if [ "$file" = "$keep" ] || [[ "$file" == "$keep/"* ]]; then
      return 0
    fi
  done
  return 1
}

PR_NUM=""
REPO=""
APPLY=0
PUSH=0
SHOW_COMMITS=0
KEEP_FROM_THREADS=0
KEEP_PATHS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --pr)
      PR_NUM="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --keep-path)
      KEEP_PATHS+=("${2:-}")
      shift 2
      ;;
    --keep-from-threads)
      KEEP_FROM_THREADS=1
      shift
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    --push)
      PUSH=1
      shift
      ;;
    --show-commits)
      SHOW_COMMITS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "❌ Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$PR_NUM" ]; then
  echo "❌ --pr is required" >&2
  usage
  exit 1
fi

if [ "$PUSH" -eq 1 ] && [ "$APPLY" -ne 1 ]; then
  echo "❌ --push requires --apply" >&2
  exit 1
fi

require_cmd git
require_cmd gh
require_cmd jq

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT_DIR" ]; then
  echo "❌ Must run inside a git repository" >&2
  exit 1
fi

if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
fi

REMOTE_REPO=$(normalize_repo_from_remote "$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || true)")
if [ -n "$REMOTE_REPO" ] && [ "$REMOTE_REPO" != "$REPO" ]; then
  echo "❌ Repo mismatch" >&2
  echo "   Expected: $REPO" >&2
  echo "   Found:    $REMOTE_REPO" >&2
  exit 1
fi

PR_JSON=$(gh pr view "$PR_NUM" --repo "$REPO" \
  --json number,title,state,headRefName,headRefOid,baseRefName,isCrossRepository,headRepository \
  2>/dev/null || true)

if [ -z "$PR_JSON" ] || ! echo "$PR_JSON" | jq -e . >/dev/null 2>&1; then
  echo "❌ Failed to fetch PR metadata for #$PR_NUM ($REPO)" >&2
  exit 1
fi

PR_STATE=$(echo "$PR_JSON" | jq -r '.state // "UNKNOWN"')
HEAD_REF=$(echo "$PR_JSON" | jq -r '.headRefName // empty')
HEAD_OID=$(echo "$PR_JSON" | jq -r '.headRefOid // empty')
BASE_REF=$(echo "$PR_JSON" | jq -r '.baseRefName // empty')
IS_CROSS=$(echo "$PR_JSON" | jq -r 'if .isCrossRepository then 1 else 0 end')
PR_TITLE=$(echo "$PR_JSON" | jq -r '.title // ""')

if [ -z "$HEAD_REF" ] || [ -z "$BASE_REF" ] || [ -z "$HEAD_OID" ]; then
  echo "❌ Missing PR head/base metadata" >&2
  exit 1
fi

if [ "$IS_CROSS" -eq 1 ]; then
  echo "❌ Cross-repository PR detected; this sanitizer currently supports same-repo PR heads only." >&2
  exit 1
fi

echo "📋 PR #$PR_NUM: $PR_TITLE"
echo "   Repo: $REPO"
echo "   State: $PR_STATE"
echo "   Base: $BASE_REF"
echo "   Head: $HEAD_REF ($HEAD_OID)"
echo ""

git -C "$ROOT_DIR" fetch origin "$BASE_REF" "$HEAD_REF" >/dev/null

RANGE="origin/$BASE_REF..origin/$HEAD_REF"
COMMIT_COUNT=$(git -C "$ROOT_DIR" rev-list --count "$RANGE" 2>/dev/null || echo "0")
CHANGED_FILES=$(git -C "$ROOT_DIR" diff --name-only "$RANGE" 2>/dev/null || true)
FILE_COUNT=$(printf "%s\n" "$CHANGED_FILES" | sed '/^$/d' | wc -l | tr -d ' ')

echo "🔍 Checker Summary"
echo "   Commits in range: $COMMIT_COUNT"
echo "   Changed files:    ${FILE_COUNT:-0}"
echo ""

if [ -n "$CHANGED_FILES" ]; then
  echo "Top-level path distribution:"
  printf "%s\n" "$CHANGED_FILES" | awk -F/ '{print $1}' | sort | uniq -c | sort -nr | sed 's/^/  /'
  echo ""
else
  echo "No changed files in PR range."
  echo ""
fi

if [ "$SHOW_COMMITS" -eq 1 ]; then
  echo "Commit breakdown:"
  while IFS= read -r sha; do
    [ -z "$sha" ] && continue
    subj=$(git -C "$ROOT_DIR" show -s --format='%h %s' "$sha")
    echo "  $subj"
    git -C "$ROOT_DIR" diff-tree --no-commit-id --name-only -r "$sha" | sed 's/^/    - /'
  done < <(git -C "$ROOT_DIR" rev-list --reverse "$RANGE")
  echo ""
fi

if [ "$KEEP_FROM_THREADS" -eq 1 ]; then
  THREAD_QUERY='query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { path }
      }
    }
  }
}'
  OWNER="${REPO%%/*}"
  REPO_NAME="${REPO##*/}"
  cursor=""
  paths_accum=""
  while true; do
    if [ -z "$cursor" ]; then
      page=$(gh api graphql -f query="$THREAD_QUERY" -F owner="$OWNER" -F repo="$REPO_NAME" -F number="$PR_NUM" 2>/dev/null || true)
    else
      page=$(gh api graphql -f query="$THREAD_QUERY" -F owner="$OWNER" -F repo="$REPO_NAME" -F number="$PR_NUM" -F cursor="$cursor" 2>/dev/null || true)
    fi
    if [ -z "$page" ] || echo "$page" | jq -e '.errors' >/dev/null 2>&1; then
      echo "⚠️ Could not fetch thread paths for --keep-from-threads (continuing)." >&2
      break
    fi
    page_paths=$(echo "$page" | jq -r '.data.repository.pullRequest.reviewThreads.nodes[]?.path // empty')
    if [ -n "$page_paths" ]; then
      paths_accum="${paths_accum}"$'\n'"${page_paths}"
    fi
    has_next=$(echo "$page" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage // false')
    if [ "$has_next" != "true" ]; then
      break
    fi
    cursor=$(echo "$page" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // empty')
    [ -z "$cursor" ] && break
  done

  if [ -n "$paths_accum" ]; then
    while IFS= read -r p; do
      [ -n "$p" ] && KEEP_PATHS+=("$p")
    done < <(printf "%s\n" "$paths_accum")
    echo "ℹ️ Added keep paths from review threads."
  else
    echo "⚠️ No thread paths found for --keep-from-threads."
  fi
fi

if [ "${#KEEP_PATHS[@]}" -gt 0 ]; then
  mapfile -t KEEP_PATHS < <(printf "%s\n" "${KEEP_PATHS[@]}" | sed 's#/$##' | sed '/^$/d' | awk '!seen[$0]++')
fi

if [ "${#KEEP_PATHS[@]}" -gt 0 ]; then
  keep_count=0
  drop_count=0
  dropped_files=""
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if path_is_kept "$f"; then
      keep_count=$((keep_count + 1))
    else
      drop_count=$((drop_count + 1))
      dropped_files="${dropped_files}${f}"$'\n'
    fi
  done <<< "$CHANGED_FILES"

  echo ""
  echo "🧭 Scope Preview"
  echo "   Keep paths:"
  printf "%s\n" "${KEEP_PATHS[@]}" | sed 's/^/   - /'
  echo "   Files kept by rule:   $keep_count"
  echo "   Files dropped by rule: $drop_count"
fi

if [ "$APPLY" -ne 1 ]; then
  echo ""
  echo "Dry run complete. Re-run with --apply to create sanitized rewritten state."
  exit 0
fi

if [ "${#KEEP_PATHS[@]}" -eq 0 ]; then
  echo "❌ --apply requires at least one keep path (use --keep-path and/or --keep-from-threads)." >&2
  exit 1
fi

TMP_WORKTREE=""
cleanup() {
  if [ -n "$TMP_WORKTREE" ] && [ -d "$TMP_WORKTREE" ]; then
    git -C "$ROOT_DIR" worktree remove --force "$TMP_WORKTREE" >/dev/null 2>&1 || true
    rm -rf "$TMP_WORKTREE" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

TMP_WORKTREE=$(mktemp -d "${TMPDIR:-/tmp}/clanker-pr-sanitize-${PR_NUM}-XXXX")
git -C "$ROOT_DIR" worktree add "$TMP_WORKTREE" "origin/$HEAD_REF" >/dev/null

backup_branch="backup/pr-${PR_NUM}-${HEAD_REF//\//-}-$(date '+%Y%m%d-%H%M%S')"
echo ""
echo "🛟 Creating backup branch on origin: $backup_branch"
git -C "$TMP_WORKTREE" push origin "origin/$HEAD_REF:refs/heads/$backup_branch" >/dev/null

echo "🧱 Rebuilding sanitized PR branch state in temporary worktree..."
git -C "$TMP_WORKTREE" checkout -B "$HEAD_REF" "origin/$BASE_REF" >/dev/null
git -C "$TMP_WORKTREE" checkout "origin/$HEAD_REF" -- "${KEEP_PATHS[@]}" || true

if [ -z "$(git -C "$TMP_WORKTREE" status --porcelain --untracked-files=no)" ]; then
  echo "❌ No scoped changes to commit after applying keep paths." >&2
  exit 1
fi

git -C "$TMP_WORKTREE" add -A
keep_list="$(printf "%s\n" "${KEEP_PATHS[@]}" | sed 's/^/- /')"
git -C "$TMP_WORKTREE" commit -m "Sanitize PR #$PR_NUM to scoped files" -m "Kept paths:
$keep_list" >/dev/null

new_head=$(git -C "$TMP_WORKTREE" rev-parse HEAD)
echo "✅ Rewritten commit created: $new_head"

if [ "$PUSH" -eq 1 ]; then
  echo "🚀 Force-pushing sanitized history to origin/$HEAD_REF (lease on $HEAD_OID)..."
  git -C "$TMP_WORKTREE" push \
    --force-with-lease="refs/heads/$HEAD_REF:$HEAD_OID" \
    origin "HEAD:refs/heads/$HEAD_REF"
  echo "✅ Push complete."
  echo "   Backup preserved at: origin/$backup_branch"
else
  echo "ℹ️ Not pushed (no --push)."
  echo "   To push manually:"
  echo "   git -C \"$TMP_WORKTREE\" push --force-with-lease=\"refs/heads/$HEAD_REF:$HEAD_OID\" origin \"HEAD:refs/heads/$HEAD_REF\""
  echo "   Backup branch already created: origin/$backup_branch"
fi
