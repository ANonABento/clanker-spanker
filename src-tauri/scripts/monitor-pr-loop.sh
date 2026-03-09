#!/bin/bash
#
# Clanker Spanker - PR Monitor Loop
# Monitors PR for new comments and auto-fixes them via Claude Code
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

PR_NUM="${1:?Usage: $0 <PR_NUMBER> <REPO> [MAX_ITERATIONS] [INTERVAL_MINUTES] [PENDING_WAIT_MINUTES] [FIX_FLAGS] [RUNNER] [MODEL]}"
REPO="${2:?Usage: $0 <PR_NUMBER> <REPO> [MAX_ITERATIONS] [INTERVAL_MINUTES] [PENDING_WAIT_MINUTES] [FIX_FLAGS] [RUNNER] [MODEL]}"
MAX_ITER="${3:-10}"
INTERVAL="${4:-15}"
PENDING_WAIT_MINUTES="${5:-15}"
FIX_FLAGS="${6:-ci,comments}"
RUNNER="${7:-auto}"
MODEL="${8:-auto}"

# Parse comma-separated fix flags
DO_CI=0
DO_COMMENTS=0
DO_CONFLICTS=0
[[ "$FIX_FLAGS" == *"ci"* ]] && DO_CI=1
[[ "$FIX_FLAGS" == *"comments"* ]] && DO_COMMENTS=1
[[ "$FIX_FLAGS" == *"conflicts"* ]] && DO_CONFLICTS=1

# Parse owner/repo
OWNER="${REPO%%/*}"
REPO_NAME="${REPO##*/}"

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
  # Find the most recently modified workspace with a .git file (worktree)
  NEWEST_WORKSPACE=$(find "$CONDUCTOR_WORKSPACE_DIR" -maxdepth 2 -name ".git" -type f 2>/dev/null | \
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
    if [ -d "$expanded/.git" ]; then
      REPO_DIR="$expanded"
      break 2
    fi
  done
done

if [ -z "$REPO_DIR" ]; then
  echo -e "${YELLOW}⚠️  Warning: Could not find local clone of $REPO${RESET}"
  echo -e "${DIM}    Checked: ~/repos, ~/code, ~/projects, ~/workspace, ~/ghq, ~/conductor/workspaces${RESET}"
  echo -e "${DIM}    Claude will run from current directory - file edits may not work correctly${RESET}"
  REPO_DIR="."
else
  echo -e "${DIM}📁 Found repo at: $REPO_DIR${RESET}"
fi

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

# Threads file for passing to Claude skill
THREADS_FILE="$STATE_DIR/pr-${OWNER}-${REPO_NAME}-${PR_NUM}-threads.json"

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
      echo -e "${YELLOW}⚠️ GraphQL query failed${RESET}" >&2
      echo "0"
      return
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
  echo "$all_threads" | jq '[.[] | select(.isResolved == false)]' > "$THREADS_FILE"

  # Return count
  jq 'length' "$THREADS_FILE"
}

# Function to get unresolved thread IDs (for backward compat / state tracking)
get_unresolved_thread_ids() {
  if [ -f "$THREADS_FILE" ]; then
    jq -r '[.[].id] | join(",")' "$THREADS_FILE"
  else
    echo ""
  fi
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

# Function to check CI status
check_ci_status() {
  local result
  # Use ascii_upcase for case-insensitive matching (GitHub returns FAILURE/PENDING/QUEUED uppercase)
  result=$(gh pr checks "$PR_NUM" --repo "$REPO" --json state,conclusion 2>/dev/null | \
    jq -r 'if length == 0 then "success"
           elif any(.conclusion | ascii_upcase == "FAILURE") then "failure"
           elif any(.state | ascii_upcase | . == "PENDING" or . == "QUEUED") then "pending"
           else "success"
           end' 2>/dev/null)

  # Default to success if empty (no CI configured or parsing failed)
  echo "${result:-success}"
}

# Function to run /fix-ci
run_fix_ci() {
  echo -e "${CYAN}🔧 Running /fix-ci to fix CI failures...${RESET}"
  if command -v claude &> /dev/null; then
    (cd "$REPO_DIR" && claude -p "/fix-ci --pr $PR_NUM" --verbose --output-format stream-json --dangerously-skip-permissions 2>&1) | \
      jq -r --unbuffered 'select(.type) | if .type == "assistant" then (.message.content[]?.text // empty) elif .type == "result" then (.result.content[]?.text // empty) elif .type == "content_block_delta" then (.delta.text // empty) else empty end' 2>/dev/null || true
  else
    echo -e "${YELLOW}⚠️ Claude CLI not found, skipping CI fix${RESET}"
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
  # Emit parseable iteration marker for dashboard
  echo "@@ITERATION:$iter/$MAX_ITER@@"

  echo ""
  echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}🔍 Iteration ${MAGENTA}$iter${RESET}${BOLD}/${DIM}$MAX_ITER${RESET} ${DIM}- $(date '+%H:%M:%S')${RESET}"
  echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

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
  current_count=${current_count:-0}

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
  # STEP 4: Fix comments if any
  # ═══════════════════════════════════════════════════════════════
    if [ "$current_count" -gt 0 ]; then
    echo -e "${YELLOW}📊 Unresolved: ${BOLD}$current_count${RESET}${YELLOW} comments | New: $new_count${RESET}"
    echo "@@COMMENTS_FOUND:$current_count@@"
    echo ""
    echo -e "${CYAN}🤖 Invoking Claude to handle comments...${RESET}"
    echo ""

    # Run unified /handle-pr-comments skill with pre-fetched threads file
    # This saves API calls - threads already fetched above
    echo -e "${DIM}── Running /handle-pr-comments $PR_NUM (with pre-fetched data) ──${RESET}"
    if command -v claude &> /dev/null; then
      # Run Claude and capture exit code separately from jq parsing
      # Don't treat jq parse errors as skill failures
      (cd "$REPO_DIR" && claude -p "/handle-pr-comments $PR_NUM $REPO --threads-file $THREADS_FILE" --verbose --output-format stream-json --dangerously-skip-permissions 2>&1) | \
        jq -r --unbuffered 'select(.type) | if .type == "assistant" then (.message.content[]?.text // empty) elif .type == "result" then (.result.content[]?.text // empty) elif .type == "content_block_delta" then (.delta.text // empty) else empty end' 2>/dev/null || true
      # jq may exit non-zero on incomplete JSON streams; || true prevents set -e from killing the loop
    else
      echo -e "${YELLOW}⚠️ Claude CLI not found, skipping comment handling${RESET}"
    fi

    # Update state with current thread IDs
    update_state "$iter" "$current_ids"
    else
      echo -e "${GREEN}✅ No unresolved comments${RESET}"
    fi
  fi

  # ═══════════════════════════════════════════════════════════════
  # STEP 5: Sleep until next iteration
  # ═══════════════════════════════════════════════════════════════
  if [ "$iter" -lt "$MAX_ITER" ]; then
    next_time=$(date -v+${INTERVAL}M +"%H:%M" 2>/dev/null || date -d "+${INTERVAL} minutes" +"%H:%M" 2>/dev/null || echo "~${INTERVAL}m")
    echo ""
    echo -e "${BLUE}💤 Sleeping ${INTERVAL} minutes...${RESET} ${DIM}Next check at $next_time${RESET}"
    echo "@@SLEEPING:${INTERVAL}@@"
    sleep $((INTERVAL * 60))
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
