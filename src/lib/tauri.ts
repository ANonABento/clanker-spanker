import { invoke } from "@tauri-apps/api/core";
import type { PR, Monitor, PRComment } from "./types";

/**
 * Fetch PRs from GitHub via the Rust backend with incremental caching
 * Supports single repo or multiple repos
 * @param options.forceRefresh - If true, bypasses cache and fetches all PRs
 */
export async function fetchPRs(options?: {
  repo?: string;
  repos?: string[];
  forceRefresh?: boolean;
}): Promise<PR[]> {
  return invoke<PR[]>("fetch_prs", {
    repo: options?.repo ?? null,
    repos: options?.repos ?? null,
    forceRefresh: options?.forceRefresh ?? false,
  });
}

/**
 * Get cached PRs without making network requests
 */
export async function getCachedPRs(options?: {
  repo?: string;
  repos?: string[];
}): Promise<PR[]> {
  return invoke<PR[]>("get_cached_prs", {
    repo: options?.repo ?? null,
    repos: options?.repos ?? null,
  });
}

/**
 * Clear the PR cache
 * @param repo - Optional repo to clear. If not provided, clears all.
 */
export async function clearPRCache(repo?: string): Promise<void> {
  return invoke<void>("clear_pr_cache", { repo: repo ?? null });
}

// ============ Repo Management Commands ============

/**
 * Get all configured repositories
 */
export async function getRepos(): Promise<string[]> {
  return invoke<string[]>("get_repos");
}

/**
 * Add a repository to the list
 */
export async function addRepo(repo: string): Promise<void> {
  return invoke<void>("add_repo", { repo });
}

/**
 * Remove a repository from the list
 */
export async function removeRepo(repo: string): Promise<void> {
  return invoke<void>("remove_repo", { repo });
}

// ============ Settings Commands ============

/**
 * Get the currently selected repository
 */
export async function getSelectedRepo(): Promise<string> {
  return invoke<string>("get_selected_repo");
}

/**
 * Set the currently selected repository
 */
export async function setSelectedRepo(repo: string): Promise<void> {
  return invoke<void>("set_selected_repo", { repo });
}

/**
 * Get a generic setting by key
 */
export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>("get_setting", { key });
}

/**
 * Set a generic setting by key
 */
export async function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>("set_setting", { key, value });
}

// ============ Monitor Commands ============

export interface StartMonitorParams {
  prId: string;
  prNumber: number;
  repo: string;
  maxIterations?: number;
  intervalMinutes?: number;
}

/**
 * Start monitoring a PR
 */
export async function startMonitor(params: StartMonitorParams): Promise<Monitor> {
  return invoke<Monitor>("start_monitor", {
    prId: params.prId,
    prNumber: params.prNumber,
    repo: params.repo,
    maxIterations: params.maxIterations ?? null,
    intervalMinutes: params.intervalMinutes ?? null,
  });
}

/**
 * Stop a running monitor
 */
export async function stopMonitor(monitorId: string): Promise<Monitor> {
  return invoke<Monitor>("stop_monitor", { monitorId });
}

/**
 * Get all monitors, optionally filtered by status or repo
 */
export async function getMonitors(params?: {
  status?: string;
  repo?: string;
}): Promise<Monitor[]> {
  return invoke<Monitor[]>("get_monitors", {
    status: params?.status ?? null,
    repo: params?.repo ?? null,
  });
}

/**
 * Get a single monitor by ID
 */
export async function getMonitor(monitorId: string): Promise<Monitor> {
  return invoke<Monitor>("get_monitor", { monitorId });
}

/**
 * Get active monitor for a specific PR (if any)
 */
export async function getMonitorForPR(prId: string): Promise<Monitor | null> {
  return invoke<Monitor | null>("get_monitor_for_pr", { prId });
}

// ============ PR Comment Commands ============

/**
 * Fetch all review thread comments for a PR from GitHub and store in database
 * This should be called when starting a monitor
 */
export async function fetchPRComments(
  prNumber: number,
  repo: string
): Promise<PRComment[]> {
  return invoke<PRComment[]>("fetch_pr_comments", { prNumber, repo });
}

/**
 * Get cached comments for a PR (without fetching from GitHub)
 */
export async function getPRComments(
  prId: string,
  unresolvedOnly?: boolean
): Promise<PRComment[]> {
  return invoke<PRComment[]>("get_pr_comments", {
    prId,
    unresolvedOnly: unresolvedOnly ?? false,
  });
}

// ============ Notification Commands ============

/**
 * Show native notification that PR is clean
 */
export async function notifyPRClean(prNumber: number, prId: string): Promise<void> {
  return invoke<void>("notify_pr_clean", { prNumber, prId });
}

/**
 * Show native notification that comments were found
 */
export async function notifyCommentFound(prNumber: number, prId: string, count: number): Promise<void> {
  return invoke<void>("notify_comment_found", { prNumber, prId, count });
}

/**
 * Show native notification that monitor completed
 */
export async function notifyMonitorComplete(prNumber: number, prId: string, commentsFixed: number): Promise<void> {
  return invoke<void>("notify_monitor_complete", { prNumber, prId, commentsFixed });
}

/**
 * Show native notification that monitor failed
 */
export async function notifyMonitorFailed(prNumber: number, prId: string, reason: string): Promise<void> {
  return invoke<void>("notify_monitor_failed", { prNumber, prId, reason });
}

/**
 * Show window and focus a specific PR
 */
export async function showAndFocusPR(prId: string): Promise<void> {
  return invoke<void>("show_and_focus_pr", { prId });
}
