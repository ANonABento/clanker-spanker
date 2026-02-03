import { useState, useEffect, useCallback } from "react";
import { getRepos, addRepo, removeRepo, getSelectedRepo, setSelectedRepo } from "@/lib/tauri";

interface UseReposReturn {
  repos: string[];
  currentRepo: string;
  isLoading: boolean;
  addRepo: (repo: string) => Promise<string>;
  removeRepo: (repo: string) => Promise<void>;
  setCurrentRepo: (repo: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useRepos(): UseReposReturn {
  const [repos, setRepos] = useState<string[]>([]);
  const [currentRepo, setCurrentRepoState] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  const loadRepos = useCallback(async () => {
    try {
      const [repoList, current] = await Promise.all([
        getRepos(),
        getSelectedRepo().catch(() => ""),
      ]);
      setRepos(repoList);
      setCurrentRepoState(current);
    } catch (err) {
      console.error("Failed to load repos:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  const handleAddRepo = useCallback(async (repo: string): Promise<string> => {
    const trimmed = repo.trim();
    if (!trimmed) throw new Error("Repository cannot be empty");

    // Parse GitHub URL or owner/repo format
    let repoPath = trimmed;

    // Handle full GitHub URLs: https://github.com/owner/repo or github.com/owner/repo
    const urlMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+\/[^/]+)/i);
    if (urlMatch) {
      repoPath = urlMatch[1].replace(/\.git$/, ""); // Remove .git suffix if present
    }

    // Also handle trailing slashes or extra path segments
    repoPath = repoPath.split("/").slice(0, 2).join("/");

    // Validate format: owner/repo
    if (!/^[\w.-]+\/[\w.-]+$/.test(repoPath)) {
      throw new Error("Invalid format. Use owner/repo or paste a GitHub URL");
    }

    await addRepo(repoPath);
    setRepos((prev) => (prev.includes(repoPath) ? prev : [...prev, repoPath]));

    return repoPath; // Return the parsed repo path
  }, []);

  const handleRemoveRepo = useCallback(async (repo: string) => {
    await removeRepo(repo);
    setRepos((prev) => prev.filter((r) => r !== repo));

    // If removing the current repo, clear it
    setCurrentRepoState((current) => (current === repo ? "" : current));
  }, []);

  const handleSetCurrentRepo = useCallback(async (repo: string) => {
    await setSelectedRepo(repo);
    setCurrentRepoState(repo);
  }, []);

  return {
    repos,
    currentRepo,
    isLoading,
    addRepo: handleAddRepo,
    removeRepo: handleRemoveRepo,
    setCurrentRepo: handleSetCurrentRepo,
    refresh: loadRepos,
  };
}
