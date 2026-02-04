import { Inbox, Activity, CheckCircle2 } from "lucide-react";
import { Column } from "./Column";
import { PRCardSkeleton } from "./PRCardSkeleton";
import type { PR } from "@/lib/types";

interface BoardProps {
  prs: PR[];
  renderCard: (pr: PR, isFocused: boolean) => React.ReactNode;
  isLoading?: boolean;
  focusedIndex?: number | null;
  allPRsFlat?: PR[];
  hasRepo?: boolean;
}

type ColumnType = "todo" | "monitoring" | "done";

const emptyStateConfig: Record<ColumnType, {
  icon: typeof Inbox;
  title: string;
  description: string;
}> = {
  todo: {
    icon: Inbox,
    title: "No PRs to monitor",
    description: "Open PRs will appear here",
  },
  monitoring: {
    icon: Activity,
    title: "No active monitors",
    description: "Start monitoring a PR to see progress",
  },
  done: {
    icon: CheckCircle2,
    title: "No completed PRs",
    description: "Merged and closed PRs appear here",
  },
};

function LoadingSkeletons() {
  return (
    <>
      <PRCardSkeleton />
      <PRCardSkeleton />
      <PRCardSkeleton />
    </>
  );
}

export function Board({ prs, renderCard, isLoading, focusedIndex, allPRsFlat, hasRepo }: BoardProps) {
  const todoPRs = prs.filter((pr) => pr.column === "todo");
  const monitoringPRs = prs.filter((pr) => pr.column === "monitoring");
  const donePRs = prs.filter((pr) => pr.column === "done");

  // Determine which PR is focused based on the flat list index
  const focusedPRId = focusedIndex !== null && focusedIndex !== undefined && allPRsFlat
    ? allPRsFlat[focusedIndex]?.id
    : null;

  const renderWithFocus = (pr: PR) => renderCard(pr, pr.id === focusedPRId);

  // Show global empty state if no repo selected
  if (!isLoading && !hasRepo) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Inbox className="mx-auto h-12 w-12 text-[#404040] mb-4" />
          <h2 className="text-lg font-medium text-[#808080] mb-2">No repository selected</h2>
          <p className="text-sm text-[#505050] max-w-sm">
            Click "Select repository..." in the header to add a GitHub repo.
            You can paste a full URL or use owner/repo format.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-3 gap-4">
      <Column title="Todo" count={isLoading ? undefined : todoPRs.length}>
        {isLoading ? (
          <LoadingSkeletons />
        ) : todoPRs.length === 0 ? (
          <EmptyState column="todo" />
        ) : (
          todoPRs.map(renderWithFocus)
        )}
      </Column>

      <Column title="Monitoring" count={isLoading ? undefined : monitoringPRs.length}>
        {isLoading ? (
          <LoadingSkeletons />
        ) : monitoringPRs.length === 0 ? (
          <EmptyState column="monitoring" />
        ) : (
          monitoringPRs.map(renderWithFocus)
        )}
      </Column>

      <Column title="Done" count={isLoading ? undefined : donePRs.length}>
        {isLoading ? (
          <LoadingSkeletons />
        ) : donePRs.length === 0 ? (
          <EmptyState column="done" />
        ) : (
          donePRs.map(renderWithFocus)
        )}
      </Column>
    </div>
  );
}

function EmptyState({ column }: { column: ColumnType }) {
  const { icon: Icon, title, description } = emptyStateConfig[column];

  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <Icon className="h-8 w-8 text-[#404040] mb-2" />
      <p className="text-xs font-medium text-[#606060]">{title}</p>
      <p className="text-xs text-[#404040] mt-0.5">{description}</p>
    </div>
  );
}
