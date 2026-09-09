import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Download,
  FileText,
  Link2,
  Package,
  PackagePlus,
  PackageX,
  Paperclip,
  RefreshCw,
  UploadCloud,
} from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import FileUploadDialog from '../components/FileUploadDialog';
import type { InboxClassification, InboxItem, InboxItemStatus, PollInboxResult, ReviewClassification } from '../types';

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

// Human review vocabulary (card 10) — what the request actually becomes
// once a person reads the message, distinct from the auto classification
// above. Every value maps 1:1 onto a list_request status server-side.
const REVIEW_CLASSIFICATIONS: ReviewClassification[] = [
  'list_provided',
  'requires_payment',
  'requires_form',
  'not_available',
  'needs_clarification',
  'declined',
];

const REVIEW_LABELS: Record<ReviewClassification, string> = {
  list_provided: 'List Provided',
  requires_payment: 'Requires Payment',
  requires_form: 'Requires Form',
  not_available: 'Not Available',
  needs_clarification: 'Needs Clarification',
  declined: 'Declined',
};

const REVIEW_TONES: Record<ReviewClassification, string> = {
  list_provided: 'bg-green-100 text-green-800',
  requires_payment: 'bg-amber-100 text-amber-800',
  requires_form: 'bg-blue-100 text-blue-800',
  not_available: 'bg-gray-200 text-gray-700',
  needs_clarification: 'bg-blue-100 text-blue-800',
  declined: 'bg-red-100 text-red-800',
};

// Default pre-selection in the review modal, based on what the rule engine
// already guessed. Purely a UX shortcut -- the reviewer can always pick a
// different value before saving.
const DEFAULT_REVIEW_BY_AUTO: Partial<Record<InboxClassification, ReviewClassification>> = {
  list_received: 'list_provided',
  fee_quote: 'requires_payment',
  clarification: 'needs_clarification',
  rejection: 'declined',
};

const DOLLAR_AMOUNT_RE = /\$\s?(\d+(?:\.\d{1,2})?)/;

function extractDollarAmount(bodyText: string | null): string {
  if (!bodyText) return '';
  const match = DOLLAR_AMOUNT_RE.exec(bodyText);
  return match ? match[1] : '';
}

interface ProcessPayload {
  classification: ReviewClassification;
  amount?: string;
  currency?: string;
  formUrl?: string;
  notes?: string;
  listRequestId?: number;
}

function ClassificationBadge({ value }: { value: InboxClassification | null }) {
  if (!value) return <span className="text-xs text-gray-400">Unclassified</span>;
  return (
    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${CLASSIFICATION_TONES[value]}`}>
      {CLASSIFICATION_LABELS[value]}
    </span>
  );
}

function ReviewBadge({ value }: { value: ReviewClassification | null }) {
  if (!value) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full border border-current/10 ${REVIEW_TONES[value]}`}>
      <CheckCircle2 className="w-3 h-3" />
      {REVIEW_LABELS[value]}
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

function ReviewClassificationModal({
  item,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  item: InboxItem;
  onClose: () => void;
  onSubmit: (payload: ProcessPayload) => void;
  isSubmitting: boolean;
}) {
  const [classification, setClassification] = useState<ReviewClassification | null>(
    (item.classification && DEFAULT_REVIEW_BY_AUTO[item.classification]) || null
  );
  const [amount, setAmount] = useState(() => extractDollarAmount(item.bodyText));
  const [currency, setCurrency] = useState('USD');
  const [formUrl, setFormUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [listRequestId, setListRequestId] = useState(item.listRequestId ? String(item.listRequestId) : '');

  const canSubmit = classification !== null && listRequestId.trim() !== '';

  const handleSubmit = () => {
    if (!classification) return;
    const parsedRequestId = parseInt(listRequestId, 10);
    if (isNaN(parsedRequestId)) return;

    onSubmit({
      classification,
      amount: classification === 'requires_payment' && amount.trim() ? amount.trim() : undefined,
      currency: classification === 'requires_payment' ? currency.trim() || 'USD' : undefined,
      formUrl: classification === 'requires_form' && formUrl.trim() ? formUrl.trim() : undefined,
      notes: notes.trim() || undefined,
      listRequestId: parsedRequestId,
    });
  };

  return (
    <Modal title="Review & classify response" onClose={onClose} widthClassName="max-w-xl">
      <div className="space-y-5">
        <div className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">&ldquo;{item.subject || '(no subject)'}&rdquo;</span> from{' '}
          {item.fromAddress || 'an unknown sender'}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">List request ID</label>
          <input
            type="number"
            value={listRequestId}
            onChange={(e) => setListRequestId(e.target.value)}
            placeholder="List request ID"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {!item.listRequestId && (
            <p className="text-xs text-amber-600 mt-1">
              This message isn&rsquo;t linked to a request yet — enter the ID it belongs to before saving.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Classification</label>
          <div className="flex flex-wrap gap-2">
            {REVIEW_CLASSIFICATIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setClassification(c)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-full border ${
                  classification === c
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {REVIEW_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        {classification === 'requires_payment' && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Currency</label>
              <input
                type="text"
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {classification === 'requires_form' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Form URL</label>
            <input
              type="url"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optional — becomes the request's response summary if provided."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            Save & update request
          </button>
        </div>
      </div>
    </Modal>
  );
}

const INBOX_ITEM_STATUS_FILTERS = ['unprocessed', 'reviewed', 'unmatched', 'all'] as const;
type StatusFilter = (typeof INBOX_ITEM_STATUS_FILTERS)[number];

const FILTER_LABELS: Record<StatusFilter, string> = {
  unprocessed: 'Needs Review',
  reviewed: 'Reviewed',
  unmatched: 'Unmatched',
  all: 'All Messages',
};

export default function Responses() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('unprocessed');
  const [linkingItem, setLinkingItem] = useState<InboxItem | null>(null);
  const [reviewingItem, setReviewingItem] = useState<InboxItem | null>(null);
  const [uploadingForItem, setUploadingForItem] = useState<InboxItem | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['inbox', 'settings'],
    queryFn: async () => (await apiGet<{ provider: 'mock' | 'gog' }>('/api/inbox/settings')).data ?? null,
  });

  const itemsQuery = useQuery({
    queryKey: ['inbox', 'items', statusFilter],
    queryFn: async () => {
      const path =
        statusFilter === 'unprocessed'
          ? '/api/inbox/unprocessed'
          : statusFilter === 'all'
            ? '/api/inbox/items'
            : `/api/inbox/items?status=${statusFilter}`;
      return (await apiGet<InboxItem[]>(path)).data ?? [];
    },
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inbox'] });
    queryClient.invalidateQueries({ queryKey: ['list-requests'] });
  };

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

  const process = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: ProcessPayload }) =>
      apiSend(`/api/responses/${id}/process`, 'POST', payload),
    onSuccess: () => {
      invalidate();
      setReviewingItem(null);
      toast.showSuccess('Request updated.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to process this response.');
    },
  });

  const quickProcess = (item: InboxItem, classification: ReviewClassification) => {
    if (!item.listRequestId) {
      toast.showError('Link this message to a list request before classifying it.');
      setLinkingItem(item);
      return;
    }
    process.mutate({ id: item.id, payload: { classification } });
  };

  const downloadAttachment = () => {
    toast.showSuccess('Attachments are recorded as metadata only in this environment — no file bytes are stored to download.');
  };

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
        {INBOX_ITEM_STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
              statusFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {FILTER_LABELS[f]}
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
                      <ReviewBadge value={item.reviewClassification} />
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

                <div className="border-t px-4 py-2.5 bg-white flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-gray-500 uppercase mr-1">Quick actions:</span>
                  <button
                    onClick={() => quickProcess(item, 'list_provided')}
                    disabled={process.isPending}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50"
                  >
                    <PackagePlus className="w-3.5 h-3.5" />
                    List Provided
                  </button>
                  <button
                    onClick={() => quickProcess(item, 'not_available')}
                    disabled={process.isPending}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                  >
                    <PackageX className="w-3.5 h-3.5" />
                    Not Available
                  </button>
                  <button
                    onClick={() => setReviewingItem(item)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border border-blue-300 text-blue-700 hover:bg-blue-50"
                  >
                    <Package className="w-3.5 h-3.5" />
                    Review & Classify
                  </button>
                  <button
                    onClick={() => setLinkingItem(item)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    {item.listRequestId ? 'Relink' : 'Link Request'}
                  </button>
                  {item.listRequestId && (
                    <button
                      onClick={() => setUploadingForItem(item)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border border-green-300 text-green-700 hover:bg-green-50"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      Upload List File
                    </button>
                  )}
                  {item.status !== 'reviewed' && (
                    <button
                      onClick={() => setStatus.mutate({ id: item.id, status: 'reviewed' })}
                      disabled={setStatus.isPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border border-purple-300 text-purple-700 hover:bg-purple-50 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Mark Processed
                    </button>
                  )}
                  {item.attachmentMetadata && item.attachmentMetadata.length > 0 && (
                    <button
                      onClick={downloadAttachment}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Attachment
                    </button>
                  )}
                </div>

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

                    {item.reviewClassification && (
                      <div className="text-xs text-gray-600 bg-white border rounded-lg p-3 space-y-1">
                        <p>
                          <span className="font-medium text-gray-900">Reviewed:</span> {REVIEW_LABELS[item.reviewClassification]}
                          {item.reviewedAt && <> on {new Date(item.reviewedAt).toLocaleString()}</>}
                        </p>
                        {item.reviewCostAmount && (
                          <p>
                            Cost: {item.reviewCostAmount} {item.reviewCostCurrency || 'USD'}
                          </p>
                        )}
                        {item.reviewFormUrl && (
                          <p>
                            Form:{' '}
                            <a href={item.reviewFormUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                              {item.reviewFormUrl}
                            </a>
                          </p>
                        )}
                        {item.reviewNotes && <p>Notes: {item.reviewNotes}</p>}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-gray-500 uppercase mr-1">Auto-classify override:</span>
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

      {reviewingItem && (
        <ReviewClassificationModal
          item={reviewingItem}
          onClose={() => setReviewingItem(null)}
          isSubmitting={process.isPending}
          onSubmit={(payload) => process.mutate({ id: reviewingItem.id, payload })}
        />
      )}

      {uploadingForItem && uploadingForItem.listRequestId && (
        <FileUploadDialog
          listRequestId={uploadingForItem.listRequestId}
          requestLabel={uploadingForItem.listRequest ? `${uploadingForItem.listRequest.taxOfficial.county.name} County` : undefined}
          onClose={() => setUploadingForItem(null)}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}
