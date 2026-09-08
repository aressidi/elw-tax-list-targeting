import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Building2, Loader2, SkipForward, Sparkles } from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type { ResearchQueueEntry, ResearchStatus, StateWithCounts, TargetPriority } from '../types';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import PriorityBadge from '../components/PriorityBadge';
import ResearchStatusBadge from '../components/ResearchStatusBadge';
import ResearchReviewPanel from '../components/ResearchReviewPanel';
import { useToast } from '../components/Toast';

const RESEARCH_STATUSES: ResearchStatus[] = [
  'not_started',
  'in_progress',
  'needs_review',
  'completed',
  'skipped',
  'failed',
];

export default function ResearchQueue() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [stateFilter, setStateFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TargetPriority | ''>('');
  const [statusFilter, setStatusFilter] = useState<ResearchStatus | ''>('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pendingCountyId, setPendingCountyId] = useState<number | null>(null);
  const [reviewingCounty, setReviewingCounty] = useState<ResearchQueueEntry | null>(null);

  const { data: states } = useQuery({
    queryKey: ['states'],
    queryFn: async () => (await apiGet<StateWithCounts[]>('/api/states')).data ?? [],
  });

  const queryKey = ['research-queue', stateFilter, priorityFilter, statusFilter] as const;

  const { data: queue, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '200' });
      if (stateFilter) params.set('state', stateFilter);
      if (priorityFilter) params.set('targetPriority', priorityFilter);
      if (statusFilter) params.set('researchStatus', statusFilter);
      return (await apiGet<ResearchQueueEntry[]>(`/api/research-queue?${params.toString()}`)).data ?? [];
    },
  });

  const invalidateQueue = () => {
    queryClient.invalidateQueries({ queryKey: ['research-queue'] });
    queryClient.invalidateQueries({ queryKey: ['counties'] });
    queryClient.invalidateQueries({ queryKey: ['states'] });
  };

  const triggerResearch = useMutation({
    mutationFn: (countyId: number) =>
      apiSend(`/api/counties/${countyId}/research`, 'POST', { provider: 'mock' }),
    onMutate: (countyId) => setPendingCountyId(countyId),
    onSuccess: (_result, countyId) => {
      invalidateQueue();
      const entry = queue?.find((c) => c.id === countyId);
      if (entry) setReviewingCounty(entry);
      toast.showSuccess('Research complete. Opening review...');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to trigger research.');
    },
    onSettled: () => setPendingCountyId(null),
  });

  const bulkAction = useMutation({
    mutationFn: (payload: { countyIds: number[]; action: 'research' | 'skip' }) =>
      apiSend('/api/research/bulk', 'POST', {
        countyIds: payload.countyIds,
        action: payload.action,
        provider: payload.action === 'research' ? 'mock' : undefined,
      }),
    onSuccess: (_result, payload) => {
      invalidateQueue();
      setSelected(new Set());
      toast.showSuccess(
        payload.action === 'skip'
          ? `Marked ${payload.countyIds.length} counties as skipped.`
          : `Requested research for ${payload.countyIds.length} counties.`
      );
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Bulk action failed.');
    },
  });

  const allSelected = useMemo(
    () => !!queue && queue.length > 0 && queue.every((c) => selected.has(c.id)),
    [queue, selected]
  );

  const toggleAll = () => {
    if (!queue) return;
    setSelected(allSelected ? new Set() : new Set(queue.map((c) => c.id)));
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Research Queue</h2>
          <p className="text-sm text-gray-500 mt-1">
            Find and review tax collector / treasurer contacts before saving them.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          aria-label="Filter by state"
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All states</option>
          {states?.map((s) => (
            <option key={s.id} value={s.abbreviation}>
              {s.name}
            </option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as TargetPriority | '')}
          aria-label="Filter by target priority"
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ResearchStatus | '')}
          aria-label="Filter by research status"
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All research statuses</option>
          {RESEARCH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm">
          <span className="font-medium text-blue-800">{selected.size} selected</span>
          <button
            onClick={() => bulkAction.mutate({ countyIds: Array.from(selected), action: 'research' })}
            disabled={bulkAction.isPending}
            className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 font-medium disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Research Selected
          </button>
          <button
            onClick={() => bulkAction.mutate({ countyIds: Array.from(selected), action: 'skip' })}
            disabled={bulkAction.isPending}
            className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 font-medium disabled:opacity-50"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Mark Skipped
          </button>
        </div>
      )}

      {isLoading && <LoadingState label="Loading research queue..." />}
      {isError && <ErrorState message="Failed to load the research queue." onRetry={() => refetch()} />}

      {!isLoading && !isError && (!queue || queue.length === 0) && (
        <EmptyState
          title="No counties match these filters"
          description="Adjust the filters above, or add counties from the States & Counties view."
        />
      )}

      {!isLoading && !isError && queue && queue.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="w-8 py-3 px-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all counties"
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">County</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">State</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Priority</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Contacts</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Research Status</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((entry) => (
                <tr key={entry.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-2">
                    <input
                      type="checkbox"
                      checked={selected.has(entry.id)}
                      onChange={() => toggleOne(entry.id)}
                      aria-label={`Select ${entry.name} County`}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <Link href={`/counties/${entry.id}`} className="flex items-center gap-2 hover:text-blue-700">
                      <Building2 className="w-4 h-4 text-gray-400" />
                      <span className="font-medium text-gray-900">{entry.name}</span>
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-gray-600">
                    {entry.state.name} ({entry.state.abbreviation})
                  </td>
                  <td className="py-3 px-4">
                    <PriorityBadge priority={entry.targetPriority} />
                  </td>
                  <td className="py-3 px-4 text-gray-600">{entry.contactCount}</td>
                  <td className="py-3 px-4">
                    <ResearchStatusBadge status={entry.researchStatus} />
                    {entry.latestResearchRun?.isDemo && (
                      <span className="ml-2 text-xs text-amber-600">demo</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => triggerResearch.mutate(entry.id)}
                        disabled={pendingCountyId === entry.id}
                        className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        {pendingCountyId === entry.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        Research
                      </button>
                      <button
                        onClick={() => setReviewingCounty(entry)}
                        className="text-sm font-medium text-gray-700 hover:text-gray-900"
                      >
                        Review
                      </button>
                      <button
                        onClick={() => bulkAction.mutate({ countyIds: [entry.id], action: 'skip' })}
                        disabled={bulkAction.isPending}
                        className="text-sm font-medium text-gray-500 hover:text-gray-800 disabled:opacity-50"
                      >
                        Skip
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reviewingCounty && (
        <ResearchReviewPanel
          county={{ id: reviewingCounty.id, name: reviewingCounty.name, state: reviewingCounty.state }}
          onClose={() => setReviewingCounty(null)}
        />
      )}
    </div>
  );
}
