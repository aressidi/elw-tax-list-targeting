import type { TargetPriority } from '../types';

const COLORS: Record<TargetPriority, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
};

export default function PriorityBadge({ priority }: { priority: TargetPriority | null | undefined }) {
  if (!priority) {
    return (
      <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-500">
        Not set
      </span>
    );
  }

  return (
    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full capitalize ${COLORS[priority]}`}>
      {priority}
    </span>
  );
}
