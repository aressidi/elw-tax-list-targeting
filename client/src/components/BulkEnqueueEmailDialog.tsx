import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Clock, MinusCircle, XCircle } from 'lucide-react';
import { apiSend, ApiError } from '../lib/api';
import type { EnqueueBulkResponse } from '../types';
import Modal from './Modal';
import { useToast } from './Toast';

interface BulkEnqueueEmailDialogProps {
  requestIds: number[];
  onClose: () => void;
  onDone: () => void;
}

const outcomeStyle: Record<string, string> = {
  queued: 'text-green-700',
  skipped: 'text-gray-500',
  failed: 'text-red-700',
};

function OutcomeIcon({ outcome }: { outcome: string }) {
  if (outcome === 'queued') return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />;
  if (outcome === 'skipped') return <MinusCircle className="w-4 h-4 text-gray-400 shrink-0" />;
  return <XCircle className="w-4 h-4 text-red-600 shrink-0" />;
}

export default function BulkEnqueueEmailDialog({ requestIds, onClose, onDone }: BulkEnqueueEmailDialogProps) {
  const toast = useToast();
  const [sendAt, setSendAt] = useState('');

  const enqueue = useMutation({
    mutationFn: async () =>
      (
        await apiSend<EnqueueBulkResponse>('/api/list-requests/bulk-enqueue', 'POST', {
          requestIds,
          sendAt: sendAt ? new Date(sendAt).toISOString() : undefined,
        })
      ).data ?? null,
    onSuccess: (data) => {
      onDone();
      if (data) {
        toast.showSuccess(
          `Queued ${data.summary.queued}/${data.summary.total} (${data.summary.failed} failed, ${data.summary.skipped} skipped).`
        );
      }
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Bulk enqueue failed.');
    },
  });

  const results = enqueue.data?.results ?? null;

  return (
    <Modal
      title={`Add ${requestIds.length} Email${requestIds.length === 1 ? '' : 's'} to Queue`}
      onClose={onClose}
      widthClassName="max-w-lg"
    >
      {!results ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Adds each selected request to the throttled send queue instead of sending immediately. The
            queue processor respects the daily send limit and pause state. One failure will not stop the rest.
          </p>

          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
              <Clock className="w-4 h-4" />
              Send at (optional)
            </label>
            <input
              type="datetime-local"
              value={sendAt}
              onChange={(e) => setSendAt(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave blank so each email sends as soon as the processor next runs and the daily limit allows.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={enqueue.isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => enqueue.mutate()}
              disabled={enqueue.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {enqueue.isPending ? 'Adding...' : 'Add to Queue'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="max-h-80 overflow-y-auto divide-y text-sm border rounded-lg">
            {results.map((r) => (
              <li key={r.listRequestId} className="py-2 px-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <OutcomeIcon outcome={r.outcome} />
                  <span className="text-gray-700">Request #{r.listRequestId}</span>
                </div>
                <span className={`text-xs text-right truncate ${outcomeStyle[r.outcome] ?? ''}`}>
                  {r.outcome}
                  {r.error ? `: ${r.error}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
