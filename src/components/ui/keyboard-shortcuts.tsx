import { useEffect } from "react";
import { X } from "lucide-react";

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { key: "j", description: "Next card" },
  { key: "k", description: "Previous card" },
  { key: "Enter", description: "Open PR in browser" },
  { key: "m", description: "Toggle monitor" },
  { key: "r", description: "Refresh PRs" },
  { key: "?", description: "Show this help" },
  { key: "Esc", description: "Clear focus / Close" },
];

export function KeyboardShortcuts({ isOpen, onClose }: KeyboardShortcutsProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-surface border border-border rounded-lg w-full max-w-sm p-6 shadow-lg animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-text-secondary" />
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="space-y-2">
          {shortcuts.map(({ key, description }) => (
            <div
              key={key}
              className="flex items-center justify-between py-1.5"
            >
              <span className="text-sm text-text-secondary">{description}</span>
              <kbd className="px-2.5 py-1 text-xs font-mono bg-surface-secondary border border-border rounded text-text-primary">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
