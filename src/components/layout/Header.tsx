import { useState, useEffect } from "react";
import { RefreshCw, Settings, Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RepoManager } from "./RepoManager";
import { FilterPanel } from "@/components/filters/FilterPanel";
import { formatRelativeTimeFromDate } from "@/lib/time";
import type { PRFilters } from "@/lib/filters";

interface HeaderProps {
  onRefresh: () => void;
  isLoading?: boolean;
  onRepoChange: () => void;
  onOpenSettings: () => void;
  filters: PRFilters;
  onFilterChange: <K extends keyof PRFilters>(key: K, value: PRFilters[K]) => void;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
  showFilters: boolean;
  onToggleFilters: () => void;
  availableLabels: string[];
  availableAuthors: string[];
  availableRepos: string[];
  lastRefreshTime?: Date | null;
}

export function Header({
  onRefresh,
  isLoading,
  onRepoChange,
  onOpenSettings,
  filters,
  onFilterChange,
  onResetFilters,
  hasActiveFilters,
  showFilters,
  onToggleFilters,
  availableLabels,
  availableAuthors,
  availableRepos,
  lastRefreshTime,
}: HeaderProps) {
  // Tick every 60s so the "X minutes ago" text stays current
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastRefreshTime) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [lastRefreshTime]);

  return (
    <header className="flex items-center justify-between border-b border-[#1a1a1a] bg-[#0a0a0a] px-6 py-4">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-[#c0c0c0] drop-shadow-[0_0_8px_rgba(192,192,192,0.3)]">
          Clanker Spanker
        </h1>
        <div className="h-5 w-px bg-[#2a2a2a]" />
        <RepoManager onRepoChange={onRepoChange} />
      </div>

      <div className="flex items-center gap-3">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#505050]" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onFilterChange("search", e.target.value)}
            placeholder="Search PRs..."
            className="h-8 w-44 rounded border border-[#262626] bg-[#1a1a1a] pl-8 pr-8 text-sm text-[#c0c0c0] placeholder:text-[#505050] focus:border-[#505050] focus:outline-none"
          />
          {filters.search && (
            <button
              onClick={() => onFilterChange("search", "")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-[#262626]"
            >
              <X className="h-3 w-3 text-[#606060]" />
            </button>
          )}
        </div>

        {/* Filter button */}
        <div className="relative">
          <Button
            variant={hasActiveFilters ? "default" : "ghost"}
            size="icon"
            onClick={onToggleFilters}
            className={hasActiveFilters ? "relative" : undefined}
          >
            <Filter className="h-4 w-4" />
            {hasActiveFilters && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#8b5cf6]" />
            )}
          </Button>

          {showFilters && (
            <FilterPanel
              filters={filters}
              onFilterChange={onFilterChange}
              onReset={onResetFilters}
              onClose={onToggleFilters}
              availableLabels={availableLabels}
              availableAuthors={availableAuthors}
              availableRepos={availableRepos}
            />
          )}
        </div>

        <div className="h-5 w-px bg-[#2a2a2a]" />

        {lastRefreshTime && (
          <span className="text-xs text-[#606060]">
            {formatRelativeTimeFromDate(lastRefreshTime)}
          </span>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={() => onRefresh()}
          disabled={isLoading}
          className={isLoading ? "opacity-70" : ""}
        >
          <RefreshCw
            className={`h-4 w-4 ${isLoading ? "animate-spin text-[#8b5cf6]" : ""}`}
          />
          {isLoading ? "Refreshing..." : "Refresh"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
