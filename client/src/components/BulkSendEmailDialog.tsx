import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { apiSend, ApiError } from '../lib/api';
import type { EmailBulkSendResponse } from '../types';
import Modal from './Modal';
import { useToast } from './Toast';

interface BulkSendEmailDialogProps {
  requestIds: number[];
  onClose: () => void;
  onDone: () => void;
}

const outcomeStyle: Record<string, string> = {
  sent: 'text-green-700',
  skipped: 'text-gray-500',
  failed: 'text-red-700',
};

function OutcomeIcon({ outcome }: { outcome: string }) {
  if (outcome === 'sent') return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />;
  if (outcome === 'skipped') return <MinusCircle className="w-4 h-4 text-gray-400 shrink-0" />;
  return <XCircle className="w-4 h-4 text-red-600 shrink-0" />;
}

export default function BulkSendEmailDialog({ requestIds, onClose, onDone }: BulkSendEmailDialogProps) {
  const toast = useToast();
  const [force, setForce] = useState(false);

  const send = useMutation({
    mutationFn: async () =>
      (
        await apiSend<EmailBulkSendResponse>('/api/list-requests/bulk-send', 'POST', {
          requestIds,
          force,
        })
      ).data ?? null,
    onSuccess: (data) => {
      onDone();
      if (data) {
        toast.showSuccess(
          `Sent ${data.summary.sent}/${data.summary.total} (${data.summary.failed} failed, ${data.summary.skipped} skipped) via ${
            data.summary.transport === 'gog' ? 'live Gmail' : 'dry-run'
          } transport.`
        );
      }
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Bulk send failed.');
    },
  });

  const results = send.data?.results ?? null;

  return (
    <Modal
      title={`Send ${requestIds.length} Email${requestIds.length === 1 ? '' : 's'}`}
      onClose={onClose}
      widthClassName="max-w-lg"
    >
      {!results ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This renders and sends (or dry-runs) a FOIA request email to each selected request's county
            primary contact. One failure will not stop the rest.
          </p>
          <label className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <span>Force resend for requests that already have an email sent.</span>
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={send.isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => send.mutate()}
              disabled={send.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {send.isPending ? 'Sending...' : 'Confirm Send'}
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
