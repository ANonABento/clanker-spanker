import { useState, useEffect, useCallback } from "react";
import { getSetting, setSetting } from "@/lib/tauri";
import {
  Theme,
  DEFAULT_THEME,
  applyTheme,
  isValidTheme,
} from "@/lib/theme";

const THEME_SETTING_KEY = "theme";

interface UseThemeReturn {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  isLoading: boolean;
}

export function useTheme(): UseThemeReturn {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [isLoading, setIsLoading] = useState(true);

  // Load theme from settings on mount
  useEffect(() => {
    async function loadTheme() {
      try {
        const savedTheme = await getSetting(THEME_SETTING_KEY);
        if (savedTheme && isValidTheme(savedTheme)) {
          setThemeState(savedTheme);
          applyTheme(savedTheme);
        } else {
          applyTheme(DEFAULT_THEME);
        }
      } catch (err) {
        console.error("Failed to load theme:", err);
        applyTheme(DEFAULT_THEME);
      } finally {
        setIsLoading(false);
      }
    }

    loadTheme();
  }, []);

  const setTheme = useCallback(async (newTheme: Theme) => {
    setThemeState(newTheme);
    applyTheme(newTheme);

    try {
      await setSetting(THEME_SETTING_KEY, newTheme);
    } catch (err) {
      console.error("Failed to save theme:", err);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme, isLoading };
}
