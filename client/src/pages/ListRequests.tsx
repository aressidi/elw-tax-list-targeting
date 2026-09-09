import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Clock, CheckCircle, XCircle, Send } from 'lucide-react';
import { apiGet } from '../lib/api';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import SendEmailDialog from '../components/SendEmailDialog';
import BulkSendEmailDialog from '../components/BulkSendEmailDialog';

interface ListRequestRow {
  id: number;
  requestStatus: string;
  listType: string;
  costAmount: string | null;
  emailSentAt: string | null;
  responseReceivedAt: string | null;
  assignedTo: string | null;
  createdAt: string;
  taxOfficial: {
    fullName: string;
    county: {
      name: string;
      state: {
        abbreviation: string;
      };
    };
  };
}

export default function ListRequests() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sendingRequest, setSendingRequest] = useState<ListRequestRow | null>(null);
  const [showBulkSend, setShowBulkSend] = useState(false);

  const { data: requests, isLoading, isError, refetch } = useQuery({
    queryKey: ['list-requests'],
    queryFn: async () => (await apiGet<ListRequestRow[]>('/api/list-requests?limit=100')).data ?? [],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['list-requests'] });
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllReady = () => {
    const readyIds = (requests ?? [])
      .filter((r) => r.requestStatus === 'ready_to_email' && !r.emailSentAt)
      .map((r) => r.id);
    setSelectedIds(new Set(readyIds));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);

  if (isLoading) return <LoadingState label="Loading list requests..." />;
  if (isError) return <ErrorState message="Failed to load list requests." onRetry={() => refetch()} />;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'list_provided':
      case 'fulfilled':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'not_available':
      case 'declined':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'list_provided':
        return 'bg-green-100 text-green-700';
      case 'email_sent':
      case 'awaiting_response':
        return 'bg-blue-100 text-blue-700';
      case 'not_available':
      case 'declined':
        return 'bg-red-100 text-red-700';
      case 'requires_payment':
        return 'bg-orange-100 text-orange-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-900">List Requests</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={selectAllReady}
            className="text-sm font-medium text-blue-700 hover:text-blue-900 px-3 py-2 rounded-lg hover:bg-blue-50"
          >
            Select all ready to email
          </button>
          {selectedIdList.length > 0 && (
            <>
              <button
                onClick={clearSelection}
                className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100"
              >
                Clear ({selectedIdList.length})
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

      {!requests || requests.length === 0 ? (
        <EmptyState title="No list requests yet" description="Create a list request from a county's detail page." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 w-8"></th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">ID</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Tax Official</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Location</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">List Type</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Cost</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Email</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700"></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
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
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span className="font-medium text-gray-900">
                        {request.taxOfficial.fullName}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-600">
                    {request.taxOfficial.county.name},{' '}
                    {request.taxOfficial.county.state.abbreviation}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(request.requestStatus)}
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                          request.requestStatus
                        )}`}
                      >
                        {request.requestStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="capitalize text-gray-600">{request.listType}</span>
                  </td>
                  <td className="py-3 px-4 text-gray-600">
                    {request.costAmount ? `$${request.costAmount}` : 'N/A'}
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-500">
                    {request.emailSentAt ? (
                      <span className="text-green-700">Sent {new Date(request.emailSentAt).toLocaleDateString()}</span>
                    ) : (
                      <span className="text-gray-400">Not sent</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setSendingRequest(request)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-900"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {request.emailSentAt ? 'Resend' : 'Send'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sendingRequest && (
        <SendEmailDialog
          listRequestId={sendingRequest.id}
          recipientLabel={`${sendingRequest.taxOfficial.county.name} County primary contact`}
          alreadySent={!!sendingRequest.emailSentAt}
          onClose={() => setSendingRequest(null)}
          onSent={invalidate}
        />
      )}

      {showBulkSend && (
        <BulkSendEmailDialog
          requestIds={selectedIdList}
          onClose={() => setShowBulkSend(false)}
          onDone={() => {
            invalidate();
            clearSelection();
          }}
        />
      )}
    </div>
  );
}
