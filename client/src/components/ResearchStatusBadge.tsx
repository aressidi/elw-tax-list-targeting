import type { ResearchStatus } from '../types';

const COLORS: Record<ResearchStatus, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  needs_review: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  skipped: 'bg-gray-100 text-gray-500',
  failed: 'bg-red-100 text-red-700',
};

const LABELS: Record<ResearchStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  needs_review: 'Needs Review',
  completed: 'Completed',
  skipped: 'Skipped',
  failed: 'Failed',
};

export default function ResearchStatusBadge({ status }: { status: ResearchStatus | null | undefined }) {
  const key = status ?? 'not_started';
  return (
    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${COLORS[key]}`}>
      {LABELS[key]}
    </span>
  );
}
