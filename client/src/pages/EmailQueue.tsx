import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Mail, Pause, Play, XCircle } from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import { useToast } from '../components/Toast';
import type { EmailQueueEntry, EmailQueueStatus } from '../types';

function StatTile({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'danger' }) {
  return (
    <div className="border rounded-lg p-3 bg-white">
      <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
      <p className={`text-2xl font-bold ${tone === 'danger' ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

export default function EmailQueue() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [limitInput, setLimitInput] = useState('');

  const statusQuery = useQuery({
    queryKey: ['email-queue', 'status'],
    queryFn: async () => (await apiGet<EmailQueueStatus>('/api/email-queue/status')).data ?? null,
    refetchInterval: 15_000,
  });

  const itemsQuery = useQuery({
    queryKey: ['email-queue', 'items'],
    queryFn: async () => (await apiGet<EmailQueueEntry[]>('/api/email-queue')).data ?? [],
    refetchInterval: 15_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['email-queue'] });

  const togglePause = useMutation({
    mutationFn: async () => apiSend(`/api/email-queue/${statusQuery.data?.paused ? 'resume' : 'pause'}`, 'POST', {}),
    onSuccess: invalidate,
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to update queue state.');
    },
  });

  const saveLimit = useMutation({
    mutationFn: async (dailyLimit: number) => apiSend('/api/email-queue/settings', 'PATCH', { dailyLimit }),
    onSuccess: () => {
      toast.showSuccess('Daily limit updated.');
      invalidate();
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to update daily limit.');
    },
  });

  const cancelItem = useMutation({
    mutationFn: async (id: number) => apiSend(`/api/email-queue/${id}/cancel`, 'POST', {}),
    onSuccess: invalidate,
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to cancel this item.');
    },
  });

  if (statusQuery.isLoading || itemsQuery.isLoading) return <LoadingState label="Loading email queue..." />;
  if (statusQuery.isError || itemsQuery.isError) {
    return (
      <ErrorState
        message="Failed to load the email queue."
        onRetry={() => {
          statusQuery.refetch();
          itemsQuery.refetch();
        }}
      />
    );
  }

  const status = statusQuery.data;
  const items = itemsQuery.data ?? [];
  const now = Date.now();

  const handleSaveLimit = () => {
    const parsed = parseInt(limitInput, 10);
    if (isNaN(parsed) || parsed < 20 || parsed > 50) {
      toast.showError('Daily limit must be a whole number between 20 and 50.');
      return;
    }
    saveLimit.mutate(parsed);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Email Queue</h2>
          <p className="text-sm text-gray-500 mt-1">
            Throttled, scheduled FOIA email sending. The processor checks for due items about once a minute.
          </p>
        </div>
        {status && (
          <button
            onClick={() => togglePause.mutate()}
            disabled={togglePause.isPending}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${
              status.paused ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-amber-600 text-white hover:bg-amber-700'
            }`}
          >
            {status.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {status.paused ? 'Resume Sending' : 'Pause Sending'}
          </button>
        )}
      </div>

      {status?.paused && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Pause className="w-4 h-4 shrink-0" />
          Sending is paused. Queued items are safe and will go out once resumed.
        </div>
      )}

      {status && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile label="Sent Today" value={status.sentToday} />
          <StatTile label="Real Sends Today" value={status.realSentToday} />
          <StatTile label="Daily Limit" value={status.dailyLimit} />
          <StatTile label="Pending" value={status.pending} />
          <StatTile label="Scheduled" value={status.scheduled} />
          <StatTile label="Failed Today" value={status.failedToday} tone={status.failedToday > 0 ? 'danger' : 'default'} />
        </div>
      )}

      <div className="border rounded-lg p-4 bg-gray-50 flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium text-gray-700">Daily send limit (20-50)</label>
        <input
          type="number"
          min={20}
          max={50}
          placeholder={status ? String(status.dailyLimit) : '20'}
          value={limitInput}
          onChange={(e) => setLimitInput(e.target.value)}
          className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSaveLimit}
          disabled={saveLimit.isPending || !limitInput}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
        >
          Save
        </button>
        <span className="text-xs text-gray-500">
          Applies across manual, bulk, and scheduled sends. Dry-run sends don't count toward this limit.
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Queue is empty"
          description="Add requests to the queue from List Requests or Email Campaigns."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium text-gray-700">Request</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">County</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Recipient</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Send At</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const due = !item.sendAt || new Date(item.sendAt).getTime() <= now;
                return (
                  <tr key={item.id} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-600">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-gray-400" />
                        #{item.listRequestId}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-900 font-medium">
                      {item.listRequest.taxOfficial.county.name}, {item.listRequest.taxOfficial.county.state.abbreviation}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {item.listRequest.taxOfficial.emailAddress ?? (
                        <span className="text-red-600">No email on file</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500">
                      {item.sendAt ? (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(item.sendAt).toLocaleString()}
                        </span>
                      ) : (
                        <span className={due ? 'text-green-700' : 'text-gray-400'}>As soon as possible</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {item.status === 'queued' && (
                        <button
                          onClick={() => cancelItem.mutate(item.id)}
                          disabled={cancelItem.isPending}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
