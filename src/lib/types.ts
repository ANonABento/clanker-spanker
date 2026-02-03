export type PRState = "open" | "merged" | "closed";
export type CIStatus = "pending" | "passing" | "failing" | null;
export type ReviewStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "commented";
export type Column = "todo" | "monitoring" | "done";
export type MonitorStatus =
  | "running"
  | "sleeping"
  | "completed"
  | "failed"
  | "stopped";

export interface PR {
  id: string; // "owner/repo#123"
  number: number;
  title: string;
  url: string;
  author: string;
  repo: string; // "owner/repo"

  // Status
  state: PRState;
  isDraft: boolean;

  // CI
  ciStatus: CIStatus;
  ciUrl: string | null;

  // Reviews
  reviewStatus: ReviewStatus;
  reviewers: string[];

  // Comments
  commentsCount: number;
  unresolvedThreads: number;

  // Meta
  labels: string[];
  branch: string;
  baseBranch: string;
  createdAt: string;
  updatedAt: string;

  // Board
  column: Column;
}

export interface PRComment {
  id: string;
  threadId: string;
  prId: string;
  commentType: "review_thread" | "issue_comment";
  isResolved: boolean;
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Monitor {
  id: string;
  prId: string;

  // Process
  pid: number | null;
  status: MonitorStatus;

  // Progress
  iteration: number;
  maxIterations: number;
  intervalMinutes: number;

  // Timing
  startedAt: string;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  endedAt: string | null;

  // Results
  commentsFixed: number;
  exitReason: string | null;

  // Logs
  logFile: string;
}
