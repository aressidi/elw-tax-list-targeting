import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Info } from 'lucide-react';
import { apiGet } from '../lib/api';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import BulkSendEmailDialog from '../components/BulkSendEmailDialog';

interface CampaignRow {
  id: number;
  requestStatus: string;
  emailSentAt: string | null;
  taxOfficial: {
    fullName: string;
    emailAddress: string | null;
    isPrimary: boolean | null;
    county: {
      name: string;
      state: { abbreviation: string; name: string };
    };
  };
}

// Requests in these statuses have never had a FOIA email land — everything
// else has either already been sent or moved past the point where sending
// again unprompted makes sense.
const SENDABLE_STATUSES = new Set(['not_started', 'research_needed', 'ready_to_email']);

export default function EmailCampaigns() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkSend, setShowBulkSend] = useState(false);

  const { data: requests, isLoading, isError, refetch } = useQuery({
    queryKey: ['list-requests', 'campaigns'],
    queryFn: async () => (await apiGet<CampaignRow[]>('/api/list-requests?limit=100')).data ?? [],
  });

  const sendable = useMemo(
    () => (requests ?? []).filter((r) => !r.emailSentAt && SENDABLE_STATUSES.has(r.requestStatus)),
    [requests]
  );

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(sendable.map((r) => r.id)));
  const clearSelection = () => setSelectedIds(new Set());
  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);

  if (isLoading) return <LoadingState label="Loading requests ready to email..." />;
  if (isError) return <ErrorState message="Failed to load list requests." onRetry={() => refetch()} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Email Campaigns</h2>
          <p className="text-sm text-gray-500 mt-1">
            Bulk-send FOIA request emails to counties that haven't been contacted yet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={selectAll}
            disabled={sendable.length === 0}
            className="text-sm font-medium text-blue-700 hover:text-blue-900 px-3 py-2 rounded-lg hover:bg-blue-50 disabled:opacity-50"
          >
            Select all ({sendable.length})
          </button>
          {selectedIdList.length > 0 && (
            <>
              <button
                onClick={clearSelection}
                className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100"
              >
                Clear
              </button>
              <button
                onClick={() => setShowBulkSend(true)}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <Send className="w-4 h-4" />
                Send Selected ({selectedIdList.length})
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-6">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Every send is dry-run (rendered and tracked, no real email) unless the server has
          <code className="mx-1 px-1 bg-white rounded">EMAIL_TRANSPORT=gog</code>
          set after human sign-off. The confirmation dialog always shows which transport will be used.
        </span>
      </div>

      {sendable.length === 0 ? (
        <EmptyState
          title="Nothing to send right now"
          description="Every list request has already been emailed, or none are far enough along to send yet."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 w-8"></th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">ID</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">County</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Contact on File</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {sendable.map((request) => (
                <tr key={request.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(request.id)}
                      onChange={() => toggleSelected(request.id)}
                      aria-label={`Select request #${request.id}`}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="py-3 px-4 text-gray-600">#{request.id}</td>
                  <td className="py-3 px-4 text-gray-900 font-medium">
                    {request.taxOfficial.county.name}, {request.taxOfficial.county.state.abbreviation}
                  </td>
                  <td className="py-3 px-4 text-gray-600">
                    {request.taxOfficial.emailAddress ?? (
                      <span className="text-red-600">No email on file</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                      {request.requestStatus.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showBulkSend && (
        <BulkSendEmailDialog
          requestIds={selectedIdList}
          onClose={() => setShowBulkSend(false)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['list-requests'] });
            clearSelection();
          }}
        />
      )}
    </div>
  );
}
