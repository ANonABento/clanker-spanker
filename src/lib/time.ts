/**
 * Time formatting utilities using native Intl APIs
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Format a date as relative time (e.g., "2 hours ago", "just now")
 */
export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return "";

  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const absDiff = Math.abs(diffMs);
    const isPast = diffMs > 0;

    // Less than a minute
    if (absDiff < MINUTE) {
      return "just now";
    }

    // Use Intl.RelativeTimeFormat for localized formatting
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

    if (absDiff < HOUR) {
      const minutes = Math.floor(absDiff / MINUTE);
      return rtf.format(isPast ? -minutes : minutes, "minute");
    }

    if (absDiff < DAY) {
      const hours = Math.floor(absDiff / HOUR);
      return rtf.format(isPast ? -hours : hours, "hour");
    }

    if (absDiff < WEEK) {
      const days = Math.floor(absDiff / DAY);
      return rtf.format(isPast ? -days : days, "day");
    }

    if (absDiff < MONTH) {
      const weeks = Math.floor(absDiff / WEEK);
      return rtf.format(isPast ? -weeks : weeks, "week");
    }

    if (absDiff < YEAR) {
      const months = Math.floor(absDiff / MONTH);
      return rtf.format(isPast ? -months : months, "month");
    }

    const years = Math.floor(absDiff / YEAR);
    return rtf.format(isPast ? -years : years, "year");
  } catch {
    return "";
  }
}

/**
 * Format a future date as countdown (e.g., "in 5 minutes", "in 2 hours")
 */
export function formatCountdown(dateString: string | null | undefined): string {
  if (!dateString) return "";

  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    // If in the past, show "now"
    if (diffMs <= 0) {
      return "now";
    }

    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

    if (diffMs < MINUTE) {
      const seconds = Math.ceil(diffMs / 1000);
      return rtf.format(seconds, "second");
    }

    if (diffMs < HOUR) {
      const minutes = Math.ceil(diffMs / MINUTE);
      return rtf.format(minutes, "minute");
    }

    if (diffMs < DAY) {
      const hours = Math.ceil(diffMs / HOUR);
      return rtf.format(hours, "hour");
    }

    const days = Math.ceil(diffMs / DAY);
    return rtf.format(days, "day");
  } catch {
    return "";
  }
}

/**
 * Format a duration in milliseconds to human-readable string (e.g., "5m 30s")
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return "0s";

  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / MINUTE) % 60;
  const hours = Math.floor(ms / HOUR) % 24;
  const days = Math.floor(ms / DAY);

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

/**
 * Format a date for display (e.g., "Feb 3, 2:30 PM")
 */
export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "";

  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "";
  }
}

/**
 * Format interval minutes as human readable (e.g., "5 minutes", "1 hour")
 */
export function formatInterval(minutes: number): string {
  if (minutes < 60) {
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format a Date object as relative time (e.g., "2 minutes ago", "just now")
 */
export function formatRelativeTimeFromDate(date: Date | null | undefined): string {
  if (!date) return "";

  try {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const absDiff = Math.abs(diffMs);
    const isPast = diffMs > 0;

    // Less than a minute
    if (absDiff < MINUTE) {
      return "just now";
    }

    // Use Intl.RelativeTimeFormat for localized formatting
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

    if (absDiff < HOUR) {
      const minutes = Math.floor(absDiff / MINUTE);
      return rtf.format(isPast ? -minutes : minutes, "minute");
    }

    if (absDiff < DAY) {
      const hours = Math.floor(absDiff / HOUR);
      return rtf.format(isPast ? -hours : hours, "hour");
    }

    const days = Math.floor(absDiff / DAY);
    return rtf.format(isPast ? -days : days, "day");
  } catch {
    return "";
  }
}
