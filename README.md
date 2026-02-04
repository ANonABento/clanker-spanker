# Clanker Spanker

A desktop PR monitoring dashboard that watches your GitHub pull requests and automatically fixes CI failures and code review comments using Claude AI.

Built with Tauri 2 + React + TypeScript.

## What It Does

1. **Shows your open PRs** in a card grid with CI status, review status, labels, and comment counts
2. **Monitors PRs** on a loop — checks CI, fetches review threads, and invokes Claude to fix issues automatically
3. **Tracks progress** with live terminal output, progress bars, and iteration counters
4. **Persists state** — merged PRs stay visible until dismissed, monitor history is retained

## Prerequisites

Install these before running:

| Tool | Purpose | Install |
|------|---------|---------|
| [Node.js](https://nodejs.org/) 18+ | Frontend build | `brew install node` |
| [Rust](https://rustup.rs/) | Tauri backend | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| [GitHub CLI](https://cli.github.com/) | PR data & GraphQL API | `brew install gh` |
| [jq](https://jqlang.github.io/jq/) | JSON processing in monitor script | `brew install jq` |
| [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) | AI-powered fixes | `npm install -g @anthropic-ai/claude-code` |

After installing, authenticate:

```bash
gh auth login          # GitHub CLI
claude                 # Claude CLI (follow setup prompts)
```

## Setup

```bash
git clone https://github.com/ANonABento/clanker-spanker.git
cd clanker-spanker
npm install
```

## Running

```bash
# Development (hot reload)
npm run dev

# Production build
npm run tauri build
```

## Usage

### Adding a Repository

Click **"Select repository..."** in the header bar. Paste a full GitHub URL or use `owner/repo` format. The app fetches all open PRs where you're involved.

### Monitoring a PR

Click the **Monitor** button on any PR card. This starts the monitor loop:

1. Check CI status (waits up to 15 minutes if pending)
2. If CI is failing, invoke `/fix-ci` via Claude to fix it
3. Fetch all review threads via GraphQL (with pagination)
4. If unresolved comments exist, invoke `/handle-pr-comments` via Claude to categorize and fix them
5. Sleep for the configured interval (default: 15 minutes)
6. Repeat until PR is clean or max iterations reached (default: 10)

Progress is shown in real-time via a purple progress bar and mini terminal output on the card.

### Expanded Terminal View

Click the **expand** button on a monitoring card to enter split view — compact PR list on the left, full terminal output on the right.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate between PR cards |
| `Enter` | Open focused PR in GitHub |
| `m` | Toggle monitor on focused PR |
| `r` | Refresh all PRs |
| `?` | Show shortcuts help |
| `Esc` | Close dialogs / clear focus |

### Drag and Drop

Drag PR cards to reorder them. Order persists across sessions.

### Dismissing Merged PRs

Merged PRs show a green **Merged** badge and a **Dismiss** button. Dismissing hides the card (reversible by clearing the cache).

## Claude CLI Skills

The monitor loop uses two Claude CLI skills:

### `/handle-pr-comments <PR_NUM> <REPO>`

Fetches unresolved review threads, categorizes them (FIX vs SKIP), applies code fixes, runs type-check, commits, pushes, and resolves threads.

Options:
- `--threads-file <path>` — Use pre-fetched thread data (skips API call)
- `--review-only` — Categorize and report without fixing

### `/fix-ci --pr <PR_NUM>`

Reads CI failure logs and applies fixes to make tests/builds pass.

Both skills are defined in `~/.claude/commands/` and run via `claude -p`.

## Configuration

### Settings Dialog

Click the gear icon to access:
- **Theme**: Dark / Light
- **Sleep Prevention**: Keep Mac awake while monitors are active
- **Monitor Defaults**: Max iterations, check interval

### API Server

The app runs an HTTP API on port `7890` for external integrations:

```bash
# Start a monitor via API
curl -X POST http://localhost:7890/api/monitors \
  -H "Content-Type: application/json" \
  -d '{"prNumber": 123, "repo": "owner/repo", "maxIterations": 10, "intervalMinutes": 15}'

# Stop a monitor
curl -X DELETE http://localhost:7890/api/monitors/<monitor_id>
```

## Architecture

```
src-tauri/
  src/
    lib.rs              # Tauri commands, PR fetching, caching
    api.rs              # HTTP API server (port 7890)
    db.rs               # SQLite database (PR cache, monitors, settings)
    monitor.rs          # Monitor lifecycle management
    process.rs          # Child process spawning, stdout parsing
    tray.rs             # System tray with active monitor count
    dock.rs             # macOS dock badge
    sleep_prevention.rs # Prevent sleep during monitoring
  scripts/
    monitor-pr-loop.sh  # Main monitoring loop (bash)

src/
  App.tsx               # Main app: grid view, split view, event listeners
  hooks/
    usePRs.ts           # PR fetching with incremental cache
    useMonitors.ts      # Monitor state polling
    usePROrder.ts       # Drag-and-drop ordering persistence
    useDismissedPRs.ts  # Dismissed PR tracking
  components/
    board/              # PRCard, CardGrid, SortablePRCard
    terminal/           # MiniTerminal, FullTerminal (xterm.js)
    layout/             # Header, RepoManager, FilterPanel
    settings/           # SettingsDialog
  lib/
    tauri.ts            # IPC command wrappers
    types.ts            # TypeScript interfaces
    filters.ts          # PR filtering logic
    time.ts             # Relative time formatting
```

### Data Flow

```
GitHub API (gh CLI)
    |
    v
Rust Backend (Tauri)
    |-- SQLite cache (PR data, monitor state)
    |-- Spawns monitor-pr-loop.sh as child process
    |-- Parses @@ITERATION:N/M@@ markers from stdout
    |-- Emits Tauri events: monitor:output, monitor:completed
    v
React Frontend
    |-- Polls monitors every 5s
    |-- Listens for Tauri events
    |-- Renders PR cards with live progress
```

## Troubleshooting

**PRs not loading**: Make sure `gh auth status` shows you're authenticated. The app uses `gh pr list --search "involves:@me"` to find your PRs.

**Monitor exits immediately**: Check that `jq` is installed. The monitor script uses it for JSON processing. Also check `claude` is available in PATH.

**Claude skills not found**: Skills must be in `~/.claude/commands/`. Copy `handle-pr-comments.md` and `fix-ci.md` there.

**Stale PR data**: Click the Refresh button in the header, or press `r`. Force refresh fetches fresh data from GitHub and updates the cache.

## Tech Stack

- **Frontend**: React 19, TypeScript 5.8, Tailwind CSS 4, Vite 7, xterm.js, dnd-kit
- **Backend**: Rust, Tauri 2, SQLite (rusqlite), Chrono
- **Platform**: macOS (tray, dock badges, sleep prevention, notifications)
- **AI**: Claude CLI with custom skills for code review and CI fixing
