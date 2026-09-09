import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Link2, Paperclip, RefreshCw } from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import type { InboxClassification, InboxItem, InboxItemStatus, PollInboxResult } from '../types';

const CLASSIFICATION_LABELS: Record<InboxClassification, string> = {
  list_received: 'List Received',
  fee_quote: 'Fee Quote',
  fee_paid: 'Fee Paid',
  clarification: 'Clarification Needed',
  rejection: 'Rejected',
  other: 'Other',
};

const CLASSIFICATION_TONES: Record<InboxClassification, string> = {
  list_received: 'bg-green-100 text-green-800',
  fee_quote: 'bg-amber-100 text-amber-800',
  fee_paid: 'bg-green-100 text-green-800',
  clarification: 'bg-blue-100 text-blue-800',
  rejection: 'bg-red-100 text-red-800',
  other: 'bg-gray-100 text-gray-700',
};

const STATUS_TONES: Record<InboxItemStatus, string> = {
  unprocessed: 'bg-gray-100 text-gray-700',
  matched: 'bg-blue-100 text-blue-800',
  unmatched: 'bg-red-100 text-red-800',
  reviewed: 'bg-purple-100 text-purple-800',
  attached: 'bg-green-100 text-green-800',
};

function ClassificationBadge({ value }: { value: InboxClassification | null }) {
  if (!value) return <span className="text-xs text-gray-400">Unclassified</span>;
  return (
    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${CLASSIFICATION_TONES[value]}`}>
      {CLASSIFICATION_LABELS[value]}
    </span>
  );
}

function StatusBadge({ value }: { value: InboxItemStatus }) {
  return (
    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full capitalize ${STATUS_TONES[value]}`}>
      {value}
    </span>
  );
}

function LinkRequestDialog({
  item,
  onClose,
  onLink,
  isLinking,
}: {
  item: InboxItem;
  onClose: () => void;
  onLink: (listRequestId: number) => void;
  isLinking: boolean;
}) {
  const [requestId, setRequestId] = useState('');

  return (
    <Modal title="Link message to a list request" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Linking <span className="font-medium text-gray-900">&ldquo;{item.subject || '(no subject)'}&rdquo;</span> from{' '}
          {item.fromAddress || 'an unknown sender'}. Enter the list request ID this message belongs to — you can
          find it on the List Requests page.
        </p>
        <input
          type="number"
          autoFocus
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
          placeholder="List request ID"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800">
            Cancel
          </button>
          <button
            onClick={() => {
              const parsed = parseInt(requestId, 10);
              if (!isNaN(parsed)) onLink(parsed);
            }}
            disabled={isLinking || !requestId}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            Link
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function Responses() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | 'unprocessed'>('unprocessed');
  const [linkingItem, setLinkingItem] = useState<InboxItem | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['inbox', 'settings'],
    queryFn: async () => (await apiGet<{ provider: 'mock' | 'gog' }>('/api/inbox/settings')).data ?? null,
  });

  const itemsQuery = useQuery({
    queryKey: ['inbox', 'items', statusFilter],
    queryFn: async () =>
      (
        await apiGet<InboxItem[]>(
          statusFilter === 'unprocessed' ? '/api/inbox/unprocessed' : '/api/inbox/items'
        )
      ).data ?? [],
    refetchInterval: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['inbox'] });

  const checkNow = useMutation({
    mutationFn: async () => (await apiSend<PollInboxResult>('/api/inbox/check', 'POST', {})).data,
    onSuccess: (result) => {
      invalidate();
      toast.showSuccess(
        result && result.newItemsCount > 0
          ? `Found ${result.newItemsCount} new message${result.newItemsCount === 1 ? '' : 's'}.`
          : 'No new messages.'
      );
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to check inbox.');
    },
  });

  const classify = useMutation({
    mutationFn: async ({ id, classification }: { id: number; classification: InboxClassification }) =>
      apiSend(`/api/inbox/${id}/classify`, 'POST', { classification }),
    onSuccess: invalidate,
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to classify message.');
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: InboxItemStatus }) =>
      apiSend(`/api/inbox/${id}/status`, 'POST', { status }),
    onSuccess: invalidate,
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to update status.');
    },
  });

  const link = useMutation({
    mutationFn: async ({ id, listRequestId }: { id: number; listRequestId: number }) =>
      apiSend(`/api/inbox/${id}/link`, 'POST', { listRequestId }),
    onSuccess: () => {
      invalidate();
      setLinkingItem(null);
      toast.showSuccess('Message linked to request.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to link message.');
    },
  });

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const provider = settingsQuery.data?.provider ?? 'mock';

  if (itemsQuery.isLoading) return <LoadingState label="Loading inbox..." />;
  if (itemsQuery.isError) {
    return <ErrorState message="Failed to load inbox items." onRetry={() => itemsQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Responses</h2>
          <p className="text-sm text-gray-500 mt-1">
            Gmail replies matched to FOIA requests, classified automatically, and flagged for review when unclear.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${
              provider === 'gog' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
            }`}
            title={
              provider === 'gog'
                ? 'Live Gmail polling is enabled (INBOX_PROVIDER=gog).'
                : 'Mock mode: sample replies only, no real Gmail access.'
            }
          >
            {provider === 'gog' ? 'Live Gmail' : 'Mock mode'}
          </span>
          <button
            onClick={() => checkNow.mutate()}
            disabled={checkNow.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${checkNow.isPending ? 'animate-spin' : ''}`} />
            Check Now
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {(['unprocessed', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg capitalize ${
              statusFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f === 'unprocessed' ? 'Needs Review' : 'All Messages'}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={statusFilter === 'unprocessed' ? 'Nothing needs review' : 'No messages yet'}
          description="Click Check Now to poll for new replies (mock replies are generated automatically for testing)."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <div key={item.id} className="border rounded-lg overflow-hidden">
                <button
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 truncate">{item.subject || '(no subject)'}</span>
                      <StatusBadge value={item.status} />
                      <ClassificationBadge value={item.classification} />
                      {item.attachmentMetadata && item.attachmentMetadata.length > 0 && (
                        <Paperclip className="w-3.5 h-3.5 text-gray-400" />
                      )}
                    </div>
                    <p className="text-sm text-gray-500 truncate mt-0.5">
                      From {item.fromAddress || 'unknown'}
                      {item.listRequest && (
                        <>
                          {' '}
                          &middot; {item.listRequest.taxOfficial.county.name},{' '}
                          {item.listRequest.taxOfficial.county.state.abbreviation} (request #{item.listRequestId})
                        </>
                      )}
                      {!item.listRequest && item.matchConfidence !== null && item.matchConfidence > 0 && (
                        <> &middot; best guess confidence {item.matchConfidence}%</>
                      )}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {item.receivedAt ? new Date(item.receivedAt).toLocaleString() : ''}
                  </span>
                </button>

                {expanded && (
                  <div className="border-t px-4 py-4 bg-gray-50 space-y-4">
                    <div className="text-sm text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto bg-white border rounded-lg p-3">
                      {item.bodyText || 'No body text available.'}
                    </div>

                    {item.attachmentMetadata && item.attachmentMetadata.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {item.attachmentMetadata.map((a, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-white border text-gray-700"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            {a.filename} ({Math.round(a.sizeBytes / 1024)} KB)
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-gray-500 uppercase mr-1">Classify:</span>
                      {(Object.keys(CLASSIFICATION_LABELS) as InboxClassification[]).map((c) => (
                        <button
                          key={c}
                          onClick={() => classify.mutate({ id: item.id, classification: c })}
                          disabled={classify.isPending}
                          className={`px-2.5 py-1 text-xs font-medium rounded-full border disabled:opacity-50 ${
                            item.classification === c
                              ? 'border-blue-600 bg-blue-50 text-blue-700'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {CLASSIFICATION_LABELS[c]}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        onClick={() => setLinkingItem(item)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        {item.listRequestId ? 'Relink to different request' : 'Link to request'}
                      </button>
                      {item.status !== 'reviewed' && (
                        <button
                          onClick={() => setStatus.mutate({ id: item.id, status: 'reviewed' })}
                          disabled={setStatus.isPending}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 hover:text-green-900 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Mark reviewed
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {linkingItem && (
        <LinkRequestDialog
          item={linkingItem}
          onClose={() => setLinkingItem(null)}
          isLinking={link.isPending}
          onLink={(listRequestId) => link.mutate({ id: linkingItem.id, listRequestId })}
        />
      )}
    </div>
  );
}
