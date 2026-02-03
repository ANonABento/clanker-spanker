import type { PR } from "./types";

export interface PRFilters {
  // Repo filter
  repos: string[];           // Empty = all repos

  // State filters
  state: "all" | "open" | "merged" | "closed";
  includeDrafts: boolean;

  // Review & CI
  reviewStatus: "all" | "pending" | "approved" | "changes_requested";
  ciStatus: "all" | "pending" | "passing" | "failing";

  // Search
  search: string;            // Matches title, number, branch
  author: string;            // Filter by author username

  // Labels
  labels: string[];          // Include PRs with ANY of these labels
  excludeLabels: string[];   // Exclude PRs with ANY of these labels
}

export const DEFAULT_FILTERS: PRFilters = {
  repos: [],
  state: "all",
  includeDrafts: true,
  reviewStatus: "all",
  ciStatus: "all",
  search: "",
  author: "",
  labels: [],
  excludeLabels: [],
};

/**
 * Filter PRs based on filter criteria
 */
export function filterPRs(prs: PR[], filters: PRFilters): PR[] {
  return prs.filter((pr) => {
    // Repo filter
    if (filters.repos.length > 0 && !filters.repos.includes(pr.repo)) {
      return false;
    }

    // State filter
    if (filters.state !== "all" && pr.state !== filters.state) {
      return false;
    }

    // Draft filter
    if (!filters.includeDrafts && pr.isDraft) {
      return false;
    }

    // Review status
    if (filters.reviewStatus !== "all" && pr.reviewStatus !== filters.reviewStatus) {
      return false;
    }

    // CI status
    if (filters.ciStatus !== "all") {
      if (!pr.ciStatus || pr.ciStatus !== filters.ciStatus) {
        return false;
      }
    }

    // Search (title, number, branch)
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesTitle = pr.title.toLowerCase().includes(searchLower);
      const matchesNumber = pr.number.toString().includes(filters.search);
      const matchesBranch = pr.branch.toLowerCase().includes(searchLower);
      if (!matchesTitle && !matchesNumber && !matchesBranch) {
        return false;
      }
    }

    // Author
    if (filters.author && pr.author.toLowerCase() !== filters.author.toLowerCase()) {
      return false;
    }

    // Labels (include)
    if (filters.labels.length > 0) {
      const hasLabel = filters.labels.some((l) => pr.labels.includes(l));
      if (!hasLabel) return false;
    }

    // Labels (exclude)
    if (filters.excludeLabels.length > 0) {
      const hasExcluded = filters.excludeLabels.some((l) => pr.labels.includes(l));
      if (hasExcluded) return false;
    }

    return true;
  });
}

/**
 * Check if any filters are active (different from defaults)
 */
export function hasActiveFilters(filters: PRFilters): boolean {
  return (
    filters.repos.length > 0 ||
    filters.state !== "all" ||
    !filters.includeDrafts ||
    filters.reviewStatus !== "all" ||
    filters.ciStatus !== "all" ||
    filters.search !== "" ||
    filters.author !== "" ||
    filters.labels.length > 0 ||
    filters.excludeLabels.length > 0
  );
}

/**
 * Collect all unique labels from PRs
 */
export function collectLabels(prs: PR[]): string[] {
  const labelSet = new Set<string>();
  for (const pr of prs) {
    for (const label of pr.labels) {
      labelSet.add(label);
    }
  }
  return Array.from(labelSet).sort();
}

/**
 * Collect all unique authors from PRs
 */
export function collectAuthors(prs: PR[]): string[] {
  const authorSet = new Set<string>();
  for (const pr of prs) {
    authorSet.add(pr.author);
  }
  return Array.from(authorSet).sort();
}
