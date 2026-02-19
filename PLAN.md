# Clanker Spanker vNext Plan (Detailed)

## Goals
- Preserve all existing features and UX while making the system highly customizable.
- Enable “one thread per PR” overnight runs with guardrails for safety and cost.
- Make the execution engine swappable (Claude, Codex, future providers).
- Cloud offload is required (local-only is fallback, not primary).

## Non-Goals (initial phases)
- Replacing the current UI/UX with a new design.
- Full multi-tenant SaaS (auth/billing) unless explicitly prioritized.
- Auto-merge or auto-approval of PRs.

## Decisions Locked
- Pushes are allowed (system can commit/push fixes).
- Expected volume: 20–40 PRs per overnight run.
- Cloud offload is required.
- UI should show progress during overnight runs.
- CI scope: GitHub checks only (treat GitHub Actions/checks as authoritative).
- Use a GitHub App for authentication and pushes.
- Global settings only for now (per-repo overrides can be a later enhancement).
- Steps are configurable: CI only, comments only, or both.
- Auto-start monitoring when PR moves Draft -> Open.
- Schedule is customizable (days/time/timezone).
- Target global concurrency cap: 20–30.
- Triggers: manual start, scheduled runs, and Draft -> Open auto-start.
- Preserve current monitor behavior order: check CI (pending/fail/pass) then handle unresolved comments.

## Baseline (What We Already Have)

### Core app and data flow
- Desktop Tauri app with PR grid, monitors, logs, filters, settings.
- PR fetching via `gh` with incremental cache in SQLite.
- Per-PR monitor loop is a bash script that checks CI + review threads and invokes Claude CLI skills.
- Loop order today: check CI (wait on pending) -> fix CI if failing -> fetch unresolved review threads -> fix comments.
- Local HTTP API for starting/stopping monitors.

### Relevant files (must preserve behavior)
- Monitor loop: `src-tauri/scripts/monitor-pr-loop.sh`
  - Uses `claude -p "/fix-ci"` and `claude -p "/handle-pr-comments"`.
  - Supports `--threads-file` to avoid re-fetching review threads.
- Monitor lifecycle + events: `src-tauri/src/monitor.rs`, `src-tauri/src/process.rs`
  - Emits `monitor:output`, `monitor:completed`, `monitor:state-changed`.
- Local API: `src-tauri/src/api.rs` (`/api/monitor/start`, `/api/monitor/stop`, `/api/monitor/status`)
- PR cache and settings: `src-tauri/src/db.rs`, `src-tauri/src/lib.rs`

### Current Claude commands (from `~/.claude/commands`)
- `fix-ci.md`
  - Reads GitHub checks, pulls failing logs via `gh run view`.
  - Fixes, runs local checks, commits and pushes.
- `handle-pr-comments.md`
  - Fetches or accepts pre-fetched review threads, categorizes via Codex.
  - Applies fixes, commits/pushes, resolves threads.
  - Updates `.context/memory/pitfalls.md` with abstracted review patterns.
  - No AI attribution in commits.

These behaviors are the baseline we should preserve in the new runner(s).

## Target Architecture (Incremental, Compatible)

### 1. Runner abstraction
Interface: `start(job)`, `stream_output(job)`, `stop(job)`, `status(job)`

Implementations:
- `LocalScriptRunner` (wraps current bash loop for parity / fallback)
- `ClaudeRunner` (invokes the Claude CLI commands directly)
- `CodexRunner` (new, primary)
- `CloudWorkerRunner` (required; uses worker service)

### 2. Orchestrator
- Schedules overnight runs (automation).
- Enforces global concurrency and budget limits.
- Avoids duplicate work (recent activity, already clean).
- Detects Draft -> Open transitions and auto-enqueues when enabled.
- Supports manual per-PR start (existing UI) and scheduled runs.

### 3. Configuration system (global-only v1)
Global settings only, with future extension to per-repo overrides.

### 4. Job + monitor model
- Monitor = UI-visible record (like today).
- Job run = execution record (status, logs, errors, attempts).
- Jobs are the unit of scheduling and orchestration.

## Customization (Global-only v1)

### Execution
- Runner: `Codex | Claude | Auto`.
- Steps: `CI only | Comments only | Both`.
- Auto-start on Draft -> Open: `on/off`.
- Schedule: days, time, timezone.
- Manual trigger remains available in UI.

### Limits
- Default iterations (initial default 10).
- Interval minutes (applies to loop-based runners).
- Global concurrency cap (parallel jobs, default 20–30).
- Max jobs per night (budget guardrail).

### CI handling
- Pending wait strategy: `wait up to N minutes` or `fail fast`.

### Push behavior
- Commit message template.
- Push enabled/disabled.
- No AI attribution (preserve current behavior).

### Notifications
- Run start / run complete / failures.

## Cloud Offload (Required)

### Components (Aligned with signalspace)
- **Cloud Orchestrator API**: `apps/pr-fixer` in the signalspace monorepo (Fastify + Postgres).
- **Workers**: run PR jobs (clone repo, run runner, push) — to be added in `apps/pr-fixer`.
- **GitHub App**: auth for API + push.
- **Infra**: Porter (Terraform deprecated in signalspace).

### Worker responsibilities
- Clone repo and checkout PR branch.
- Fetch CI status via GitHub checks.
- Fetch review threads (GraphQL).
- Run steps based on settings.
- Commit + push with GitHub App identity.
- Stream logs back for UI (S3 recommended).

### Log streaming
- UI should show per-PR log output (like today) and top-level run progress.

## Data Model (Additions)

### New tables (proposed)
- `job_runs`
  - `id`, `pr_id`, `status`, `runner`, `attempt`, `started_at`, `ended_at`, `exit_reason`, `log_ref`
- `job_queue`
  - `id`, `pr_id`, `priority`, `created_at`, `scheduled_for`, `status`
- `settings_global`
  - json blob or key/value pairs for settings above

### Keep existing
- `monitors` table and related UI behavior.
- `pr_cache` and `pr_comments` for fast UI access.

## UI Changes (Minimal + Focused)
- Settings page: add sections for runner, steps, limits, CI behavior, push policy, notifications.
- Run dashboard (simple): queued/running/completed/failed counts.
- Per-PR progress + log pane (reuse existing monitor UI patterns).

## Security + Auth
- GitHub App required.
- Use App installation token for all cloud worker operations.
- Audit log: store job run summaries and pushed commits.

## Roadmap Phases

### Phase 0: Audit + Acceptance Criteria (1-2 days)
- Inventory all existing features and map to modules.
- Create a parity checklist for must-keep features.
- Produce a gap list (bugs, missing polish, optimizations).

Deliverables:
- Audit report
- Feature parity checklist
- Prioritized gap list

### Phase 1: Runner Abstraction (1-2 weeks)
- Introduce runner trait + job model in backend.
- Define job schema (queue state, retries, worker assignment, thread id).
- Wrap existing bash loop as LocalScriptRunner.
- Keep monitor events and log streaming unchanged.

Deliverables:
- Runner interface + LocalScriptRunner
- No regression to existing monitors

### Phase 2: Cloud Orchestrator in signalspace (2-3 weeks)
- Add `apps/pr-fixer` service (Fastify + Postgres) — DONE (scaffold).
- Implement GitHub App auth + PR discovery inside the service.
- Add worker loop to execute jobs and update run state.
- Add Porter env groups: `pr-fixer-staging`, `pr-fixer-prod`.
- Optional: store logs in S3 for UI consumption.

Deliverables:
- Cloud orchestrator + worker running in signalspace
- API endpoints for start/run status/logs

### Phase 3: Config + Settings Expansion (1-2 weeks)
- Implement config persistence (global only).
- Add detailed settings UI sections.
- Add validation + effective config view.

Deliverables:
- Expanded settings page
- Config resolver in backend

### Phase 4: Codex Runner (1-2 weeks)
- Implement CodexRunner.
- Steps: fetch CI logs, fetch review threads, apply fixes, run tests, summarize.
- Safety modes and stop conditions.

Deliverables:
- CodexRunner behind same interface
- Configurable steps and limits

### Phase 5: Hardening + Optimization (ongoing)
- Smarter prioritization (failing CI / changes requested first).
- Cost controls (budget caps).
- Reliability metrics, retry logic.

## Open Questions
- Default schedule (days + time + timezone)?
- Do we need team-level multi-user support in the near term?
