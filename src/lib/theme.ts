export type Theme = "dark" | "light";

export const THEMES = {
  dark: "dark",
  light: "light",
} as const;

export const DEFAULT_THEME: Theme = "dark";

/**
 * Apply theme to the document root element
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  if (theme === "light") {
    root.classList.add("light");
    root.classList.remove("dark");
  } else {
    root.classList.add("dark");
    root.classList.remove("light");
  }

  // Update color-scheme for native elements
  root.style.colorScheme = theme;
}

/**
 * Get system preferred theme
 */
export function getSystemTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;

  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * Check if a string is a valid theme
 */
export function isValidTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}
