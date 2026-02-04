#!/bin/bash
# Monitor PR Loop Script
# Runs Claude Code commands to review and fix PR comments in a loop

PR_NUMBER=$1
REPO=$2
MAX_ITERATIONS=${3:-10}
INTERVAL_MINUTES=${4:-5}

echo "=== Clanker Spanker Monitor ==="
echo "PR: #$PR_NUMBER"
echo "Repo: $REPO"
echo "Max iterations: $MAX_ITERATIONS"
echo "Interval: $INTERVAL_MINUTES minutes"
echo ""

for i in $(seq 1 $MAX_ITERATIONS); do
  # Emit iteration start event (parseable by frontend)
  echo "@@ITERATION:$i/$MAX_ITERATIONS@@"
  echo "=== Iteration $i/$MAX_ITERATIONS ==="
  echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting iteration"

  # Navigate to repo directory if needed
  # cd to a temp directory or the repo clone

  echo "$ claude /review-pr-comments $PR_NUMBER"

  # Run review-pr-comments
  # For now, simulate the command - in production this would run:
  # claude /review-pr-comments $PR_NUMBER

  # Simulate some output
  echo "Reviewing PR #$PR_NUMBER comments..."
  sleep 2
  echo "Found 0 actionable comments"

  # Check if any actionable comments were found
  # In production, parse the output to determine this
  COMMENTS_FOUND=0

  if [ $COMMENTS_FOUND -eq 0 ]; then
    echo "✓ PR is clean! No actionable comments found."
    echo "=== Monitor complete ==="
    exit 0
  fi

  echo "$ claude /fix-pr-comments $PR_NUMBER"

  # Run fix-pr-comments
  # claude /fix-pr-comments $PR_NUMBER

  echo "Fixing $COMMENTS_FOUND comments..."
  sleep 2
  echo "✓ Fixed $COMMENTS_FOUND comments"

  # Wait before next iteration (unless this is the last one)
  if [ $i -lt $MAX_ITERATIONS ]; then
    echo ""
    echo "Sleeping for $INTERVAL_MINUTES minutes before next check..."
    echo "Next check at: $(date -v+${INTERVAL_MINUTES}M '+%Y-%m-%d %H:%M:%S')"
    sleep $((INTERVAL_MINUTES * 60))
  fi
done

echo ""
echo "=== Max iterations reached ==="
echo "Monitor stopped after $MAX_ITERATIONS iterations"
exit 1
