#!/bin/bash
#
# Clanker Spanker - PR Monitor Loop
# Monitors PR for new comments and auto-fixes them via Claude or Codex
#
# Usage: ./monitor-pr-loop.sh <PR_NUMBER> <REPO> [MAX_ITERATIONS] [INTERVAL_MINUTES] [PENDING_WAIT_MINUTES] [STEPS]
#

set -e

# ANSI color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

PR_NUM="${1:?Usage: $0 <PR_NUMBER> <REPO> [MAX_ITERATIONS] [INTERVAL_MINUTES] [PENDING_WAIT_MINUTES] [FIX_FLAGS] [RUNNER] [MODEL] [IGNORED_CHECKS]}"
REPO="${2:?Usage: $0 <PR_NUMBER> <REPO> [MAX_ITERATIONS] [INTERVAL_MINUTES] [PENDING_WAIT_MINUTES] [FIX_FLAGS] [RUNNER] [MODEL] [IGNORED_CHECKS]}"
MAX_ITER="${3:-10}"
INTERVAL="${4:-15}"
PENDING_WAIT_MINUTES="${5:-15}"
FIX_FLAGS="${6:-ci,comments}"
RUNNER="${7:-auto}"
MODEL="${8:-auto}"
IGNORED_CHECKS="${9:-}"  # Pipe-separated list of check names to ignore (e.g., "PR QA Plan Enforcer|lint")

# Parse comma-separated fix flags
DO_CI=0
DO_COMMENTS=0
DO_CONFLICTS=0
[[ "$FIX_FLAGS" == *"ci"* ]] && DO_CI=1
[[ "$FIX_FLAGS" == *"comments"* ]] && DO_COMMENTS=1
[[ "$FIX_FLAGS" == *"conflicts"* ]] && DO_CONFLICTS=1

# Determine AI provider from runner
if [ "$RUNNER" = "codex" ]; then
  AI_PROVIDER="codex"
elif [ "$RUNNER" = "claude" ]; then
  AI_PROVIDER="claude"
else
  # Auto: prefer claude if available, else codex
  if command -v claude &>/dev/null; then
    AI_PROVIDER="claude"
  elif command -v codex &>/dev/null; then
    AI_PROVIDER="codex"
  else
    AI_PROVIDER="claude"  # fallback
  fi
fi

# Retry interval on errors (in minutes)
QUICK_RETRY_INTERVAL=2

# Parse owner/repo
OWNER="${REPO%%/*}"
REPO_NAME="${REPO##*/}"

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

is_git_repo_dir() {
  local dir="$1"
  [ -e "$dir/.git" ] || return 1
  git -C "$dir" rev-parse --is-inside-work-tree > /dev/null 2>&1
}

get_repo_for_dir() {
  local dir="$1"
  local remote_url
  remote_url=$(git -C "$dir" remote get-url origin 2>/dev/null || true)
  if [ -z "$remote_url" ]; then
    return 1
  fi
  normalize_repo_from_remote "$remote_url"
}

# Find local clone of the target repo
# Check common locations (includes variations like HammingHQ -> HammingAI)
# Also check Conductor workspace structure: ~/conductor/workspaces/{repo}/{workspace}/
OWNER_VARIANTS=("$OWNER" "${OWNER%HQ}AI" "${OWNER%HQ}" "${OWNER}AI")
REPO_PATHS=()

# First priority: Conductor workspaces (use most recently modified)
# Find all workspaces for this repo and pick the newest
# Note: Conductor uses git worktrees, so .git is a file not a directory
CONDUCTOR_WORKSPACE_DIR="$HOME/conductor/workspaces/$REPO_NAME"
if [ -d "$CONDUCTOR_WORKSPACE_DIR" ]; then
  # Find the most recently modified workspace with a .git entry (worktree file or repo dir)
  NEWEST_WORKSPACE=$(find "$CONDUCTOR_WORKSPACE_DIR" -maxdepth 2 -name ".git" 2>/dev/null | \
    xargs -I{} dirname {} | \
    xargs -I{} stat -f "%m %N" {} 2>/dev/null | \
    sort -rn | head -1 | cut -d' ' -f2-)
  if [ -n "$NEWEST_WORKSPACE" ]; then
    REPO_PATHS+=("$NEWEST_WORKSPACE")
  fi
fi

# Then check owner variant paths
for ov in "${OWNER_VARIANTS[@]}"; do
  REPO_PATHS+=(
    "$HOME/$ov/$REPO_NAME"
    "$HOME/repos/$ov/$REPO_NAME"
    "$HOME/code/$ov/$REPO_NAME"
  )
done
REPO_PATHS+=(
  "$HOME/repos/$REPO_NAME"
  "$HOME/code/$REPO_NAME"
  "$HOME/projects/$REPO_NAME"
  "$HOME/workspace/$REPO_NAME"
  "$HOME/ghq/github.com/$OWNER/$REPO_NAME"
)

REPO_DIR=""
for path in "${REPO_PATHS[@]}"; do
  # Handle glob patterns
  for expanded in $path; do
    if is_git_repo_dir "$expanded"; then
      REPO_DIR="$expanded"
      break 2
    fi
  done
done

if [ -z "$REPO_DIR" ]; then
  echo -e "${YELLOW}⚠️  Warning: Could not find local clone of $REPO${RESET}"
  echo -e "${DIM}    Checked: ~/repos, ~/code, ~/projects, ~/workspace, ~/ghq, ~/conductor/workspaces${RESET}"
  echo -e "${DIM}    AI tool will run from current directory - file edits may not work correctly${RESET}"
  REPO_DIR="."
else
  echo -e "${DIM}📁 Found repo at: $REPO_DIR${RESET}"
fi

# Validate selected workspace points at the target repo. If not, try to find a better match.
if [ -n "$REPO_DIR" ] && [ "$REPO_DIR" != "." ]; then
  CURRENT_REPO_FROM_REMOTE=$(get_repo_for_dir "$REPO_DIR" || true)
  if [ -n "$CURRENT_REPO_FROM_REMOTE" ] && [ "$CURRENT_REPO_FROM_REMOTE" != "$REPO" ]; then
    MATCHING_REPO_DIR=""
    for path in "${REPO_PATHS[@]}"; do
      for expanded in $path; do
        if is_git_repo_dir "$expanded"; then
          candidate_repo=$(get_repo_for_dir "$expanded" || true)
          if [ "$candidate_repo" = "$REPO" ]; then
            MATCHING_REPO_DIR="$expanded"
            break 2
          fi
        fi
      done
    done

    if [ -n "$MATCHING_REPO_DIR" ]; then
      REPO_DIR="$MATCHING_REPO_DIR"
      echo -e "${DIM}📁 Switched to matching repo workspace: $REPO_DIR${RESET}"
    else
      echo -e "${RED}❌ Workspace repo mismatch.${RESET}"
      echo -e "${DIM}   Expected: $REPO${RESET}"
      echo -e "${DIM}   Found:    ${CURRENT_REPO_FROM_REMOTE:-unknown}${RESET}"
      exit 1
    fi
  fi
fi

BASE_REPO_DIR="$REPO_DIR"

# State tracking (in temp directory)
STATE_DIR="${TMPDIR:-/tmp}/clanker-spanker"
STATE_FILE="$STATE_DIR/pr-${OWNER}-${REPO_NAME}-${PR_NUM}.json"

# GraphQL query for full thread data (with pagination support)
GRAPHQL_QUERY='query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isResolved
          path
          line
          comments(first: 10) {
            nodes {
              id
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}'

# Threads file for passing unresolved-thread context to the AI provider
THREADS_FILE="$STATE_DIR/pr-${OWNER}-${REPO_NAME}-${PR_NUM}-threads.json"
HISTORY_ALLOWLIST_FILE="$STATE_DIR/pr-${OWNER}-${REPO_NAME}-${PR_NUM}-history-allowlist.txt"
HISTORY_DROP_FILE="$STATE_DIR/pr-${OWNER}-${REPO_NAME}-${PR_NUM}-history-drop.txt"
HISTORY_CANONICAL_ROOTS_FILE="$STATE_DIR/pr-${OWNER}-${REPO_NAME}-${PR_NUM}-history-canonical-roots.txt"
HISTORY_THREAD_SCOPE_CUTOFF=""
HISTORY_PRIMARY_ROOT=""
HISTORY_PRIMARY_ROOT_RATIO=0

fetch_pr_head_info() {
  local pr_head_query='query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      state
      mergedAt
      headRefName
      headRefOid
      baseRefName
      isCrossRepository
      headRepository {
        nameWithOwner
      }
    }
  }
}'

  local result stderr_output
  stderr_output=$(mktemp)
  result=$(gh api graphql -f query="$pr_head_query" -F owner="$OWNER" -F repo="$REPO_NAME" -F number="$PR_NUM" 2>"$stderr_output" || true)

  if [ -z "$result" ] || echo "$result" | jq -e '.errors' > /dev/null 2>&1; then
    # Check for rate limit error
    if echo "$result" | jq -e '.errors[]?.type == "RATE_LIMIT"' > /dev/null 2>&1 || grep -q "rate limit" "$stderr_output" 2>/dev/null; then
      local reset_time
      reset_time=$(gh api rate_limit --jq '.resources.graphql.reset | strftime("%H:%M:%S UTC")' 2>/dev/null || echo "unknown")
      echo -e "${RED}❌ GitHub API rate limit exceeded. Resets at: ${reset_time}${RESET}" >&2
      FETCH_PR_ERROR="rate_limit"
    fi
    rm -f "$stderr_output"
    return 1
  fi
  rm -f "$stderr_output"

  EXPECTED_PR_HEAD_BRANCH=$(echo "$result" | jq -r '.data.repository.pullRequest.headRefName // empty')
  EXPECTED_PR_HEAD_OID=$(echo "$result" | jq -r '.data.repository.pullRequest.headRefOid // empty')
  PR_BASE_REF=$(echo "$result" | jq -r '.data.repository.pullRequest.baseRefName // empty')
  PR_STATE=$(echo "$result" | jq -r '.data.repository.pullRequest.state // "UNKNOWN"')
  PR_MERGED_AT=$(echo "$result" | jq -r '.data.repository.pullRequest.mergedAt // empty')
  PR_IS_CROSS_REPO=$(echo "$result" | jq -r 'if .data.repository.pullRequest.isCrossRepository then 1 else 0 end')
  PR_HEAD_REPO=$(echo "$result" | jq -r '.data.repository.pullRequest.headRepository.nameWithOwner // empty')

  if [ -z "$EXPECTED_PR_HEAD_BRANCH" ] || [ -z "$PR_BASE_REF" ]; then
    return 1
  fi

  return 0
}

push_head_to_pr_branch() {
  local action_label="$1"

  if [ -z "$EXPECTED_PR_HEAD_BRANCH" ]; then
    echo -e "${RED}❌ Cannot push for ${action_label}: PR head branch is unknown.${RESET}"
    return 1
  fi

  if ! (cd "$REPO_DIR" && git push origin "HEAD:refs/heads/$EXPECTED_PR_HEAD_BRANCH"); then
    echo -e "${RED}❌ git push to PR head branch failed after ${action_label}.${RESET}"
    return 1
  fi

  local local_head remote_head
  local_head=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)
  remote_head=$(git -C "$REPO_DIR" ls-remote --heads origin "$EXPECTED_PR_HEAD_BRANCH" 2>/dev/null | awk 'NR==1 {print $1}')
  if [ -z "$local_head" ] || [ -z "$remote_head" ] || [ "$local_head" != "$remote_head" ]; then
    echo -e "${RED}❌ Remote PR head branch is not aligned after push for ${action_label}.${RESET}"
    return 1
  fi

  # git ls-remote already confirmed the push succeeded — no need to poll gh API
  EXPECTED_PR_HEAD_OID="$local_head"
  return 0
}

setup_monitor_worktree() {
  if [ -z "$EXPECTED_PR_HEAD_BRANCH" ]; then
    echo -e "${RED}❌ Cannot create monitor worktree: PR head branch is unknown.${RESET}"
    return 1
  fi

  if [ -z "$BASE_REPO_DIR" ] || [ "$BASE_REPO_DIR" = "." ]; then
    echo -e "${RED}❌ Cannot create monitor worktree without a local base repository.${RESET}"
    return 1
  fi

  local token
  token="$(date '+%Y%m%d-%H%M%S')-$$-$RANDOM"
  MONITOR_WORKTREE_DIR="$STATE_DIR/worktrees/${OWNER}-${REPO_NAME}/pr-${PR_NUM}-${token}"
  MONITOR_WORKTREE_BRANCH="clanker-monitor/pr-${PR_NUM}-${token}"

  mkdir -p "$(dirname "$MONITOR_WORKTREE_DIR")"

  if ! (cd "$BASE_REPO_DIR" && git fetch origin "$PR_BASE_REF" >/dev/null 2>&1); then
    echo -e "${RED}❌ Failed to fetch origin/$PR_BASE_REF for monitor worktree.${RESET}"
    return 1
  fi

  local head_exists=0
  if (cd "$BASE_REPO_DIR" && git ls-remote --exit-code --heads origin "$EXPECTED_PR_HEAD_BRANCH" >/dev/null 2>&1); then
    head_exists=1
  fi

  if [ "$head_exists" -ne 1 ]; then
    # Refresh once in case head branch changed since initial preflight fetch.
    fetch_pr_head_info >/dev/null 2>&1 || true
    if (cd "$BASE_REPO_DIR" && git ls-remote --exit-code --heads origin "$EXPECTED_PR_HEAD_BRANCH" >/dev/null 2>&1); then
      head_exists=1
    fi
  fi

  if [ "$head_exists" -ne 1 ]; then
    echo -e "${RED}❌ PR head branch is missing on origin: $EXPECTED_PR_HEAD_BRANCH${RESET}"
    if [ "$PR_STATE" != "OPEN" ]; then
      echo -e "${DIM}   PR state is $PR_STATE (mergedAt=${PR_MERGED_AT:-n/a}). Branch deletion is expected.${RESET}"
    else
      echo -e "${DIM}   PR is OPEN, so this is unexpected branch drift. Verify PR head branch and rerun.${RESET}"
    fi
    return 1
  fi

  if ! (cd "$BASE_REPO_DIR" && git fetch origin "$EXPECTED_PR_HEAD_BRANCH" >/dev/null 2>&1); then
    echo -e "${RED}❌ Failed to fetch origin/$EXPECTED_PR_HEAD_BRANCH for monitor worktree.${RESET}"
    return 1
  fi

  if ! (cd "$BASE_REPO_DIR" && git worktree add -B "$MONITOR_WORKTREE_BRANCH" "$MONITOR_WORKTREE_DIR" "origin/$EXPECTED_PR_HEAD_BRANCH" >/dev/null 2>&1); then
    echo -e "${RED}❌ Failed to create isolated monitor worktree.${RESET}"
    return 1
  fi

  REPO_DIR="$MONITOR_WORKTREE_DIR"
  echo -e "${DIM}🧪 Isolated monitor workspace: $REPO_DIR${RESET}"
  return 0
}

cleanup_monitor_artifacts() {
  if [ "${CLEANUP_DONE:-0}" -eq 1 ]; then
    return
  fi
  CLEANUP_DONE=1

  rm -f "$STATE_FILE" "$THREADS_FILE" "$HISTORY_ALLOWLIST_FILE" "$HISTORY_DROP_FILE" "$HISTORY_CANONICAL_ROOTS_FILE" >/dev/null 2>&1 || true

  if [ -n "${MONITOR_WORKTREE_DIR:-}" ] && [ -d "$MONITOR_WORKTREE_DIR" ]; then
    if [ -n "${BASE_REPO_DIR:-}" ] && git -C "$BASE_REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      git -C "$BASE_REPO_DIR" worktree remove --force "$MONITOR_WORKTREE_DIR" >/dev/null 2>&1 || true
      if [ -d "$MONITOR_WORKTREE_DIR" ]; then
        rm -rf "$MONITOR_WORKTREE_DIR" >/dev/null 2>&1 || true
      fi
      if [ -n "${MONITOR_WORKTREE_BRANCH:-}" ]; then
        git -C "$BASE_REPO_DIR" branch -D "$MONITOR_WORKTREE_BRANCH" >/dev/null 2>&1 || true
      fi
    else
      rm -rf "$MONITOR_WORKTREE_DIR" >/dev/null 2>&1 || true
    fi
  fi
}

has_in_progress_git_operation() {
  local git_dir
  git_dir=$(git -C "$REPO_DIR" rev-parse --git-dir 2>/dev/null || true)
  if [ -z "$git_dir" ]; then
    return 1
  fi
  case "$git_dir" in
    /*) ;;
    *) git_dir="$REPO_DIR/$git_dir" ;;
  esac

  [ -f "$git_dir/MERGE_HEAD" ] && return 0
  [ -f "$git_dir/CHERRY_PICK_HEAD" ] && return 0
  [ -f "$git_dir/REVERT_HEAD" ] && return 0
  [ -f "$git_dir/REBASE_HEAD" ] && return 0
  [ -d "$git_dir/rebase-apply" ] && return 0
  [ -d "$git_dir/rebase-merge" ] && return 0
  return 1
}

ensure_workspace_ready() {
  local context="$1"

  if has_in_progress_git_operation; then
    if [ "$DIRTY_WORKTREE_POLICY" = "stash" ]; then
      echo -e "${YELLOW}⚠️ Git operation in progress during ${context}; trying to abort it before continuing...${RESET}"
      (cd "$REPO_DIR" && git merge --abort >/dev/null 2>&1 || true)
      (cd "$REPO_DIR" && git rebase --abort >/dev/null 2>&1 || true)
      (cd "$REPO_DIR" && git cherry-pick --abort >/dev/null 2>&1 || true)
      (cd "$REPO_DIR" && git revert --abort >/dev/null 2>&1 || true)
      if has_in_progress_git_operation; then
        echo -e "${RED}❌ Could not clear in-progress git operation during ${context}.${RESET}"
        return 1
      fi
      echo "@@WORKSPACE_ABORTED_OP:1@@"
    else
      echo -e "${RED}❌ Git operation in progress during ${context}.${RESET}"
      echo -e "${DIM}   Resolve/abort it manually, or enable auto-stash policy in Settings.${RESET}"
      return 1
    fi
  fi

  local tracked_dirty
  tracked_dirty=$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)
  if [ -n "$tracked_dirty" ]; then
    if [ "$DIRTY_WORKTREE_POLICY" = "stash" ]; then
      local stash_name
      stash_name="clanker-spanker:auto-stash:pr-${PR_NUM}:$(date '+%Y%m%d-%H%M%S')"
      if (cd "$REPO_DIR" && git stash push --include-untracked -m "$stash_name" >/dev/null); then
        echo "@@WORKSPACE_STASHED:$stash_name@@"
        echo -e "${YELLOW}⚠️ Auto-stashed local changes during ${context}.${RESET}"
      else
        echo -e "${RED}❌ Failed to auto-stash local changes during ${context}.${RESET}"
        return 1
      fi
    else
      echo -e "${RED}❌ Repository has local changes during ${context}.${RESET}"
      echo -e "${DIM}   Monitor policy is 'abort'. Enable auto-stash in Settings to continue automatically.${RESET}"
      return 1
    fi
  fi

  return 0
}

preflight_checks() {
  local failed=0
  local worktree_ready=0

  for cmd in gh jq git; do
    if ! command -v "$cmd" &> /dev/null; then
      echo -e "${RED}❌ Missing required command: $cmd${RESET}"
      failed=1
    fi
  done

  if [ "$AI_PROVIDER" = "claude" ] && ! command -v claude &> /dev/null; then
    echo -e "${RED}❌ Claude provider selected but claude CLI is not installed.${RESET}"
    failed=1
  fi

  if [ "$AI_PROVIDER" = "codex" ] && ! command -v codex &> /dev/null; then
    echo -e "${RED}❌ Codex provider selected but codex CLI is not installed.${RESET}"
    failed=1
  fi

  if ! gh auth status > /dev/null 2>&1; then
    echo -e "${RED}❌ gh is not authenticated. Run: gh auth login${RESET}"
    failed=1
  fi

  FETCH_PR_ERROR=""
  if ! fetch_pr_head_info; then
    if [ "$FETCH_PR_ERROR" != "rate_limit" ]; then
      echo -e "${RED}❌ Could not fetch PR head branch info for #$PR_NUM.${RESET}"
    fi
    failed=1
  fi

  if [ "$failed" -eq 0 ] && [ "$PR_STATE" != "OPEN" ]; then
    local state_lower
    state_lower=$(echo "$PR_STATE" | tr '[:upper:]' '[:lower:]')
    echo "@@STATUS:clean@@"
    if [ -n "$PR_MERGED_AT" ]; then
      echo -e "${GREEN}${BOLD}✅ PR is already ${state_lower} (merged at ${PR_MERGED_AT}). Nothing to monitor.${RESET}"
    else
      echo -e "${GREEN}${BOLD}✅ PR is already ${state_lower}. Nothing to monitor.${RESET}"
    fi
    echo ""
    echo -e "${GREEN}╭─────────────────────────────────────────────────────────────╮${RESET}"
    echo -e "${GREEN}│${RESET}  ${GREEN}${BOLD}✅ Monitor Complete${RESET} - PR ${MAGENTA}#$PR_NUM${RESET}"
    echo -e "${GREEN}│${RESET}  ${DIM}Iterations: 0 | Exit: PR not open${RESET}"
    echo -e "${GREEN}╰─────────────────────────────────────────────────────────────╯${RESET}"
    exit 0
  fi

  if ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo -e "${RED}❌ REPO_DIR is not a git repo: $REPO_DIR${RESET}"
    failed=1
  fi

  if [ "${PR_IS_CROSS_REPO:-0}" -eq 1 ]; then
    echo -e "${RED}❌ Cross-repository PR detected (head repo: ${PR_HEAD_REPO:-unknown}).${RESET}"
    echo -e "${DIM}   Monitor auto-push currently supports PRs whose head branch is on origin/$EXPECTED_PR_HEAD_BRANCH.${RESET}"
    failed=1
  fi

  if ! setup_monitor_worktree; then
    failed=1
  else
    worktree_ready=1
  fi

  local resolved_repo
  resolved_repo=$(get_repo_for_dir "$REPO_DIR" || true)
  if [ -n "$resolved_repo" ] && [ "$resolved_repo" != "$REPO" ]; then
    echo -e "${RED}❌ Repo mismatch after resolution.${RESET}"
    echo -e "${DIM}   Expected: $REPO${RESET}"
    echo -e "${DIM}   Found:    $resolved_repo${RESET}"
    failed=1
  fi

  if [ "$worktree_ready" -eq 1 ]; then
    if ! ensure_workspace_ready "preflight"; then
      failed=1
    fi
  fi

  if [ "$failed" -ne 0 ]; then
    echo -e "${RED}❌ Preflight checks failed; monitor aborted.${RESET}"
    exit 1
  fi
}

trap cleanup_monitor_artifacts EXIT

# Best-effort fetch for startup banner; preflight enforces this strictly.
fetch_pr_head_info >/dev/null 2>&1 || true

echo ""
echo -e "${CYAN}╭─────────────────────────────────────────────────────────────╮${RESET}"
echo -e "${CYAN}│${RESET}  ${BOLD}📋 Clanker Spanker${RESET} - PR ${MAGENTA}#$PR_NUM${RESET}"
echo -e "${CYAN}│${RESET}  ${DIM}Repo:${RESET} $REPO"
echo -e "${CYAN}│${RESET}  ${DIM}Runner:${RESET} ${BOLD}$RUNNER${RESET} ${DIM}| Model:${RESET} ${BOLD}$MODEL${RESET}"
echo -e "${CYAN}│${RESET}  ${DIM}Checking every ${INTERVAL}m | Max $MAX_ITER iterations | Fix: $FIX_FLAGS${RESET}"
echo -e "${CYAN}╰─────────────────────────────────────────────────────────────╯${RESET}"
echo ""
echo "@@RUNNER:$RUNNER@@"
echo "@@MODEL:$MODEL@@"

preflight_checks

# Initialize state
mkdir -p "$STATE_DIR"
echo "{\"pr_number\":$PR_NUM,\"repo\":\"$REPO\",\"iteration\":0,\"known_thread_ids\":[],\"total_fixes\":0}" > "$STATE_FILE"

# Function to fetch all threads with pagination, filter to unresolved, and save to file
# Returns the count of unresolved threads
fetch_threads() {
  local cursor=""
  local all_threads="[]"
  local page=1

  while true; do
    local result
    if [ -z "$cursor" ]; then
      result=$(gh api graphql -f query="$GRAPHQL_QUERY" -F owner="$OWNER" -F repo="$REPO_NAME" -F number="$PR_NUM" 2>/dev/null)
    else
      result=$(gh api graphql -f query="$GRAPHQL_QUERY" -F owner="$OWNER" -F repo="$REPO_NAME" -F number="$PR_NUM" -F cursor="$cursor" 2>/dev/null)
    fi

    # Check for errors
    if [ -z "$result" ] || echo "$result" | jq -e '.errors' > /dev/null 2>&1; then
      echo -e "${YELLOW}⚠️ GraphQL query failed while fetching unresolved threads.${RESET}" >&2
      return 1
    fi

    # Extract nodes and merge
    local nodes=$(echo "$result" | jq -c '.data.repository.pullRequest.reviewThreads.nodes // []')
    all_threads=$(echo "$all_threads" "$nodes" | jq -s 'add')

    # Check pagination
    local has_next=$(echo "$result" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage // false')
    if [ "$has_next" != "true" ]; then
      break
    fi

    cursor=$(echo "$result" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor')
    page=$((page + 1))

    # Safety limit
    if [ $page -gt 10 ]; then
      echo -e "${YELLOW}⚠️ Pagination limit reached (1000 threads)${RESET}" >&2
      break
    fi
  done

  # Filter to unresolved and write to file
  if ! echo "$all_threads" | jq '[.[] | select(.isResolved == false)]' > "$THREADS_FILE"; then
    echo -e "${YELLOW}⚠️ Failed to write unresolved threads data.${RESET}" >&2
    return 1
  fi

  # Return count
  jq 'length' "$THREADS_FILE"
  return 0
}

# Function to get unresolved thread IDs (for backward compat / state tracking)
get_unresolved_thread_ids() {
  if [ -f "$THREADS_FILE" ]; then
    jq -r '[.[].id] | join(",")' "$THREADS_FILE"
  else
    echo ""
  fi
}

resolve_review_thread() {
  local thread_id="$1"
  [ -z "$thread_id" ] && return 0

  local result
  result=$(gh api graphql \
    -f threadId="$thread_id" \
    -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } } }' \
    2>/dev/null || true)

  if [ -z "$result" ] || echo "$result" | jq -e '.errors' > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️ Failed to resolve thread ${thread_id}.${RESET}" >&2
    return 1
  fi

  local resolved
  resolved=$(echo "$result" | jq -r '.data.resolveReviewThread.thread.isResolved // false')
  if [ "$resolved" != "true" ]; then
    echo -e "${YELLOW}⚠️ Resolve mutation returned unresolved for ${thread_id}.${RESET}" >&2
    return 1
  fi

  return 0
}

resolve_review_threads_from_csv() {
  local thread_id_csv="$1"
  local failed=0
  local thread_id

  if [ -z "$thread_id_csv" ]; then
    return 0
  fi

  IFS=',' read -r -a thread_ids <<< "$thread_id_csv"

  for thread_id in "${thread_ids[@]}"; do
    [ -z "$thread_id" ] && continue
    if ! resolve_review_thread "$thread_id"; then
      failed=1
    else
      echo -e "${GREEN}✅ Resolved review thread: ${thread_id}${RESET}"
    fi
  done

  [ "$failed" -eq 1 ] && return 1
  return 0
}

# Function to get known thread IDs from state
get_known_ids() {
  jq -r '.known_thread_ids | join(",")' "$STATE_FILE" 2>/dev/null || echo ""
}

# Function to update state
update_state() {
  local iteration=$1
  local current_ids=$2

  # Convert comma-separated to JSON array
  local ids_json="[]"
  if [ -n "$current_ids" ]; then
    ids_json=$(echo "$current_ids" | tr ',' '\n' | jq -R . | jq -s .)
  fi

  jq --argjson iter "$iteration" --argjson ids "$ids_json" \
    '.iteration = $iter | .known_thread_ids = $ids' \
    "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

build_history_path_allowlist_from_review_threads() {
  local output_file="$1"
  local cursor=""
  local all_paths=""
  local page=1

  local history_query='query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          isResolved
          path
          comments(last: 1) {
            nodes {
              createdAt
            }
          }
        }
      }
    }
  }
}'

  while true; do
    local result
    if [ -z "$cursor" ]; then
      result=$(gh api graphql -f query="$history_query" -F owner="$OWNER" -F repo="$REPO_NAME" -F number="$PR_NUM" 2>/dev/null || true)
    else
      result=$(gh api graphql -f query="$history_query" -F owner="$OWNER" -F repo="$REPO_NAME" -F number="$PR_NUM" -F cursor="$cursor" 2>/dev/null || true)
    fi

    if [ -z "$result" ] || echo "$result" | jq -e '.errors' > /dev/null 2>&1; then
      echo -e "${YELLOW}⚠️ Failed to fetch review-thread paths for history clean mode.${RESET}"
      return 1
    fi

    local page_paths
    if [ -n "$HISTORY_THREAD_SCOPE_CUTOFF" ]; then
      page_paths=$(echo "$result" | jq -r --arg cutoff "$HISTORY_THREAD_SCOPE_CUTOFF" '
        .data.repository.pullRequest.reviewThreads.nodes[]?
        | select(.isResolved == false)
        | select((.comments.nodes[0].createdAt // "") <= $cutoff)
        | .path // empty
      ')
    else
      page_paths=$(echo "$result" | jq -r '
        .data.repository.pullRequest.reviewThreads.nodes[]?
        | select(.isResolved == false)
        | .path // empty
      ')
    fi
    if [ -n "$page_paths" ]; then
      if [ -n "$all_paths" ]; then
        all_paths="${all_paths}"$'\n'"${page_paths}"
      else
        all_paths="${page_paths}"
      fi
    fi

    local has_next
    has_next=$(echo "$result" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage // false')
    if [ "$has_next" != "true" ]; then
      break
    fi

    cursor=$(echo "$result" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // empty')
    if [ -z "$cursor" ]; then
      break
    fi

    page=$((page + 1))
    if [ "$page" -gt 10 ]; then
      echo -e "${YELLOW}⚠️ Pagination limit reached while building history allowlist.${RESET}"
      break
    fi
  done

  if [ -z "$all_paths" ]; then
    : > "$output_file"
  else
    {
      # Keep exact unresolved-thread file paths.
      printf "%s\n" "$all_paths" | sed '/^$/d'

      # Also keep package roots for unresolved-thread paths to avoid over-pruning
      # in monorepos (for example: apps/foo/bar.ts -> apps/foo/).
      printf "%s\n" "$all_paths" | awk -F'/' '
        NF == 0 { next }
        $1 == "apps" && NF >= 2 { print $1 "/" $2 "/"; next }
        $1 == "packages" && NF >= 2 { print $1 "/" $2 "/"; next }
        { print $1 "/" }
      '
    } | sed '/^$/d' | awk '!seen[$0]++' > "$output_file"
  fi

  local allow_count
  allow_count=$(wc -l < "$output_file" | tr -d ' ')
  allow_count=${allow_count:-0}
  if [ "$allow_count" -eq 0 ]; then
    echo -e "${YELLOW}⚠️ History clean mode found no unresolved-thread paths to keep.${RESET}"
    return 1
  fi

  echo -e "${DIM}🔒 History scope limited to unresolved-thread paths (+ derived package roots).${RESET}"
  return 0
}

build_history_allowlist_with_ai_classifier() {
  local changed_files="$1"
  local output_file="$2"

  if [ -z "$changed_files" ] || [ -z "$output_file" ]; then
    return 1
  fi

  local changed_set keep_set
  changed_set=$(mktemp)
  keep_set=$(mktemp)
  printf "%s\n" "$changed_files" | sed '/^$/d' | sort -u > "$changed_set"
  : > "$keep_set"

  if [ ! -s "$changed_set" ]; then
    rm -f "$changed_set" "$keep_set"
    return 1
  fi

  # Best-effort unresolved-thread context. If unavailable, continue with commit context only.
  if ! fetch_threads >/dev/null 2>&1; then
    : > "$THREADS_FILE"
  fi

  local thread_context_json unresolved_paths
  if [ -n "$HISTORY_THREAD_SCOPE_CUTOFF" ]; then
    thread_context_json=$(jq -c --arg cutoff "$HISTORY_THREAD_SCOPE_CUTOFF" '
      [
        .[] | select(((.comments.nodes | last // {} | .createdAt) // "") <= $cutoff) | {
          path: (.path // ""),
          line: (.line // null),
          latest_comment: (
            (.comments.nodes | last // {}) | {
              author: (.author.login // ""),
              body: ((.body // "") | gsub("\\s+"; " ") | .[0:320]),
              created_at: (.createdAt // "")
            }
          )
        }
      ]
    ' "$THREADS_FILE" 2>/dev/null || echo "[]")
    unresolved_paths=$(jq -r --arg cutoff "$HISTORY_THREAD_SCOPE_CUTOFF" '
      .[] | select(((.comments.nodes | last // {} | .createdAt) // "") <= $cutoff) | .path // empty
    ' "$THREADS_FILE" 2>/dev/null || true)
  else
    thread_context_json=$(jq -c '
      [
        .[] | {
          path: (.path // ""),
          line: (.line // null),
          latest_comment: (
            (.comments.nodes | last // {}) | {
              author: (.author.login // ""),
              body: ((.body // "") | gsub("\\s+"; " ") | .[0:320]),
              created_at: (.createdAt // "")
            }
          )
        }
      ]
    ' "$THREADS_FILE" 2>/dev/null || echo "[]")
    unresolved_paths=$(jq -r '.[] | .path // empty' "$THREADS_FILE" 2>/dev/null || true)
  fi

  # Hard-keep unresolved-thread paths when they are still in current PR net diff.
  while IFS= read -r thread_path; do
    [ -z "$thread_path" ] && continue
    if grep -Fxq "$thread_path" "$changed_set"; then
      echo "$thread_path" >> "$keep_set"
    fi
  done <<< "$unresolved_paths"

  local pr_context_json
  pr_context_json=$(gh pr view "$PR_NUM" --repo "$REPO" --json title,body,baseRefName,headRefName \
    --jq '{title, body: ((.body // "") | gsub("\\s+"; " ") | .[0:1200]), base: .baseRefName, head: .headRefName}' 2>/dev/null || \
    echo '{"title":"","body":"","base":"","head":""}')

  local commit_lines total_commits
  commit_lines=$(gh pr view "$PR_NUM" --repo "$REPO" --json commits \
    --jq '.commits[] | [.oid, (.messageHeadline // ""), (.committedDate // "")] | @tsv' 2>/dev/null || true)

  if [ -z "$commit_lines" ]; then
    rm -f "$changed_set" "$keep_set"
    echo -e "${YELLOW}⚠️ AI commit scope judge fallback: could not fetch PR commits.${RESET}"
    return 1
  fi

  total_commits=$(printf "%s\n" "$commit_lines" | sed '/^$/d' | wc -l | tr -d ' ')
  total_commits=${total_commits:-0}
  if [ "$total_commits" -eq 0 ]; then
    rm -f "$changed_set" "$keep_set"
    return 1
  fi

  local commit_index=0
  local analyzed_commits=0
  local decision_error_commits=0
  local low_confidence_commits=0

  while IFS=$'\t' read -r commit_sha commit_subject commit_date; do
    [ -z "$commit_sha" ] && continue
    commit_index=$((commit_index + 1))

    local commit_file_meta
    commit_file_meta=$(gh api "repos/$REPO/commits/$commit_sha" \
      --jq '[.files[] | {path:.filename,status,additions,deletions}]' 2>/dev/null || true)
    if [ -z "$commit_file_meta" ] || ! echo "$commit_file_meta" | jq -e '.' >/dev/null 2>&1; then
      continue
    fi

    local candidate_files candidate_set candidate_json
    candidate_files=$(echo "$commit_file_meta" | jq -r '.[].path // empty' | grep -Fxf "$changed_set" || true)
    if [ -z "$candidate_files" ]; then
      continue
    fi

    analyzed_commits=$((analyzed_commits + 1))
    candidate_set=$(mktemp)
    printf "%s\n" "$candidate_files" | sed '/^$/d' | sort -u > "$candidate_set"
    candidate_json=$(cat "$candidate_set" | jq -R . | jq -s .)

    local filtered_meta_json
    filtered_meta_json=$(echo "$commit_file_meta" | jq -c --argjson keep "$candidate_json" '
      [ .[] | select(.path as $p | $keep | index($p)) ]
    ')

    local prompt
    read -r -d '' prompt <<EOF || true
Decide which files to keep from this commit for one-time PR history cleanup.

PR context JSON:
$pr_context_json

Unresolved review-thread context JSON:
$thread_context_json

Commit metadata:
{
  "index": $commit_index,
  "total": $total_commits,
  "sha": "$commit_sha",
  "subject": $(printf '%s' "$commit_subject" | jq -R .),
  "committed_at": $(printf '%s' "$commit_date" | jq -R .)
}

Candidate files for this commit (only files still in PR net diff):
$filtered_meta_json

Rules:
1) Only choose from candidate files.
2) Keep files that are likely part of this PR's core intent or needed to resolve review comments.
3) Drop files that look unrelated pollution from other PR work.
4) If uncertain, keep the file.
5) Return valid JSON only between markers.

Return exactly:
@@HISTORY_COMMIT_SCOPE_JSON_START@@
{"keep_files":["path1"],"drop_files":["path2"],"confidence":"high","reason":"short reason"}
@@HISTORY_COMMIT_SCOPE_JSON_END@@
EOF

    local output_tmp
    output_tmp=$(mktemp)

    if [ "$AI_PROVIDER" = "codex" ]; then
      local codex_cmd=(codex --dangerously-bypass-approvals-and-sandbox exec --skip-git-repo-check --ephemeral --color never)
      if [ -n "$AI_MODEL" ]; then
        codex_cmd+=(-m "$AI_MODEL")
      fi
      codex_cmd+=("$prompt")
      if ! (cd "$REPO_DIR" && "${codex_cmd[@]}" >"$output_tmp" 2>&1); then
        rm -f "$output_tmp"
        decision_error_commits=$((decision_error_commits + 1))
        rm -f "$candidate_set"
        continue
      fi
    else
      local claude_cmd=(claude -p "$prompt" --verbose --output-format stream-json --dangerously-skip-permissions)
      if [ -n "$AI_MODEL" ]; then
        claude_cmd+=(--model "$AI_MODEL")
      fi
      if ! (cd "$REPO_DIR" && "${claude_cmd[@]}" 2>&1 | \
        jq -r --unbuffered 'select(.type) | if .type == "assistant" then (.message.content[]?.text // empty) elif .type == "result" then (.result.content[]?.text // empty) elif .type == "content_block_delta" then (.delta.text // empty) else empty end' \
        >"$output_tmp" 2>/dev/null); then
        rm -f "$output_tmp"
        decision_error_commits=$((decision_error_commits + 1))
        rm -f "$candidate_set"
        continue
      fi
    fi

    local json_block
    json_block=$(awk '/@@HISTORY_COMMIT_SCOPE_JSON_START@@/{flag=1;next}/@@HISTORY_COMMIT_SCOPE_JSON_END@@/{flag=0}flag' "$output_tmp")
    if [ -z "$json_block" ]; then
      json_block=$(cat "$output_tmp")
    fi
    rm -f "$output_tmp"

    if [ -z "$json_block" ] || ! echo "$json_block" | jq -e '.' >/dev/null 2>&1; then
      decision_error_commits=$((decision_error_commits + 1))
      rm -f "$candidate_set"
      continue
    fi

    local confidence
    confidence=$(echo "$json_block" | jq -r '(.confidence // "unknown") | ascii_downcase')
    if [ "$confidence" = "low" ] || [ "$confidence" = "unknown" ]; then
      low_confidence_commits=$((low_confidence_commits + 1))
      decision_error_commits=$((decision_error_commits + 1))
      rm -f "$candidate_set"
      continue
    fi

    local commit_keep_raw commit_drop_raw commit_keep_set commit_drop_set
    commit_keep_raw=$(echo "$json_block" | jq -r '(.keep_files // .keep_paths // [])[]?' | grep -Fxf "$candidate_set" || true)
    commit_drop_raw=$(echo "$json_block" | jq -r '(.drop_files // .drop_paths // [])[]?' | grep -Fxf "$candidate_set" || true)

    commit_keep_set=$(mktemp)
    commit_drop_set=$(mktemp)
    printf "%s\n" "$commit_keep_raw" | sed '/^$/d' | sort -u > "$commit_keep_set"
    printf "%s\n" "$commit_drop_raw" | sed '/^$/d' | sort -u > "$commit_drop_set"

    if [ ! -s "$commit_keep_set" ]; then
      if [ -s "$commit_drop_set" ]; then
        comm -23 "$candidate_set" "$commit_drop_set" > "$commit_keep_set"
      else
        cat "$candidate_set" > "$commit_keep_set"
      fi
    fi

    if [ ! -s "$commit_keep_set" ]; then
      cat "$candidate_set" > "$commit_keep_set"
    fi

    cat "$commit_keep_set" >> "$keep_set"

    rm -f "$candidate_set" "$commit_keep_set" "$commit_drop_set"
  done <<< "$commit_lines"

  if [ "$analyzed_commits" -eq 0 ]; then
    rm -f "$changed_set" "$keep_set"
    echo -e "${YELLOW}⚠️ AI commit scope judge fallback: no commit candidates overlapped current PR net diff.${RESET}"
    return 1
  fi

  if [ "$decision_error_commits" -gt 0 ]; then
    rm -f "$changed_set" "$keep_set"
    echo -e "${RED}❌ AI commit scope judge did not produce high-confidence decisions for ${decision_error_commits} commit(s); aborting cleanup.${RESET}"
    if [ "$low_confidence_commits" -gt 0 ]; then
      echo -e "${DIM}   Low-confidence decisions: ${low_confidence_commits}${RESET}"
    fi
    return 1
  fi

  sort -u "$keep_set" -o "$keep_set"
  if [ ! -s "$keep_set" ]; then
    rm -f "$changed_set" "$keep_set"
    echo -e "${YELLOW}⚠️ AI commit scope judge fallback: keep-file set empty.${RESET}"
    return 1
  fi

  cp "$keep_set" "$output_file"

  local keep_count changed_count
  keep_count=$(wc -l < "$output_file" | tr -d ' ')
  keep_count=${keep_count:-0}
  changed_count=$(wc -l < "$changed_set" | tr -d ' ')
  changed_count=${changed_count:-0}
  echo -e "${DIM}🤖 AI commit scope judge kept ${keep_count}/${changed_count} file(s) across ${analyzed_commits} commit(s).${RESET}"

  rm -f "$changed_set" "$keep_set"
  return 0
}

build_history_canonical_roots_from_commits() {
  local range="$1"
  local output_file="$2"

  if [ -z "$range" ] || [ -z "$output_file" ]; then
    return 1
  fi

  : > "$output_file"

  local initialized=0
  local commit_sha

  # Use GitHub PR commit order (first-parent narrative) instead of raw rev-list.
  # rev-list can include merged side-history commits that should not define scope.
  local commit_stream=""
  commit_stream=$(gh pr view "$PR_NUM" --repo "$REPO" --json commits --jq '.commits[].oid' 2>/dev/null || true)

  if [ -z "$commit_stream" ]; then
    echo -e "${YELLOW}⚠️ Could not fetch PR commit list from GitHub; refusing unsafe canonical-root fallback.${RESET}"
    return 1
  fi

  while IFS= read -r commit_sha; do
    [ -z "$commit_sha" ] && continue

    # Use three-dot to anchor at merge-base(base, commit), matching PR-style scope.
    local cumulative_files
    cumulative_files=$(git -C "$BASE_REPO_DIR" diff --name-only "origin/$PR_BASE_REF...$commit_sha" 2>/dev/null || true)
    [ -z "$cumulative_files" ] && continue

    local roots_tmp
    roots_tmp=$(mktemp)
    printf "%s\n" "$cumulative_files" | awk -F'/' '
      NF == 0 { next }
      $1 == "apps" && NF >= 2 { print $1 "/" $2 "/"; next }
      $1 == "packages" && NF >= 2 { print $1 "/" $2 "/"; next }
      { print $1 "/" }
    ' | sed '/^$/d' | sort -u > "$roots_tmp"

    if [ ! -s "$roots_tmp" ]; then
      rm -f "$roots_tmp"
      continue
    fi

    if [ "$initialized" -eq 0 ]; then
      cp "$roots_tmp" "$output_file"
      initialized=1
      rm -f "$roots_tmp"
      continue
    fi

    # Stop at first commit where new roots appear (contamination boundary).
    if comm -23 "$roots_tmp" "$output_file" | grep -q '.'; then
      rm -f "$roots_tmp"
      break
    fi

    rm -f "$roots_tmp"
  done <<< "$commit_stream"

  if [ ! -s "$output_file" ]; then
    return 1
  fi

  local root_count
  root_count=$(wc -l < "$output_file" | tr -d ' ')
  root_count=${root_count:-0}
  echo -e "${DIM}🧭 Canonical PR scope roots from earliest PR commits vs base (${PR_BASE_REF}): ${root_count}${RESET}"
  sed 's/^/   - /' "$output_file"
  return 0
}

path_is_in_allowlist_file() {
  local file_path="$1"
  local allowlist_file="$2"

  if grep -Fxq "$file_path" "$allowlist_file"; then
    return 0
  fi

  while IFS= read -r allowed; do
    [ -z "$allowed" ] && continue
    allowed="${allowed%/}"
    if [ "$file_path" = "$allowed" ] || [[ "$file_path" == "$allowed/"* ]]; then
      return 0
    fi
  done < "$allowlist_file"
  return 1
}

print_clean_complete_and_exit() {
  local iter_label="$1"
  local message="$2"

  echo "@@STATUS:clean@@"
  echo -e "${GREEN}${BOLD}✅ PR is clean!${RESET} ${GREEN}${message}${RESET}"
  echo ""
  echo -e "${GREEN}╭─────────────────────────────────────────────────────────────╮${RESET}"
  echo -e "${GREEN}│${RESET}  ${GREEN}${BOLD}✅ Monitor Complete${RESET} - PR ${MAGENTA}#$PR_NUM${RESET}"
  echo -e "${GREEN}│${RESET}  ${DIM}Iterations: ${iter_label} | Exit: PR is clean${RESET}"
  echo -e "${GREEN}╰─────────────────────────────────────────────────────────────╯${RESET}"
  exit 0
}

run_one_time_history_clean_mode() {
  echo ""
  echo -e "${CYAN}🧹 One-time clean mode enabled: history analysis + cleanup commit (no history rewrite)${RESET}"
  echo "@@MODE:history_clean@@"

  if [ "$HISTORY_CLEAN_MODE" != "cleanup_commit" ]; then
    echo -e "${RED}❌ History clean strategy '${HISTORY_CLEAN_MODE}' is not allowed in monitor flow.${RESET}"
    echo "@@STATUS:history_clean_failed@@"
    exit 1
  fi

  if [ -z "$PR_BASE_REF" ] || [ -z "$EXPECTED_PR_HEAD_BRANCH" ]; then
    echo -e "${RED}❌ Missing PR base/head refs for history clean mode.${RESET}"
    echo "@@STATUS:history_clean_failed@@"
    exit 1
  fi

  local range="origin/$PR_BASE_REF..origin/$EXPECTED_PR_HEAD_BRANCH"
  local pr_diff_range="origin/$PR_BASE_REF...origin/$EXPECTED_PR_HEAD_BRANCH"
  local commit_count
  commit_count=$(git -C "$BASE_REPO_DIR" rev-list --count "$range" 2>/dev/null || echo "0")
  commit_count=${commit_count:-0}
  echo "@@HISTORY_COMMITS:$commit_count@@"
  echo -e "${DIM}📚 Commits in PR range (${PR_BASE_REF}..${EXPECTED_PR_HEAD_BRANCH}): ${commit_count}${RESET}"

  if [ "$commit_count" -le 1 ]; then
    print_clean_complete_and_exit "1" "Single-commit PR; no history cleanup needed."
  fi

  # If this PR already has a prior cleanup commit, freeze scope to unresolved
  # threads that existed up to that point. This prevents later bot comments
  # from re-expanding scope into unrelated areas.
  HISTORY_THREAD_SCOPE_CUTOFF=$(git -C "$BASE_REPO_DIR" log --reverse "$range" --format='%cI%x09%s' | \
    awk -F'\t' -v pr="$PR_NUM" '$2 ~ ("^Clean PR #" pr " scope by ") {print $1; exit}')
  if [ -n "$HISTORY_THREAD_SCOPE_CUTOFF" ]; then
    echo -e "${DIM}⏱️ Freezing unresolved-thread scope at prior cleanup commit time: ${HISTORY_THREAD_SCOPE_CUTOFF}${RESET}"
  fi

  local changed_files
  # Use merge-base-anchored diff so scope reflects actual PR net changes.
  changed_files=$(git -C "$BASE_REPO_DIR" diff --name-only "$pr_diff_range" 2>/dev/null || true)
  local changed_count
  changed_count=$(printf "%s\n" "$changed_files" | sed '/^$/d' | wc -l | tr -d ' ')
  changed_count=${changed_count:-0}
  echo "@@HISTORY_FILES:$changed_count@@"

  if [ "$changed_count" -eq 0 ]; then
    print_clean_complete_and_exit "1" "No changed files in PR range."
  fi

  # Canonical root scope: derive stable roots from early cumulative commit history
  # and hard-constrain cleanup to those roots.
  : > "$HISTORY_CANONICAL_ROOTS_FILE"
  if ! build_history_canonical_roots_from_commits "$range" "$HISTORY_CANONICAL_ROOTS_FILE"; then
    echo -e "${RED}❌ Could not derive canonical roots; refusing unsafe history cleanup.${RESET}"
    echo "@@STATUS:history_clean_failed@@"
    exit 1
  fi

  if [ ! -s "$HISTORY_CANONICAL_ROOTS_FILE" ]; then
    echo -e "${RED}❌ Canonical roots file is empty; refusing unsafe history cleanup.${RESET}"
    echo "@@STATUS:history_clean_failed@@"
    exit 1
  fi

  HISTORY_PRIMARY_ROOT=""
  HISTORY_PRIMARY_ROOT_RATIO=0

  local classifier_used=0
  if [ "$HISTORY_SCOPE_CLASSIFIER" = "ai" ]; then
    echo -e "${DIM}🤖 Running commit-by-commit AI scope judge...${RESET}"
    if build_history_allowlist_with_ai_classifier "$changed_files" "$HISTORY_ALLOWLIST_FILE"; then
      classifier_used=1
    else
      echo -e "${RED}❌ AI commit scope judge unavailable; refusing unsafe heuristic fallback in one-time clean mode.${RESET}"
      echo "@@STATUS:history_clean_failed@@"
      exit 1
    fi
  fi

  if [ "$classifier_used" -ne 1 ]; then
    echo -e "${DIM}🔎 Building keep-path allowlist from unresolved-thread paths...${RESET}"
    if ! build_history_path_allowlist_from_review_threads "$HISTORY_ALLOWLIST_FILE"; then
      print_clean_complete_and_exit "1" "No unresolved-thread file paths available; analysis complete, no cleanup applied."
    fi

    # Heuristic: if one package root clearly dominates this PR's file set,
    # constrain cleanup scope to that root to avoid preserving unrelated side-roots.
    # Example roots: apps/autonomous-agents/, packages/hamming-tools/
    local dominant_stats
    dominant_stats=$(printf "%s\n" "$changed_files" | awk -F'/' '
      NF == 0 { next }
      $1 == "apps" && NF >= 2 { root=$1 "/" $2 "/"; counts[root]++; total++; next }
      $1 == "packages" && NF >= 2 { root=$1 "/" $2 "/"; counts[root]++; total++; next }
      { root=$1 "/"; counts[root]++; total++ }
      END {
        best=""; best_count=0;
        for (r in counts) {
          if (counts[r] > best_count) {
            best=r; best_count=counts[r];
          }
        }
        if (total > 0) {
          ratio = int((best_count * 100) / total);
          printf "%s\t%d\t%d\t%d\n", best, best_count, total, ratio;
        }
      }
    ')

    if [ -n "$dominant_stats" ]; then
      local dominant_root dominant_count dominant_total dominant_ratio
      dominant_root=$(printf "%s" "$dominant_stats" | awk -F'\t' '{print $1}')
      dominant_count=$(printf "%s" "$dominant_stats" | awk -F'\t' '{print $2}')
      dominant_total=$(printf "%s" "$dominant_stats" | awk -F'\t' '{print $3}')
      dominant_ratio=$(printf "%s" "$dominant_stats" | awk -F'\t' '{print $4}')

      if [ -n "$dominant_root" ] && [ "${dominant_count:-0}" -ge 3 ] && [ "${dominant_ratio:-0}" -ge 60 ]; then
        HISTORY_PRIMARY_ROOT="$dominant_root"
        HISTORY_PRIMARY_ROOT_RATIO="$dominant_ratio"
        echo -e "${DIM}🎯 Dominant PR root detected: ${HISTORY_PRIMARY_ROOT} (${dominant_count}/${dominant_total}, ${dominant_ratio}%)${RESET}"
      fi
    fi
  fi

  : > "$HISTORY_DROP_FILE"
  local keep_count=0
  local drop_count=0
  while IFS= read -r file_path; do
    [ -z "$file_path" ] && continue

    if [ -s "$HISTORY_CANONICAL_ROOTS_FILE" ] && ! path_is_in_allowlist_file "$file_path" "$HISTORY_CANONICAL_ROOTS_FILE"; then
      echo "$file_path" >> "$HISTORY_DROP_FILE"
      drop_count=$((drop_count + 1))
      continue
    fi

    if [ -n "$HISTORY_PRIMARY_ROOT" ] && [[ "$file_path" != "$HISTORY_PRIMARY_ROOT"* ]]; then
      echo "$file_path" >> "$HISTORY_DROP_FILE"
      drop_count=$((drop_count + 1))
      continue
    fi

    if path_is_in_allowlist_file "$file_path" "$HISTORY_ALLOWLIST_FILE"; then
      keep_count=$((keep_count + 1))
    else
      echo "$file_path" >> "$HISTORY_DROP_FILE"
      drop_count=$((drop_count + 1))
    fi
  done <<< "$changed_files"

  echo -e "${DIM}📊 History scope analysis: keep=$keep_count, drop=$drop_count${RESET}"
  echo "@@HISTORY_SCOPE:keep=$keep_count,drop=$drop_count@@"

  if [ "$drop_count" -eq 0 ]; then
    print_clean_complete_and_exit "1" "All changed files are within selected cleanup scope."
  fi

  echo -e "${CYAN}🛠️ Applying one-time cleanup commit to drop out-of-scope files...${RESET}"
  if ! ensure_workspace_ready "history clean mode"; then
    echo -e "${RED}❌ Workspace not safe for history cleanup.${RESET}"
    echo "@@STATUS:history_clean_failed@@"
    exit 1
  fi

  if ! (cd "$REPO_DIR" && git restore --source "origin/$PR_BASE_REF" --pathspec-from-file "$HISTORY_DROP_FILE"); then
    echo -e "${RED}❌ Failed to restore out-of-scope files from origin/$PR_BASE_REF.${RESET}"
    echo "@@STATUS:history_clean_failed@@"
    exit 1
  fi

  if [ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
    print_clean_complete_and_exit "1" "No staged cleanup changes after restore."
  fi

  if ! (cd "$REPO_DIR" && git add -A && git commit -m "Clean PR #$PR_NUM scope by commit intent analysis" >/dev/null); then
    echo -e "${RED}❌ Failed to create cleanup commit.${RESET}"
    echo "@@STATUS:history_clean_failed@@"
    exit 1
  fi

  if ! push_head_to_pr_branch "history clean mode"; then
    echo -e "${RED}❌ Failed to push cleanup commit to PR branch.${RESET}"
    echo "@@STATUS:history_clean_failed@@"
    exit 1
  fi

  print_clean_complete_and_exit "1" "History analyzed and out-of-scope files cleaned."
}

# Function to check CI status
check_ci_status() {
  local result
  local checks_json
  local ignored_pattern

  # Convert pipe-separated IGNORED_CHECKS to regex pattern for jq
  # e.g., "PR QA Plan|lint" -> "PR QA Plan|lint"
  ignored_pattern="$IGNORED_CHECKS"

  # Use 'name' and 'bucket' fields, filter out ignored checks
  checks_json=$(gh pr checks "$PR_NUM" --repo "$REPO" --json name,bucket 2>/dev/null || echo "[]")

  if [ -z "$ignored_pattern" ]; then
    # No ignored checks - use original logic
    result=$(echo "$checks_json" | jq -r '
      if length == 0 then "success"
      elif any(.bucket == "fail") then "failure"
      elif any(.bucket == "pending") then "pending"
      else "success"
      end' 2>/dev/null)
  else
    # Filter out ignored checks, then evaluate remaining
    result=$(echo "$checks_json" | jq -r --arg ignored "$ignored_pattern" '
      # Filter out checks whose name contains any ignored pattern
      [.[] | select(.name | test($ignored) | not)] |
      if length == 0 then "success"
      elif any(.bucket == "fail") then "failure"
      elif any(.bucket == "pending") then "pending"
      else "success"
      end' 2>/dev/null)
  fi

  # Default to success if empty (no CI configured or parsing failed)
  echo "${result:-success}"
}

parse_merge_status_from_json() {
  local payload="$1"

  if [ -z "$payload" ] || ! echo "$payload" | jq -e '.' > /dev/null 2>&1; then
    echo "unknown"
    return
  fi

  local pr_state
  pr_state=$(echo "$payload" | jq -r '.state // "UNKNOWN"')
  if [ "$pr_state" != "OPEN" ]; then
    echo "clean"
    return
  fi

  local mergeable
  mergeable=$(echo "$payload" | jq -r '.mergeable // "UNKNOWN"')
  local merge_state
  merge_state=$(echo "$payload" | jq -r '.mergeStateStatus // "UNKNOWN"')

  # Policy/rules gating (e.g. required approvals) is not a merge-conflict.
  if [ "$merge_state" = "BLOCKED" ]; then
    echo "clean"
    return
  fi

  if [ "$mergeable" = "CONFLICTING" ] || [ "$merge_state" = "DIRTY" ]; then
    echo "conflicting"
    return
  fi

  # Only treat as unknown when both signals are unknown.
  if [ "$mergeable" = "UNKNOWN" ] && [ "$merge_state" = "UNKNOWN" ]; then
    echo "unknown"
    return
  fi

  echo "clean"
}

check_merge_status_text_fallback() {
  local view_text
  view_text=$(gh pr view "$PR_NUM" --repo "$REPO" 2>/dev/null || true)

  if [ -z "$view_text" ]; then
    echo "unknown"
    return
  fi

  if echo "$view_text" | grep -qi "No conflicts with base branch"; then
    echo "clean"
    return
  fi

  if echo "$view_text" | grep -qi "Merging is blocked"; then
    echo "clean"
    return
  fi

  if echo "$view_text" | grep -qi "conflicts with base branch"; then
    echo "conflicting"
    return
  fi

  echo "unknown"
}

# Function to check merge status for the PR.
# Returns one of: clean, conflicting, unknown
# Uses a single gh API call. Treats unknown as clean to avoid burning
# extra API calls on GitHub's transient UNKNOWN mergeability state.
check_merge_status() {
  local result
  result=$(gh pr view "$PR_NUM" --repo "$REPO" --json state,mergeable,mergeStateStatus 2>/dev/null || true)

  local status
  status=$(parse_merge_status_from_json "$result")
  if [ "$status" != "unknown" ]; then
    echo "$status"
    return
  fi

  # GitHub sometimes returns UNKNOWN mergeability transiently.
  # Default to clean rather than burning more API calls on fallbacks/retries.
  # If there are real conflicts, the next iteration will catch them.
  echo "clean"
}

# Execute Claude prompt and stream readable text output.
run_claude_prompt() {
  local prompt="$1"
  local action_label="$2"

  if ! command -v claude &> /dev/null; then
    echo -e "${YELLOW}⚠️ Claude CLI not found, skipping ${action_label}${RESET}"
    return 1
  fi

  local claude_cmd=(claude -p "$prompt" --verbose --output-format stream-json --dangerously-skip-permissions)
  if [ -n "$AI_MODEL" ]; then
    claude_cmd+=(--model "$AI_MODEL")
  fi

  (cd "$REPO_DIR" && "${claude_cmd[@]}" 2>&1) | \
    jq -r --unbuffered 'select(.type) | if .type == "assistant" then (.message.content[]?.text // empty) elif .type == "result" then (.result.content[]?.text // empty) elif .type == "content_block_delta" then (.delta.text // empty) else empty end' 2>/dev/null || true

  return 0
}

# Execute Codex prompt in non-interactive mode.
run_codex_prompt() {
  local prompt="$1"
  local action_label="$2"
  local require_commit_and_push="${3:-false}"
  RUN_CODEX_LAST_RESULT="unknown"

  if ! command -v codex &> /dev/null; then
    echo -e "${YELLOW}⚠️ Codex CLI not found, skipping ${action_label}${RESET}"
    return 1
  fi

  local before_head=""
  if [ "$require_commit_and_push" = "true" ]; then
    before_head=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)
  fi

  local codex_cmd=(codex --dangerously-bypass-approvals-and-sandbox exec --skip-git-repo-check --ephemeral --color never)
  if [ -n "$AI_MODEL" ]; then
    codex_cmd+=(-m "$AI_MODEL")
  fi
  codex_cmd+=("$prompt")

  local output_file
  output_file=$(mktemp)

  if ! (cd "$REPO_DIR" && "${codex_cmd[@]}" 2>&1 | tee "$output_file"); then
    rm -f "$output_file"
    echo -e "${RED}❌ Codex run failed for ${action_label}.${RESET}"
    return 1
  fi

  # Parse explicit end-of-run status markers first (preferred), then strict legacy fallbacks.
  local status_line=""
  status_line=$(grep -E '^@@RUN_RESULT:(CHANGED|NO_CHANGES_NEEDED|BLOCKED:.*)@@$' "$output_file" | tail -1 || true)
  if [ -z "$status_line" ]; then
    status_line=$(grep -E '^(NO_CHANGES_NEEDED|BLOCKED:[^[:space:]].*)$' "$output_file" | tail -1 || true)
  fi

  local blocked_reported=0
  if echo "$status_line" | grep -qE '^@@RUN_RESULT:BLOCKED:.*@@$|^BLOCKED:[^[:space:]].*$'; then
    blocked_reported=1
  fi

  local no_changes_reported=0
  if echo "$status_line" | grep -qE '^@@RUN_RESULT:NO_CHANGES_NEEDED@@$|^NO_CHANGES_NEEDED$'; then
    no_changes_reported=1
  fi

  rm -f "$output_file"

  if [ "$blocked_reported" -eq 1 ]; then
    RUN_CODEX_LAST_RESULT="blocked"
    echo -e "${RED}❌ Codex reported BLOCKED for ${action_label}.${RESET}"
    return 1
  fi

  if [ "$require_commit_and_push" = "true" ]; then
    local after_head
    after_head=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)

    if [ "$after_head" = "$before_head" ]; then
      local dirty_after
      dirty_after=$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)
      if [ "$no_changes_reported" -eq 1 ] && [ -z "$dirty_after" ]; then
        RUN_CODEX_LAST_RESULT="no_changes"
        echo -e "${DIM}ℹ️ Codex reported no changes needed for ${action_label}.${RESET}"
        return 0
      fi

      echo -e "${RED}❌ Codex did not create a commit for ${action_label}.${RESET}"
      if [ -n "$dirty_after" ]; then
        echo -e "${YELLOW}⚠️ Uncommitted tracked changes remain after Codex run.${RESET}"
      fi
      return 1
    fi

    echo -e "${DIM}🚀 Pushing commit(s) to PR head branch (${EXPECTED_PR_HEAD_BRANCH}) for ${action_label}...${RESET}"
    if ! push_head_to_pr_branch "$action_label"; then
      return 1
    fi

    local dirty_after_push
    dirty_after_push=$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)
    if [ -n "$dirty_after_push" ]; then
      echo -e "${RED}❌ Tracked uncommitted changes remain after ${action_label}.${RESET}"
      return 1
    fi

    RUN_CODEX_LAST_RESULT="changed"
    echo -e "${GREEN}✅ Commit + push verified for ${action_label}.${RESET}"
  fi

  if [ "$RUN_CODEX_LAST_RESULT" = "unknown" ]; then
    if [ "$no_changes_reported" -eq 1 ]; then
      RUN_CODEX_LAST_RESULT="no_changes"
    else
      RUN_CODEX_LAST_RESULT="changed"
    fi
  fi

  return 0
}

# Function to run merge fixing flow with selected provider
run_fix_merge() {
  echo -e "${CYAN}🧩 Running merge fix flow...${RESET}"
  MERGE_FIX_CREATED_COMMIT=0
  local before_head
  before_head=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)

  if [ "$AI_PROVIDER" = "codex" ]; then
    run_codex_prompt "Fix merge conflicts for PR #$PR_NUM in $REPO.
The PR currently has merge conflicts (or dirty merge state). Resolve conflicts in this local repository with minimal, correct changes.
Prefer preserving intended behavior from both sides, remove conflict markers, and run relevant validation.

Requirements:
1) Keep all work inside this checkout at: $REPO_DIR
2) If changes are required, commit them and ensure they are pushed to PR head branch: $EXPECTED_PR_HEAD_BRANCH.
3) Do NOT leave tracked uncommitted changes.
4) At the very end, print exactly one status line:
   - @@RUN_RESULT:CHANGED@@
   - @@RUN_RESULT:NO_CHANGES_NEEDED@@
   - @@RUN_RESULT:BLOCKED:<reason>@@
5) Use NO_CHANGES only when no commit is needed and nothing is blocked." "merge fix" "true" || return 1
  else
    run_claude_prompt "Fix merge conflicts for PR #$PR_NUM in $REPO.
Resolve the conflicting files in this local repository with minimal, correct changes.
Run relevant validation, commit any required fixes, and push to the current branch." "merge fix" || return 1
  fi

  local post_merge_status
  post_merge_status=$(check_merge_status)
  echo "@@MERGE_STATUS:$post_merge_status@@"
  if [ "$post_merge_status" = "conflicting" ]; then
    echo -e "${RED}❌ Merge conflicts remain after merge fix flow.${RESET}"
    return 1
  fi

  if [ "$post_merge_status" = "unknown" ]; then
    echo -e "${YELLOW}⚠️ Unable to confirm merge status after merge fix flow.${RESET}"
    return 1
  fi

  local after_head
  after_head=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)
  if [ -n "$before_head" ] && [ -n "$after_head" ] && [ "$after_head" != "$before_head" ]; then
    MERGE_FIX_CREATED_COMMIT=1
    echo "@@MERGE_FIX_COMMIT:1@@"
  else
    echo "@@MERGE_FIX_COMMIT:0@@"
  fi

  echo -e "${GREEN}✅ Merge status clean after merge fix flow.${RESET}"
  return 0
}

# Function to run CI fixing flow with selected provider
run_fix_ci() {
  echo -e "${CYAN}🔧 Running CI fix flow...${RESET}"

  if [ "$AI_PROVIDER" = "codex" ]; then
    run_codex_prompt "Fix failing CI for PR #$PR_NUM in $REPO.
Inspect failing CI checks, apply minimal fixes in this local repository, run relevant validation, and summarize what changed.

Requirements:
1) Keep all work inside this checkout at: $REPO_DIR
2) If changes are required, commit them and ensure they are pushed to PR head branch: $EXPECTED_PR_HEAD_BRANCH.
3) Do NOT leave tracked uncommitted changes.
4) At the very end, print exactly one status line:
   - @@RUN_RESULT:CHANGED@@
   - @@RUN_RESULT:NO_CHANGES_NEEDED@@
   - @@RUN_RESULT:BLOCKED:<reason>@@
5) Use NO_CHANGES only when no commit is needed and nothing is blocked." "CI fix" "true"
  else
    run_claude_prompt "/fix-ci --pr $PR_NUM" "CI fix"
  fi
}

# Function to handle PR comments
run_handle_comments() {
  echo -e "${CYAN}🔧 Running comment handling flow...${RESET}"

  if [ "$AI_PROVIDER" = "codex" ]; then
    run_codex_prompt "Handle unresolved PR comments for PR #$PR_NUM in $REPO.
Review unresolved comments, apply requested changes, and mark threads as resolved where appropriate.

Requirements:
1) Keep all work inside this checkout at: $REPO_DIR
2) If changes are required, commit them and ensure they are pushed to PR head branch: $EXPECTED_PR_HEAD_BRANCH.
3) Do NOT leave tracked uncommitted changes.
4) At the very end, print exactly one status line:
   - @@RUN_RESULT:CHANGED@@
   - @@RUN_RESULT:NO_CHANGES_NEEDED@@
   - @@RUN_RESULT:BLOCKED:<reason>@@
5) Use NO_CHANGES only when no commit is needed and nothing is blocked." "Comment handling" "true"
  else
    run_claude_prompt "/handle-pr-comments --pr $PR_NUM" "Comment handling"
  fi
}

# Function to check for merge conflicts
check_merge_conflicts() {
  local result
  result=$(gh pr view "$PR_NUM" --repo "$REPO" --json mergeable -q '.mergeable' 2>/dev/null)
  case "$result" in
    CONFLICTING) echo "conflicts" ;;
    MERGEABLE) echo "clean" ;;
    UNKNOWN) echo "unknown" ;;
    *) echo "unknown" ;;
  esac
}

# Function to fix merge conflicts by rebasing on base branch
fix_merge_conflicts() {
  echo -e "${CYAN}🔧 Attempting to fix merge conflicts...${RESET}"

  # Get the base branch
  local base_branch
  base_branch=$(gh pr view "$PR_NUM" --repo "$REPO" --json baseRefName -q '.baseRefName' 2>/dev/null)
  if [ -z "$base_branch" ]; then
    echo -e "${YELLOW}⚠️ Could not determine base branch${RESET}"
    return 1
  fi

  echo -e "${DIM}Base branch: $base_branch${RESET}"

  if command -v claude &> /dev/null; then
    # Use Claude to intelligently resolve conflicts
    (cd "$REPO_DIR" && claude -p "The PR #$PR_NUM has merge conflicts with $base_branch. Please:
1. Fetch the latest $base_branch
2. Attempt to rebase or merge $base_branch into the current branch
3. Resolve any conflicts intelligently based on the PR's intent
4. Push the resolved changes

Be careful with conflict resolution - preserve the PR's intended changes while incorporating necessary updates from $base_branch." --verbose --output-format stream-json --dangerously-skip-permissions 2>&1) | \
      jq -r --unbuffered 'select(.type) | if .type == "assistant" then (.message.content[]?.text // empty) elif .type == "result" then (.result.content[]?.text // empty) elif .type == "content_block_delta" then (.delta.text // empty) else empty end' 2>/dev/null || true
  else
    echo -e "${YELLOW}⚠️ Claude CLI not found, skipping conflict fix${RESET}"
    return 1
  fi
}

# Main loop
for iter in $(seq 1 $MAX_ITER); do
  iteration_failed=0
  MERGE_FIX_CREATED_COMMIT=0
  CI_PENDING_WAIT_SKIPPED=0

  # Emit parseable iteration marker for dashboard
  echo "@@ITERATION:$iter/$MAX_ITER@@"

  echo ""
  echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}🔍 Iteration ${MAGENTA}$iter${RESET}${BOLD}/${DIM}$MAX_ITER${RESET} ${DIM}- $(date '+%H:%M:%S')${RESET}"
  echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

  if ! ensure_workspace_ready "iteration $iter"; then
    echo "@@AGENT_ERROR:workspace_state@@"
    echo "@@STATUS:workspace_blocked@@"
    echo -e "${RED}❌ Workspace is not in a safe state for monitoring. Stopping monitor.${RESET}"
    rm -f "$STATE_FILE" "$THREADS_FILE"
    exit 1
  fi

  # ═══════════════════════════════════════════════════════════════
  # STEP 0: Check and fix merge conflicts (if enabled)
  # ═══════════════════════════════════════════════════════════════
  if [ "$DO_CONFLICTS" -eq 1 ]; then
    echo ""
    echo -e "${DIM}🔀 Checking for merge conflicts...${RESET}"
    merge_status=$(check_merge_conflicts)
    case "$merge_status" in
      conflicts)
        echo -e "${RED}⚠️ Merge conflicts detected${RESET}"
        echo "@@MERGE_STATUS:conflicts@@"
        fix_merge_conflicts
        # Re-check after fix attempt
        merge_status=$(check_merge_conflicts)
        if [ "$merge_status" = "conflicts" ]; then
          echo -e "${YELLOW}⚠️ Conflicts still present after fix attempt${RESET}"
        else
          echo -e "${GREEN}✅ Conflicts resolved${RESET}"
        fi
        ;;
      clean)
        echo -e "${GREEN}✅ No merge conflicts${RESET}"
        echo "@@MERGE_STATUS:clean@@"
        ;;
      *)
        echo -e "${DIM}Merge status: $merge_status${RESET}"
        echo "@@MERGE_STATUS:$merge_status@@"
        ;;
    esac
  fi

  # ═══════════════════════════════════════════════════════════════
  # STEP 1: Check CI status (wait if pending)
  # ═══════════════════════════════════════════════════════════════
  echo ""
  if [ "$DO_CI" -eq 1 ]; then
    echo -e "${DIM}🔄 Checking CI status...${RESET}"
    ci_status=$(check_ci_status)
    case "$ci_status" in
      success) ci_color="${GREEN}" ;;
      failure) ci_color="${RED}" ;;
      pending) ci_color="${YELLOW}" ;;
      *) ci_color="${DIM}" ;;
    esac
    echo -e "📊 CI Status: ${ci_color}${ci_status}${RESET}"
    echo "@@CI_STATUS:$ci_status@@"
  else
    ci_status="skipped"
    echo -e "${DIM}⏭️  CI checks skipped${RESET}"
    echo "@@CI_STATUS:skipped@@"
  fi

  # Wait for CI if pending (in 5-minute increments)
  if [ "$DO_CI" -eq 1 ]; then
    ci_waits=0
    wait_step_minutes=5
    if [ "$PENDING_WAIT_MINUTES" -lt 0 ]; then
      PENDING_WAIT_MINUTES=0
    fi
    max_ci_waits=$(( (PENDING_WAIT_MINUTES + wait_step_minutes - 1) / wait_step_minutes ))
    while [ "$ci_status" = "pending" ] && [ $ci_waits -lt $max_ci_waits ]; do
      ci_waits=$((ci_waits + 1))
      echo -e "${YELLOW}⏳ CI pending, waiting ${wait_step_minutes} minutes... ($ci_waits/$max_ci_waits)${RESET}"
      echo "@@CI_WAIT:$ci_waits/$max_ci_waits@@"
      sleep $((wait_step_minutes * 60))

      ci_status=$(check_ci_status)
      case "$ci_status" in
        success) ci_color="${GREEN}" ;;
        failure) ci_color="${RED}" ;;
        pending) ci_color="${YELLOW}" ;;
        *) ci_color="${DIM}" ;;
      esac
      echo -e "📊 CI Status: ${ci_color}${ci_status}${RESET}"
      echo "@@CI_STATUS:$ci_status@@"
    done
  fi

  # ═══════════════════════════════════════════════════════════════
  # STEP 2: Fix CI if failed
  # ═══════════════════════════════════════════════════════════════
  if [ "$DO_CI" -eq 1 ]; then
    if [ "$ci_status" = "failure" ]; then
      echo ""
      echo -e "${RED}❌ CI failing - fixing first...${RESET}"
      run_fix_ci
    elif [ "$ci_status" = "success" ]; then
      echo -e "${GREEN}✅ CI passing${RESET}"
    elif [ "$ci_status" = "pending" ]; then
      echo -e "${YELLOW}⏳ CI still pending after max wait, continuing anyway...${RESET}"
    fi
  fi

  if [ "$DO_COMMENTS" -eq 0 ]; then
    if [ "$DO_CI" -eq 1 ] && [ "$ci_status" = "success" ]; then
      echo "@@STATUS:clean@@"
      echo -e "${GREEN}${BOLD}✅ PR is clean!${RESET} ${GREEN}CI passing and comments skipped.${RESET}"
      echo ""
      echo -e "${GREEN}╭─────────────────────────────────────────────────────────────╮${RESET}"
      echo -e "${GREEN}│${RESET}  ${GREEN}${BOLD}✅ Monitor Complete${RESET} - PR ${MAGENTA}#$PR_NUM${RESET}"
      echo -e "${GREEN}│${RESET}  ${DIM}Iterations: $iter | Exit: PR is clean${RESET}"
      echo -e "${GREEN}╰─────────────────────────────────────────────────────────────╯${RESET}"
      rm -f "$STATE_FILE" "$THREADS_FILE"
      exit 0
    fi
  fi

  # ═══════════════════════════════════════════════════════════════
  # STEP 3: Fetch and check for unresolved PR comments
  # ═══════════════════════════════════════════════════════════════
  echo ""
  if [ "$DO_COMMENTS" -eq 1 ]; then
    echo -e "${DIM}📝 Fetching PR comments...${RESET}"

    # Fetch all threads, filter to unresolved, save to file
    current_count=$(fetch_threads)
    current_ids=$(get_unresolved_thread_ids)
    known_ids=$(get_known_ids)

    # current_count is already set by fetch_threads
    # Ensure it's a valid number
    current_count=${current_count:--1}
    if [ "$current_count" -ge 0 ]; then
      current_ids=$(get_unresolved_thread_ids)
    fi

    # Check if PR is clean (no comments, and CI passing if enabled)
    if [ "$current_count" -eq 0 ]; then
      if [ "$DO_CI" -eq 1 ] && [ "$ci_status" != "success" ]; then
        :
      else
        echo "@@STATUS:clean@@"
        echo -e "${GREEN}${BOLD}✅ PR is clean!${RESET} ${GREEN}No unresolved comments.${RESET}"
        echo ""
        echo -e "${GREEN}╭─────────────────────────────────────────────────────────────╮${RESET}"
        echo -e "${GREEN}│${RESET}  ${GREEN}${BOLD}✅ Monitor Complete${RESET} - PR ${MAGENTA}#$PR_NUM${RESET}"
        echo -e "${GREEN}│${RESET}  ${DIM}Iterations: $iter | Exit: PR is clean${RESET}"
        echo -e "${GREEN}╰─────────────────────────────────────────────────────────────╯${RESET}"
        rm -f "$STATE_FILE" "$THREADS_FILE"
        exit 0
      fi
    fi

  # Find new threads (not seen before)
  new_count=0
  if [ -n "$current_ids" ]; then
    for id in $(echo "$current_ids" | tr ',' '\n'); do
      if [ -z "$known_ids" ] || ! echo ",$known_ids," | grep -q ",$id,"; then
        new_count=$((new_count + 1))
      fi
    done
  fi

  # ═══════════════════════════════════════════════════════════════
  # STEP 5: Fix comments if any
  # ═══════════════════════════════════════════════════════════════
    if [ "$current_count" -gt 0 ]; then
    echo -e "${YELLOW}📊 Unresolved: ${BOLD}$current_count${RESET}${YELLOW} comments | New: $new_count${RESET}"
    echo "@@COMMENTS_FOUND:$current_count@@"
    echo ""
    echo -e "${CYAN}🤖 Invoking ${AI_PROVIDER} to handle comments...${RESET}"
    echo ""

    # Run unified /handle-pr-comments skill with pre-fetched threads file
    # This saves API calls - threads already fetched above
    echo -e "${DIM}── Running comment handling flow for PR $PR_NUM (with pre-fetched data) ──${RESET}"
    if ! run_handle_comments; then
      iteration_failed=1
      echo "@@AGENT_ERROR:comment_handling@@"
      echo -e "${YELLOW}⚠️ Comment handling flow failed this iteration.${RESET}"
    else
      # Re-fetch unresolved threads after handling to ensure progress.
      post_comment_count=-1
      if ! post_comment_count=$(fetch_threads); then
        iteration_failed=1
        echo "@@AGENT_ERROR:threads_fetch@@"
        echo -e "${YELLOW}⚠️ Failed to re-fetch unresolved threads after comment handling; cannot verify progress this iteration.${RESET}"
      else
        post_comment_count=${post_comment_count:-0}
        post_comment_ids=$(get_unresolved_thread_ids)
        echo "@@COMMENTS_REMAINING:$post_comment_count@@"
      fi
    fi

    # Update state with current thread IDs
    update_state "$iter" "$current_ids"
  else
    echo -e "${GREEN}✅ No unresolved comments${RESET}"
  fi
  fi  # Close DO_COMMENTS block

  # ═══════════════════════════════════════════════════════════════
  # STEP 6: Sleep until next iteration
  # ═══════════════════════════════════════════════════════════════
  if [ "$iter" -lt "$MAX_ITER" ]; then
    sleep_interval="$INTERVAL"
    if [ "${iteration_failed:-0}" -eq 1 ]; then
      sleep_interval="$QUICK_RETRY_INTERVAL"
      echo -e "${YELLOW}⚠️ Iteration had agent errors; retrying sooner in ${sleep_interval} minute(s).${RESET}"
    fi

    next_time=$(date -v+${sleep_interval}M +"%H:%M" 2>/dev/null || date -d "+${sleep_interval} minutes" +"%H:%M" 2>/dev/null || echo "~${sleep_interval}m")
    echo ""
    echo -e "${BLUE}💤 Sleeping ${sleep_interval} minutes...${RESET} ${DIM}Next check at $next_time${RESET}"
    echo "@@SLEEPING:${sleep_interval}@@"
    sleep $((sleep_interval * 60))
  fi
done

echo ""
echo "@@STATUS:max_iterations@@"
echo -e "${YELLOW}╭─────────────────────────────────────────────────────────────╮${RESET}"
echo -e "${YELLOW}│${RESET}  ${YELLOW}${BOLD}⚠️  Monitor Complete${RESET} - PR ${MAGENTA}#$PR_NUM${RESET}"
echo -e "${YELLOW}│${RESET}  ${DIM}Iterations: $MAX_ITER | Exit: Max iterations reached${RESET}"
echo -e "${YELLOW}╰─────────────────────────────────────────────────────────────╯${RESET}"
rm -f "$STATE_FILE" "$THREADS_FILE"
exit 1
