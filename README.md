# 🤖 Clanker Spanker 👋

A macOS desktop app that monitors your GitHub pull requests and automatically fixes CI failures and code review comments using Claude AI.

Built with Tauri 2 + React + TypeScript.

<div style="display: flex">
  <img width="1728" height="1084" alt="image" src="https://github.com/user-attachments/assets/37aba000-4dee-444d-bbb7-081567233967" />
  <img width="1728" height="1084" alt="image" src="https://github.com/user-attachments/assets/aa60d083-f3f6-4591-8f62-95be3c5efbf5" />
</div>

## What It Does

1. **Shows your open PRs** in a card grid with CI status, review status, labels, and comment counts
2. **Monitors PRs** on a loop — checks CI, fetches review threads, and invokes Claude to fix issues automatically
3. **Tracks progress** with live terminal output, progress bars, and iteration counters
4. **Persists state** — merged PRs stay visible until dismissed, monitor history is retained

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| [Node.js](https://nodejs.org/) 18+ | Frontend build | `brew install node` |
| [Rust](https://rustup.rs/) | Tauri backend | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| [GitHub CLI](https://cli.github.com/) | PR data & GraphQL API | `brew install gh` |
| [jq](https://jqlang.github.io/jq/) | JSON processing in monitor script | `brew install jq` |
| [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) | AI-powered fixes | `npm install -g @anthropic-ai/claude-code` |

After installing, authenticate both tools:

```bash
gh auth login          # GitHub CLI — select HTTPS, authenticate via browser
claude                 # Claude CLI — follow the setup prompts to link your account
```

## Setup

```bash
git clone https://github.com/ANonABento/clanker-spanker.git
cd clanker-spanker
npm install
```

### Claude CLI Skills

The monitor loop depends on two Claude CLI skill files in `~/.claude/commands/`:

- **`handle-pr-comments.md`** — Categorizes and fixes unresolved review threads
- **`fix-ci.md`** — Reads CI failure logs and applies fixes

These are custom prompt files, not built into Claude CLI. You need to create them or get them from whoever shared this repo. Place them at:

```
~/.claude/commands/handle-pr-comments.md
~/.claude/commands/fix-ci.md
```

Without these files, the monitor will still run its loop but skip the AI fix steps (it logs a warning and continues).

### Local Repo Clone

The monitor script needs a local git clone of the repo it's monitoring so Claude can read and edit the code. It searches these directories in order:

1. `~/conductor/workspaces/<repo-name>/` (Conductor worktrees — picks most recently modified)
2. `~/<owner>/<repo-name>/`
3. `~/repos/<owner>/<repo-name>/`
4. `~/code/<owner>/<repo-name>/`
5. `~/repos/<repo-name>/`
6. `~/code/<repo-name>/`
7. `~/projects/<repo-name>/`
8. `~/workspace/<repo-name>/`
9. `~/ghq/github.com/<owner>/<repo-name>/`

If not found, it falls back to the current directory with a warning. **Make sure you have a local clone in one of these locations before starting a monitor.**

## Running

```bash
# Development (hot reload for both frontend and Rust backend)
npm run dev

# Production build (creates .app bundle in src-tauri/target/release/bundle/)
npm run tauri build
```

## Usage

### Adding a Repository

Click **"Select repository..."** in the header bar. Paste a full GitHub URL (`https://github.com/owner/repo`) or use `owner/repo` format. The app fetches all open PRs where you're involved (`involves:@me`).

### Monitoring a PR

Click the **Monitor** button on any PR card. This starts the monitor loop:

1. Check CI status (waits up to 15 min if pending)
2. If CI is failing, invoke `/fix-ci` via Claude to fix it
3. Fetch all review threads via GraphQL (with pagination)
4. If unresolved comments exist, invoke `/handle-pr-comments` via Claude to categorize and fix them
5. Sleep for the configured interval (default: 15 minutes)
6. Repeat until PR is clean or max iterations reached (default: 10)

Progress is shown in real-time via a purple progress bar and mini terminal output on the card. When complete, the bar turns green and shows the final iteration count (e.g., `2/10`).

### Expanded Terminal View

Click the **expand** icon on a monitoring card to enter split view — compact PR list on the left, full terminal output on the right. Press `Esc` or click **Collapse** to return to the grid.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate between PR cards |
| `Enter` | Open focused PR in GitHub |
| `m` | Toggle monitor on focused PR |
| `r` | Refresh all PRs |
| `?` | Show shortcuts help |
| `Esc` | Close dialogs / clear focus |
| `Cmd+Shift+P` | Global: show/hide window from anywhere |

### Drag and Drop

Drag PR cards to reorder them. Order persists across sessions (stored in localStorage).

### Filters

Click the filter icon in the header to filter PRs by:
- **Status**: CI passing/failing, review approved/changes requested
- **Labels**: Any GitHub labels on the PRs
- **Authors**: PR author

### Dismissing Merged PRs

Merged PRs show a green **Merged** badge and a **Dismiss** button. Dismissing hides the card from the grid. To restore dismissed PRs, open devtools and run:

```js
localStorage.removeItem("dismissed-prs")
```

Then refresh.

## Settings

Click the gear icon in the header:

| Setting | Description |
|---------|-------------|
| **Theme** | Dark or Light mode |
| **Start on login** | Auto-launch at macOS login |
| **Prevent sleep** | Keep Mac awake while any monitor is active |

Monitor defaults (max iterations = 10, interval = 15 min) are currently hardcoded. To change them per-monitor, use the API (see below). To change the defaults globally, edit `src-tauri/src/monitor.rs`.

## API Server

The app runs an HTTP API on localhost port `7890` for external integrations (e.g., starting a monitor from a CLI script or another tool):

```bash
# Start a monitor
curl -X POST http://localhost:7890/api/monitors \
  -H "Content-Type: application/json" \
  -d '{
    "pr_number": 123,
    "repo": "owner/repo",
    "max_iterations": 10,
    "interval_minutes": 15
  }'

# Stop a monitor
curl -X DELETE http://localhost:7890/api/monitors/<monitor_id>
```

Only accessible from localhost. The API starts automatically when the app launches.

## Architecture

```
src-tauri/
  src/
    lib.rs              # Tauri commands, PR fetching via gh CLI, SQLite caching
    api.rs              # HTTP API server (port 7890, localhost only)
    db.rs               # SQLite schema and queries
    monitor.rs          # Monitor lifecycle (start, stop, status tracking)
    process.rs          # Child process spawning, stdout/stderr parsing
    tray.rs             # System tray icon with active monitor count
    dock.rs             # macOS dock badge (active monitor count)
    sleep_prevention.rs # IOKit assertion to prevent macOS sleep
    notifications.rs    # macOS native notifications
    hotkey.rs           # Global Cmd+Shift+P hotkey registration
  scripts/
    monitor-pr-loop.sh  # Bash script executed per monitored PR

src/
  App.tsx               # Main app: grid view, split view, event listeners
  hooks/
    usePRs.ts           # PR fetching with incremental cache
    useMonitors.ts      # Monitor state polling (every 5s)
    usePROrder.ts       # Drag-and-drop ordering (localStorage)
    useDismissedPRs.ts  # Dismissed PR tracking (localStorage)
    useKeyboardNav.ts   # Vim-style keyboard navigation
    useRepos.ts         # Repository selection and management
    useFilters.ts       # PR filtering state
  components/
    board/              # PRCard, CardGrid, SortablePRCard, PRCardSkeleton
    terminal/           # MiniTerminal (3-4 line preview), FullTerminal (xterm.js)
    layout/             # Header, RepoManager, RepoSelector, FilterPanel
    settings/           # SettingsDialog
  lib/
    tauri.ts            # IPC command wrappers (invoke helpers)
    types.ts            # TypeScript interfaces (PR, Monitor, etc.)
    filters.ts          # PR filtering logic
    time.ts             # Relative time formatting ("3m ago", countdown)
```

### Data Flow

```
GitHub (gh CLI)
    |
    v
Rust Backend (Tauri)
    |-- Fetches PRs via `gh pr list` -> caches in SQLite
    |-- Checks stale cached PRs for merged/closed state
    |-- Spawns monitor-pr-loop.sh as child process per PR
    |-- Parses @@ITERATION:N/M@@ markers from stdout -> updates DB
    |-- Emits Tauri events: monitor:output, monitor:completed
    |-- HTTP API on :7890 for external start/stop
    |
    v
React Frontend
    |-- Polls monitor status every 5 seconds
    |-- Listens for Tauri events (terminal output, completion)
    |-- Renders PR cards with live progress bars
    |-- Persists card order and dismissed PRs in localStorage
```

## Platform Support

**macOS only.** The app uses macOS-specific APIs:
- IOKit for sleep prevention
- NSApplication for dock badges
- Cocoa for tray icon
- NSUserNotificationCenter for native notifications

The frontend and core Tauri logic are cross-platform, but the Rust backend would need platform-specific guards (`#[cfg(target_os)]`) and alternative implementations for Linux/Windows.

## Troubleshooting

**PRs not loading**
- Run `gh auth status` and confirm you're logged in to github.com
- The app fetches PRs with `gh pr list --search "involves:@me"` — make sure the repo has PRs involving your account

**Monitor exits immediately after iteration 1**
- Verify `jq` is installed: `which jq`
- Verify `claude` is in PATH: `which claude`
- Check the monitor terminal output for error messages

**Claude skills not found**
- Verify: `ls ~/.claude/commands/handle-pr-comments.md ~/.claude/commands/fix-ci.md`
- Without these, the monitor logs a warning and skips the fix step

**No local repo clone found**
- The monitor terminal will show "Warning: Could not find local clone of owner/repo"
- Clone the repo into one of the [searched paths](#local-repo-clone)

**Stale PR data / merged PRs missing**
- Click Refresh in the header or press `r`
- Force refresh fetches from GitHub and checks cached PRs for merged/closed state

**App window doesn't appear**
- Use the global shortcut `Cmd+Shift+P` to show/hide the window
- Check the system tray (menu bar) for the Clanker Spanker icon

## Tech Stack

- **Frontend**: React 19, TypeScript 5.8, Tailwind CSS 4, Vite 7, xterm.js, dnd-kit
- **Backend**: Rust, Tauri 2, SQLite (rusqlite), tiny-http, Chrono
- **Platform**: macOS (IOKit, Cocoa, NSApplication)
- **AI**: Claude CLI with custom skills (`/handle-pr-comments`, `/fix-ci`)
