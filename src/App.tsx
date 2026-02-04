import { useMemo, useCallback, useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Header } from "@/components/layout/Header";
import { CardGrid } from "@/components/board/CardGrid";
import { PRCard } from "@/components/board/PRCard";
import { DoneChip } from "@/components/board/DoneChip";
import { FullTerminal } from "@/components/terminal/FullTerminal";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ToastContainer } from "@/components/ui/toast";
import { KeyboardShortcuts } from "@/components/ui/keyboard-shortcuts";
import { usePRs } from "@/hooks/usePRs";
import { useMonitors } from "@/hooks/useMonitors";
import { useRepos } from "@/hooks/useRepos";
import { useFilters } from "@/hooks/useFilters";
import { useTheme } from "@/hooks/useTheme";
import { useSettings } from "@/hooks/useSettings";
import { useToast } from "@/hooks/useToast";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { useDismissedPRs } from "@/hooks/useDismissedPRs";
import { usePROrder } from "@/hooks/usePROrder";
import { Button } from "@/components/ui/button";
import { filterPRs, collectLabels, collectAuthors } from "@/lib/filters";
import type { PR } from "@/lib/types";

function App() {
  const { repos, currentRepo, isLoading: isLoadingRepo } = useRepos();
  const { filters, setFilter, resetFilters, hasActiveFilters } = useFilters();
  const { prs, isLoading: isLoadingPRs, error, refresh } = usePRs({
    repo: currentRepo || undefined,
  });
  const { startMonitor, stopMonitor, getMonitorForPR } = useMonitors();
  const { theme, setTheme } = useTheme();
  const { isOpen: isSettingsOpen, openSettings, closeSettings } = useSettings();
  const { toasts, showToast, dismissToast } = useToast();
  const { dismiss, isDismissed } = useDismissedPRs();
  const { sortPRs, reorder } = usePROrder();
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedPRId, setExpandedPRId] = useState<string | null>(null);
  const [terminalOutputs, setTerminalOutputs] = useState<Record<string, string[]>>({});

  // Collect available labels and authors for filter options
  const availableLabels = useMemo(() => collectLabels(prs), [prs]);
  const availableAuthors = useMemo(() => collectAuthors(prs), [prs]);

  // Combine PR data with monitor state for column assignment and apply filters
  const prsWithMonitorState = useMemo(() => {
    // First, apply monitor state to determine column
    const prsWithColumn = prs.map((pr) => {
      const monitor = getMonitorForPR(pr.id);
      const column = monitor && ["running", "sleeping"].includes(monitor.status)
        ? "monitoring"
        : pr.column;
      return { ...pr, column } as PR;
    });

    // Then apply filters
    return filterPRs(prsWithColumn, filters);
  }, [prs, getMonitorForPR, filters]);

  // Separate done PRs (not dismissed) and active PRs
  const donePRs = useMemo(
    () => prsWithMonitorState.filter((pr) => pr.column === "done" && !isDismissed(pr.id)),
    [prsWithMonitorState, isDismissed]
  );

  const activePRs = useMemo(
    () => sortPRs(prsWithMonitorState.filter((pr) => pr.column !== "done")),
    [prsWithMonitorState, sortPRs]
  );

  // Create flat list of PRs for keyboard navigation (monitoring -> todo)
  const allPRsFlat = useMemo(() => {
    const monitoring = activePRs.filter((pr) => pr.column === "monitoring");
    const todo = activePRs.filter((pr) => pr.column === "todo");
    return [...monitoring, ...todo, ...donePRs];
  }, [activePRs, donePRs]);

  const handleStartMonitor = useCallback(
    async (pr: PR) => {
      try {
        await startMonitor(pr);
        showToast(`Monitoring PR #${pr.number}`, "info");
      } catch (err) {
        console.error("Failed to start monitor:", err);
        showToast("Failed to start monitor", "error");
      }
    },
    [startMonitor, showToast]
  );

  const handleStopMonitor = useCallback(
    async (pr: PR) => {
      try {
        await stopMonitor(pr.id);
        showToast(`Stopped monitoring PR #${pr.number}`, "info");
      } catch (err) {
        console.error("Failed to stop monitor:", err);
        showToast("Failed to stop monitor", "error");
      }
    },
    [stopMonitor, showToast]
  );

  const handleDismiss = useCallback(
    (pr: PR) => {
      dismiss(pr.id);
      showToast(`Dismissed PR #${pr.number}`, "info");
    },
    [dismiss, showToast]
  );

  const handleExpand = useCallback((pr: PR) => {
    setExpandedPRId(pr.id);
  }, []);

  const handleCollapse = useCallback(() => {
    setExpandedPRId(null);
  }, []);

  const handleRepoChange = useCallback(() => {
    setTimeout(refresh, 100);
  }, [refresh]);

  // Handle toggling monitor for keyboard navigation
  const handleToggleMonitor = useCallback(
    async (pr: PR) => {
      const monitor = getMonitorForPR(pr.id);
      if (monitor && ["running", "sleeping"].includes(monitor.status)) {
        await handleStopMonitor(pr);
      } else if (pr.column === "todo") {
        await handleStartMonitor(pr);
      }
    },
    [getMonitorForPR, handleStartMonitor, handleStopMonitor]
  );

  // Keyboard navigation
  const { focusedIndex, setFocusedIndex } = useKeyboardNav({
    totalCards: allPRsFlat.length,
    onOpenPR: (index) => {
      const pr = allPRsFlat[index];
      if (pr) openUrl(pr.url);
    },
    onToggleMonitor: (index) => {
      const pr = allPRsFlat[index];
      if (pr) handleToggleMonitor(pr);
    },
    onRefresh: refresh,
    onShowHelp: () => setShowKeyboardHelp(true),
    onEscape: () => {
      if (expandedPRId) {
        handleCollapse();
      } else if (showKeyboardHelp) {
        setShowKeyboardHelp(false);
      }
    },
    enabled: !isSettingsOpen && !showKeyboardHelp,
  });

  // Determine which PR is focused based on the flat list index
  const focusedPRId = focusedIndex !== null && focusedIndex !== undefined
    ? allPRsFlat[focusedIndex]?.id
    : null;

  // Listen for notification click to focus a specific PR
  useEffect(() => {
    const unlisten = listen<string>("pr:focus", (event) => {
      const prId = event.payload;
      const index = allPRsFlat.findIndex((pr) => pr.id === prId);
      if (index >= 0) {
        setFocusedIndex(index);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [allPRsFlat, setFocusedIndex]);

  // Listen for terminal output events
  useEffect(() => {
    const unlisten = listen<{ monitorId: string; prId: string; line: string }>(
      "monitor:output",
      (event) => {
        const { prId, line } = event.payload;
        setTerminalOutputs((prev) => ({
          ...prev,
          [prId]: [...(prev[prId] || []), line].slice(-100), // Keep last 100 lines
        }));
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const isLoading = isLoadingRepo || isLoadingPRs;

  // Get expanded PR if any
  const expandedPR = expandedPRId
    ? activePRs.find((pr) => pr.id === expandedPRId)
    : null;

  return (
    <div className="flex h-screen flex-col bg-[#0a0a0a]">
      <Header
        onRefresh={refresh}
        isLoading={isLoading}
        onRepoChange={handleRepoChange}
        onOpenSettings={openSettings}
        filters={filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        hasActiveFilters={hasActiveFilters}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters(!showFilters)}
        availableLabels={availableLabels}
        availableAuthors={availableAuthors}
        availableRepos={repos}
      />

      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={closeSettings}
        theme={theme}
        onThemeChange={setTheme}
      />

      <KeyboardShortcuts
        isOpen={showKeyboardHelp}
        onClose={() => setShowKeyboardHelp(false)}
      />

      <main className="flex-1 min-h-0 overflow-hidden p-4">
        {error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : expandedPR ? (
          // Split View (expanded terminal)
          <SplitView
            activePRs={activePRs}
            expandedPR={expandedPR}
            focusedPRId={focusedPRId}
            terminalOutput={terminalOutputs[expandedPR.id] || []}
            onCollapse={handleCollapse}
            onExpand={handleExpand}
            onStartMonitor={handleStartMonitor}
            onStopMonitor={handleStopMonitor}
            getMonitorForPR={getMonitorForPR}
          />
        ) : (
          // Grid View (default)
          <CardGrid
            prs={activePRs}
            isLoading={isLoading}
            focusedPRId={focusedPRId}
            hasRepo={!!currentRepo}
            onReorder={reorder}
            terminalOutputs={terminalOutputs}
            getMonitorForPR={getMonitorForPR}
            onStartMonitor={handleStartMonitor}
            onStopMonitor={handleStopMonitor}
            onOpenInGitHub={(pr) => openUrl(pr.url)}
            onExpand={handleExpand}
            doneChips={
              donePRs.length > 0
                ? donePRs.map((pr) => (
                    <DoneChip
                      key={pr.id}
                      pr={pr}
                      isFocused={pr.id === focusedPRId}
                      onDismiss={handleDismiss}
                      onOpenInGitHub={(pr) => openUrl(pr.url)}
                    />
                  ))
                : undefined
            }
          />
        )}
      </main>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// Split view component for expanded terminal
interface SplitViewProps {
  activePRs: PR[];
  expandedPR: PR;
  focusedPRId: string | null;
  terminalOutput: string[];
  onCollapse: () => void;
  onExpand: (pr: PR) => void;
  onStartMonitor: (pr: PR) => void;
  onStopMonitor: (pr: PR) => void;
  getMonitorForPR: (prId: string) => any;
}

function SplitView({
  activePRs,
  expandedPR,
  focusedPRId,
  terminalOutput,
  onCollapse,
  onExpand,
  onStartMonitor,
  onStopMonitor,
  getMonitorForPR,
}: SplitViewProps) {
  const monitor = getMonitorForPR(expandedPR.id);

  return (
    <div className="flex h-full gap-4">
      {/* Left: Compact card list */}
      <div className="w-64 flex-shrink-0 overflow-y-auto space-y-2">
        {activePRs.map((pr) => (
          <PRCard
            key={pr.id}
            pr={pr}
            monitor={getMonitorForPR(pr.id)}
            isFocused={pr.id === focusedPRId}
            isCompact
            onStartMonitor={onStartMonitor}
            onStopMonitor={onStopMonitor}
            onExpand={onExpand}
          />
        ))}
      </div>

      {/* Right: Full terminal */}
      <div className="flex-1 flex flex-col rounded-lg border border-[#1f1f1f] bg-[#111] overflow-hidden">
        {/* Terminal header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#1f1f1f]">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-[#c0c0c0]">#{expandedPR.number}</span>
            <span className="text-sm text-[#808080] truncate max-w-md">
              {expandedPR.title}
            </span>
            {monitor && (
              <span className="text-xs text-[#606060] tabular-nums">
                {monitor.iteration}/{monitor.maxIterations}
              </span>
            )}
          </div>
          <button
            onClick={onCollapse}
            className="text-xs px-2 py-1 rounded bg-[#1a1a1a] text-[#808080] hover:bg-[#222] hover:text-[#c0c0c0] transition-colors"
          >
            Collapse
          </button>
        </div>

        {/* Full Terminal */}
        <FullTerminal
          output={terminalOutput}
          className="flex-1 bg-[#0a0a0a]"
          onInput={(data) => {
            // TODO: Send input to process via Tauri
            console.log("Terminal input:", data);
          }}
        />
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="text-red-400/80">
        <svg
          className="mx-auto h-12 w-12"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-[#a0a0a0]">
          Failed to fetch PRs
        </h2>
        <p className="mt-1 text-sm text-[#505050]">{message}</p>
      </div>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export default App;
