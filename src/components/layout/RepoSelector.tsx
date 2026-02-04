import { useState, useEffect, useCallback } from "react";
import { GitBranch } from "lucide-react";
import { getSelectedRepo, setSelectedRepo } from "@/lib/tauri";

interface RepoSelectorProps {
  selectedRepo: string;
  onRepoChange: (repo: string) => void;
}

export function RepoSelector({ selectedRepo, onRepoChange }: RepoSelectorProps) {
  const [inputValue, setInputValue] = useState(selectedRepo);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setInputValue(selectedRepo);
  }, [selectedRepo]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedValue = inputValue.trim();

      // Save to backend
      try {
        await setSelectedRepo(trimmedValue);
        onRepoChange(trimmedValue);
        setIsEditing(false);
      } catch (err) {
        console.error("Failed to save repo:", err);
      }
    },
    [inputValue, onRepoChange]
  );

  const handleBlur = useCallback(() => {
    // Reset to saved value on blur without saving
    setInputValue(selectedRepo);
    setIsEditing(false);
  }, [selectedRepo]);

  if (isEditing) {
    return (
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-[#606060]" />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleBlur}
          placeholder="owner/repo"
          autoFocus
          className="h-7 w-48 rounded border border-[#3a3a3a] bg-[#1a1a1a] px-2 text-sm text-[#c0c0c0] placeholder:text-[#505050] focus:border-[#505050] focus:outline-none"
        />
      </form>
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className="flex items-center gap-2 rounded px-2 py-1 text-sm text-[#808080] transition-colors hover:bg-[#1a1a1a] hover:text-[#c0c0c0]"
    >
      <GitBranch className="h-4 w-4 text-[#606060]" />
      <span className="max-w-[200px] truncate">
        {selectedRepo || "Select repository..."}
      </span>
    </button>
  );
}

// Hook to load and manage selected repo
export function useSelectedRepo() {
  const [selectedRepo, setSelectedRepoState] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSelectedRepo() {
      try {
        const repo = await getSelectedRepo();
        setSelectedRepoState(repo || "");
      } catch (err) {
        console.error("Failed to load selected repo:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadSelectedRepo();
  }, []);

  const handleRepoChange = useCallback((repo: string) => {
    setSelectedRepoState(repo);
  }, []);

  return { selectedRepo, isLoading, onRepoChange: handleRepoChange };
}
