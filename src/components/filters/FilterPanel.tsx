import { X, Search, Filter } from "lucide-react";
import type { PRFilters } from "@/lib/filters";

interface FilterPanelProps {
  filters: PRFilters;
  onFilterChange: <K extends keyof PRFilters>(key: K, value: PRFilters[K]) => void;
  onReset: () => void;
  onClose: () => void;
  availableLabels: string[];
  availableAuthors: string[];
  availableRepos: string[];
}

export function FilterPanel({
  filters,
  onFilterChange,
  onReset,
  onClose,
  availableLabels,
  availableAuthors,
  availableRepos,
}: FilterPanelProps) {
  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-[#262626] bg-[#141414] p-4 shadow-lg">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[#808080]" />
          <h3 className="text-sm font-medium text-[#fafafa]">Filters</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="text-xs text-[#808080] hover:text-[#fafafa]"
          >
            Clear all
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-[#262626]"
          >
            <X className="h-4 w-4 text-[#606060]" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Search */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[#808080]">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#505050]" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => onFilterChange("search", e.target.value)}
              placeholder="Title, number, or branch..."
              className="w-full rounded border border-[#262626] bg-[#1a1a1a] py-1.5 pl-8 pr-3 text-sm text-[#c0c0c0] placeholder:text-[#505050] focus:border-[#505050] focus:outline-none"
            />
          </div>
        </div>

        {/* State and Review Status row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#808080]">
              State
            </label>
            <select
              value={filters.state}
              onChange={(e) =>
                onFilterChange("state", e.target.value as PRFilters["state"])
              }
              className="w-full rounded border border-[#262626] bg-[#1a1a1a] px-2 py-1.5 text-sm text-[#c0c0c0] focus:border-[#505050] focus:outline-none"
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="merged">Merged</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#808080]">
              Review
            </label>
            <select
              value={filters.reviewStatus}
              onChange={(e) =>
                onFilterChange(
                  "reviewStatus",
                  e.target.value as PRFilters["reviewStatus"]
                )
              }
              className="w-full rounded border border-[#262626] bg-[#1a1a1a] px-2 py-1.5 text-sm text-[#c0c0c0] focus:border-[#505050] focus:outline-none"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="changes_requested">Changes Requested</option>
            </select>
          </div>
        </div>

        {/* CI Status and Drafts row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#808080]">
              CI Status
            </label>
            <select
              value={filters.ciStatus}
              onChange={(e) =>
                onFilterChange("ciStatus", e.target.value as PRFilters["ciStatus"])
              }
              className="w-full rounded border border-[#262626] bg-[#1a1a1a] px-2 py-1.5 text-sm text-[#c0c0c0] focus:border-[#505050] focus:outline-none"
            >
              <option value="all">All</option>
              <option value="passing">Passing</option>
              <option value="failing">Failing</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={filters.includeDrafts}
                onChange={(e) => onFilterChange("includeDrafts", e.target.checked)}
                className="h-4 w-4 rounded border-[#262626] bg-[#1a1a1a] text-[#8b5cf6] focus:ring-[#8b5cf6] focus:ring-offset-[#141414]"
              />
              <span className="text-sm text-[#808080]">Include drafts</span>
            </label>
          </div>
        </div>

        {/* Author */}
        {availableAuthors.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#808080]">
              Author
            </label>
            <select
              value={filters.author}
              onChange={(e) => onFilterChange("author", e.target.value)}
              className="w-full rounded border border-[#262626] bg-[#1a1a1a] px-2 py-1.5 text-sm text-[#c0c0c0] focus:border-[#505050] focus:outline-none"
            >
              <option value="">All authors</option>
              {availableAuthors.map((author) => (
                <option key={author} value={author}>
                  {author}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Repos */}
        {availableRepos.length > 1 && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#808080]">
              Repositories
            </label>
            <div className="max-h-24 space-y-1 overflow-y-auto">
              {availableRepos.map((repo) => (
                <label
                  key={repo}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-[#1a1a1a]"
                >
                  <input
                    type="checkbox"
                    checked={filters.repos.length === 0 || filters.repos.includes(repo)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        // If adding this repo
                        if (filters.repos.length === 0) {
                          // All repos were selected, now select just this one
                          // Actually, keep it simple - when checking, if currently empty, select all except unchecked ones
                          // For now, just use empty = all
                        }
                        onFilterChange("repos", [
                          ...filters.repos.filter((r) => r !== repo),
                          repo,
                        ]);
                      } else {
                        // If removing this repo
                        const newRepos = filters.repos.filter((r) => r !== repo);
                        // If no filters.repos, it means all were selected, so we need to select all except this one
                        if (filters.repos.length === 0) {
                          onFilterChange("repos", availableRepos.filter((r) => r !== repo));
                        } else {
                          onFilterChange("repos", newRepos);
                        }
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-[#262626] bg-[#1a1a1a] text-[#8b5cf6]"
                  />
                  <span className="text-sm text-[#a1a1a1]">
                    {repo.split("/")[1] || repo}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Labels */}
        {availableLabels.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#808080]">
              Labels (include any)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {availableLabels.slice(0, 10).map((label) => (
                <button
                  key={label}
                  onClick={() => {
                    const isSelected = filters.labels.includes(label);
                    onFilterChange(
                      "labels",
                      isSelected
                        ? filters.labels.filter((l) => l !== label)
                        : [...filters.labels, label]
                    );
                  }}
                  className={`rounded px-2 py-0.5 text-xs transition-colors ${
                    filters.labels.includes(label)
                      ? "bg-[#8b5cf6] text-white"
                      : "bg-[#262626] text-[#a1a1a1] hover:bg-[#333]"
                  }`}
                >
                  {label}
                </button>
              ))}
              {availableLabels.length > 10 && (
                <span className="px-2 py-0.5 text-xs text-[#606060]">
                  +{availableLabels.length - 10} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
