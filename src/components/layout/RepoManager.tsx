import { useState, useCallback, useRef, useEffect } from "react";
import { GitBranch, Plus, X, Check, ChevronDown } from "lucide-react";
import { useRepos } from "@/hooks/useRepos";

interface RepoManagerProps {
  onRepoChange?: (repo: string) => void;
}

export function RepoManager({ onRepoChange }: RepoManagerProps) {
  const { repos, currentRepo, isLoading, addRepo, removeRepo, setCurrentRepo } = useRepos();
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newRepoInput, setNewRepoInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsAdding(false);
        setNewRepoInput("");
        setError(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus input when adding
  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  const handleSelectRepo = useCallback(
    async (repo: string) => {
      await setCurrentRepo(repo);
      onRepoChange?.(repo);
      setIsOpen(false);
    },
    [setCurrentRepo, onRepoChange]
  );

  const handleAddRepo = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      try {
        // addRepo returns the parsed repo path (owner/repo format)
        const parsedRepo = await addRepo(newRepoInput);
        // Auto-select newly added repo using the parsed value
        await setCurrentRepo(parsedRepo);
        onRepoChange?.(parsedRepo);
        setNewRepoInput("");
        setIsAdding(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add repo");
      }
    },
    [addRepo, newRepoInput, setCurrentRepo, onRepoChange]
  );

  const handleRemoveRepo = useCallback(
    async (e: React.MouseEvent, repo: string) => {
      e.stopPropagation();
      await removeRepo(repo);
      if (repo === currentRepo) {
        onRepoChange?.("");
      }
    },
    [removeRepo, currentRepo, onRepoChange]
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm text-[#606060]">
        <GitBranch className="h-4 w-4" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded px-2 py-1 text-sm text-[#808080] transition-colors hover:bg-[#1a1a1a] hover:text-[#c0c0c0]"
      >
        <GitBranch className="h-4 w-4 text-[#606060]" />
        <span className="max-w-[200px] truncate">
          {currentRepo || "Select repository..."}
        </span>
        <ChevronDown className="h-3 w-3 text-[#606060]" />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-[#262626] bg-[#141414] py-1 shadow-lg">
          {/* Repo list */}
          {repos.length > 0 && (
            <div className="max-h-48 overflow-y-auto">
              {repos.map((repo) => (
                <div
                  key={repo}
                  onClick={() => handleSelectRepo(repo)}
                  className="flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-[#1a1a1a]"
                >
                  <div className="flex items-center gap-2">
                    {repo === currentRepo ? (
                      <Check className="h-4 w-4 text-[#8b5cf6]" />
                    ) : (
                      <div className="h-4 w-4" />
                    )}
                    <span
                      className={`text-sm ${
                        repo === currentRepo ? "text-[#fafafa]" : "text-[#a1a1a1]"
                      }`}
                    >
                      {repo}
                    </span>
                  </div>
                  <button
                    onClick={(e) => handleRemoveRepo(e, repo)}
                    className="rounded p-1 text-[#606060] hover:bg-[#262626] hover:text-[#ef4444]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {repos.length === 0 && !isAdding && (
            <div className="px-3 py-4 text-center text-sm text-[#606060]">
              No repositories configured
            </div>
          )}

          {/* Divider */}
          {repos.length > 0 && <div className="my-1 border-t border-[#262626]" />}

          {/* Add repo input */}
          {isAdding ? (
            <form onSubmit={handleAddRepo} className="px-3 py-2">
              <input
                ref={inputRef}
                type="text"
                value={newRepoInput}
                onChange={(e) => setNewRepoInput(e.target.value)}
                placeholder="owner/repo or GitHub URL"
                className="w-full rounded border border-[#3a3a3a] bg-[#1a1a1a] px-2 py-1.5 text-sm text-[#c0c0c0] placeholder:text-[#505050] focus:border-[#505050] focus:outline-none"
              />
              {error && <p className="mt-1 text-xs text-[#ef4444]">{error}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAdding(false);
                    setNewRepoInput("");
                    setError(null);
                  }}
                  className="rounded px-2 py-1 text-xs text-[#808080] hover:bg-[#262626]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-[#8b5cf6] px-2 py-1 text-xs text-white hover:bg-[#a78bfa]"
                >
                  Add
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#808080] hover:bg-[#1a1a1a] hover:text-[#c0c0c0]"
            >
              <Plus className="h-4 w-4" />
              Add repository
            </button>
          )}
        </div>
      )}
    </div>
  );
}
