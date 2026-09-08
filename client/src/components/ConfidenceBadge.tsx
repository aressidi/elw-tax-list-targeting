import type { ConfidenceLevel } from '../types';

const COLORS: Record<ConfidenceLevel, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
};

export default function ConfidenceBadge({ confidence }: { confidence: ConfidenceLevel | null | undefined }) {
  if (!confidence) return null;

  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full capitalize ${COLORS[confidence]}`}>
      {confidence} confidence
    </span>
  );
}
