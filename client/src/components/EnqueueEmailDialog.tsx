import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { apiSend, ApiError } from '../lib/api';
import type { EnqueueResultItem } from '../types';
import Modal from './Modal';
import { useToast } from './Toast';

interface EnqueueEmailDialogProps {
  listRequestId: number;
  recipientLabel: string;
  onClose: () => void;
  onQueued: () => void;
}

// datetime-local gives a value like "2026-09-10T14:30" with no timezone —
// treated as local time by `new Date(...)`, which is what a human picking
// a send time expects.
export default function EnqueueEmailDialog({ listRequestId, recipientLabel, onClose, onQueued }: EnqueueEmailDialogProps) {
  const toast = useToast();
  const [sendAt, setSendAt] = useState('');

  const enqueue = useMutation({
    mutationFn: async () =>
      (
        await apiSend<EnqueueResultItem>(`/api/list-requests/${listRequestId}/enqueue`, 'POST', {
          sendAt: sendAt ? new Date(sendAt).toISOString() : undefined,
        })
      ).data ?? null,
    onSuccess: () => {
      toast.showSuccess(sendAt ? 'Email scheduled.' : 'Email added to the queue.');
      onQueued();
      onClose();
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to add this email to the queue.');
    },
  });

  return (
    <Modal title="Add to Send Queue" onClose={onClose} widthClassName="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          To: <span className="font-medium text-gray-800">{recipientLabel}</span>
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
            Leave blank to send as soon as the queue processor next runs and the daily limit allows.
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
    </Modal>
  );
}
