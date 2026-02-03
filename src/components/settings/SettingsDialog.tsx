import { useEffect } from "react";
import { X, Sun, Moon, Power, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAutostart } from "@/hooks/useAutostart";
import type { Theme } from "@/lib/theme";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export function SettingsDialog({
  isOpen,
  onClose,
  theme,
  onThemeChange,
}: SettingsDialogProps) {
  const { isAutoStartEnabled, isLoading: isAutoStartLoading, toggleAutoStart } = useAutostart();
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
      <div className="relative bg-surface border border-border rounded-lg w-full max-w-md p-6 shadow-lg animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label="Close settings"
          >
            <X className="h-5 w-5 text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6">
          {/* Appearance Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Appearance
            </h3>
            <div className="flex gap-2">
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                size="sm"
                onClick={() => onThemeChange("dark")}
                className="flex-1"
              >
                <Moon className="h-4 w-4 mr-2" />
                Dark
              </Button>
              <Button
                variant={theme === "light" ? "default" : "outline"}
                size="sm"
                onClick={() => onThemeChange("light")}
                className="flex-1"
              >
                <Sun className="h-4 w-4 mr-2" />
                Light
              </Button>
            </div>
          </section>

          {/* Startup Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Startup
            </h3>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary border border-border">
              <div className="flex items-center gap-3">
                <Power className="h-4 w-4 text-text-secondary" />
                <div>
                  <p className="text-sm text-text-primary">Start on login</p>
                  <p className="text-xs text-text-tertiary">
                    Launch automatically when you log in
                  </p>
                </div>
              </div>
              <Button
                variant={isAutoStartEnabled ? "default" : "outline"}
                size="sm"
                onClick={toggleAutoStart}
                disabled={isAutoStartLoading}
              >
                {isAutoStartEnabled ? "Enabled" : "Disabled"}
              </Button>
            </div>
          </section>

          {/* Shortcuts Section */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Keyboard Shortcuts
            </h3>
            <div className="p-3 rounded-lg bg-surface-secondary border border-border">
              <div className="flex items-center gap-3">
                <Keyboard className="h-4 w-4 text-text-secondary" />
                <div>
                  <p className="text-sm text-text-primary">Global toggle</p>
                  <p className="text-xs text-text-tertiary">
                    Show/hide window from anywhere
                  </p>
                </div>
                <kbd className="ml-auto px-2 py-1 text-xs font-mono bg-surface border border-border rounded">
                  Cmd+Shift+P
                </kbd>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
