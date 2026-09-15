import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { apiSend, ApiError } from '../lib/api';
import type { EmailSendPreview, EmailSendResult } from '../types';
import Modal from './Modal';
import { useToast } from './Toast';

interface SendEmailDialogProps {
  listRequestId: number;
  recipientLabel: string;
  alreadySent: boolean;
  onClose: () => void;
  onSent: () => void;
}

function transportLabel(transport: string): string {
  return transport === 'gog' ? 'Live Gmail send (gog)' : 'Dry-run (no real email sent)';
}

export default function SendEmailDialog({
  listRequestId,
  recipientLabel,
  alreadySent,
  onClose,
  onSent,
}: SendEmailDialogProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [forceResend, setForceResend] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);

  const preview = useQuery({
    queryKey: ['send-email-preview', listRequestId],
    queryFn: async () =>
      (
        await apiSend<EmailSendPreview>(`/api/list-requests/${listRequestId}/send-email`, 'POST', {
          dryRun: true,
        })
      ).data ?? null,
  });

  const needsRecipientSelection = !!preview.data?.needsRecipientSelection;
  const candidates = preview.data?.candidates ?? [];

  const useRecipient = useMutation({
    mutationFn: (taxOfficialId: number) =>
      apiSend(`/api/list-requests/${listRequestId}`, 'PATCH', { taxOfficialId }),
    onSuccess: () => {
      // The request now targets a different contact — re-render the
      // preview against it, and let callers (county/list pages) refresh
      // anything that shows which official this request is for.
      queryClient.invalidateQueries({ queryKey: ['send-email-preview', listRequestId] });
      setSelectedCandidateId(null);
      onSent();
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to update the request recipient.');
    },
  });

  const send = useMutation({
    mutationFn: async () =>
      (
        await apiSend<EmailSendResult>(
          `/api/list-requests/${listRequestId}/send-email${forceResend ? '?force=true' : ''}`,
          'POST',
          {}
        )
      ).data,
    onSuccess: (result) => {
      toast.showSuccess(
        `Email sent via ${result ? transportLabel(result.transport) : 'the active transport'}.`
      );
      onSent();
      onClose();
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to send email.');
    },
  });

  const isLive = preview.data?.transport === 'gog';
  const canSend = !!preview.data && !needsRecipientSelection && !!preview.data.recipientEmail && (!alreadySent || forceResend);
  const recipientName = preview.data?.recipientName ?? recipientLabel;

  return (
    <Modal title="Send FOIA Request Email" onClose={onClose} widthClassName="max-w-2xl">
      {preview.isLoading && <p className="text-sm text-gray-500">Rendering preview...</p>}

      {preview.isError && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{preview.error instanceof ApiError ? preview.error.message : 'Failed to render this email.'}</span>
        </div>
      )}

      {preview.data && needsRecipientSelection && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              {preview.data.error ??
                `${preview.data.referencedContact?.fullName ?? 'The contact for this request'} has no email address on file.`}{' '}
              Choose another contact to send this request to.
            </span>
          </div>

          {candidates.length === 0 ? (
            <p className="text-sm text-gray-500">
              No other contact on file for this county has an email address. Add one via the county's Contacts
              section, then reopen this dialog.
            </p>
          ) : (
            <div className="space-y-2">
              {candidates.map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex items-start gap-3 border rounded-lg p-3 text-sm cursor-pointer hover:bg-gray-50"
                >
                  <input
                    type="radio"
                    name="recipient-candidate"
                    className="mt-1"
                    checked={selectedCandidateId === candidate.id}
                    onChange={() => setSelectedCandidateId(candidate.id)}
                  />
                  <span>
                    <span className="font-medium text-gray-900">{candidate.fullName}</span>
                    {candidate.isPrimary && (
                      <span className="ml-2 text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                        Primary
                      </span>
                    )}
                    {candidate.title && <span className="block text-gray-500">{candidate.title}</span>}
                    <span className="block text-gray-600">{candidate.emailAddress}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={useRecipient.isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => selectedCandidateId != null && useRecipient.mutate(selectedCandidateId)}
              disabled={selectedCandidateId == null || useRecipient.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {useRecipient.isPending ? 'Updating...' : 'Use this contact'}
            </button>
          </div>
        </div>
      )}

      {preview.data && !needsRecipientSelection && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            To: <span className="font-medium text-gray-800">{recipientName}</span>{' '}
            &lt;{preview.data.recipientEmail}&gt;
          </p>

          <div className="border rounded-lg p-4 bg-gray-50 space-y-2">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Subject</p>
              <p className="text-sm text-gray-900 mt-0.5">{preview.data.subject}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Body</p>
              <pre className="text-sm text-gray-900 mt-0.5 whitespace-pre-wrap break-words font-sans max-h-64 overflow-y-auto">
                {preview.data.body}
              </pre>
            </div>
          </div>

          <div
            className={`text-xs rounded-lg px-3 py-2 font-medium ${
              isLive ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
            }`}
          >
            Transport: {transportLabel(preview.data.transport)}
          </div>

          {alreadySent && (
            <label className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <input
                type="checkbox"
                checked={forceResend}
                onChange={(e) => setForceResend(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
              />
              <span>An email was already sent for this request. Resend anyway (force).</span>
            </label>
          )}

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
              disabled={!canSend || send.isPending}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${
                isLive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {send.isPending
                ? 'Sending...'
                : isLive
                  ? 'Send via Gmail (live)'
                  : 'Send via dry-run transport'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
