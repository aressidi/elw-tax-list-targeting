import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type { ListRequest, PaymentStatus, UpdatePaymentInput } from '../types';
import Modal from './Modal';
import { LoadingState, ErrorState } from './QueryState';
import { useToast } from './Toast';

interface PaymentUpdateDialogProps {
  requestId: number;
  requestLabel: string;
  onClose: () => void;
  onSaved?: () => void;
}

const PAYMENT_STATUSES: PaymentStatus[] = ['not_required', 'requested', 'paid', 'fulfilled'];
const PRICING_BASES = ['flat_list', 'per_listing', 'per_page', 'per_record', 'hourly', 'unknown'];
const PAYMENT_METHODS = ['check', 'credit_card', 'wire', 'ach', 'online_portal', 'other'];

function toDateInputValue(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export default function PaymentUpdateDialog({ requestId, requestLabel, onClose, onSaved }: PaymentUpdateDialogProps) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['list-requests', requestId, 'payment-detail'],
    queryFn: async () => (await apiGet<ListRequest>(`/api/list-requests/${requestId}`)).data ?? null,
  });

  const [form, setForm] = useState<{
    paymentStatus: PaymentStatus;
    costAmount: string;
    pricingBasis: string;
    paymentDate: string;
    paymentMethod: string;
    invoiceNumber: string;
    paymentReference: string;
    costNotes: string;
  } | null>(null);

  useEffect(() => {
    const d = detailQuery.data;
    if (!d) return;
    setForm({
      paymentStatus: (d.paymentStatus as PaymentStatus | null) ?? 'not_required',
      costAmount: d.costAmount ?? '',
      pricingBasis: d.pricingBasis ?? '',
      paymentDate: toDateInputValue(d.paymentDate),
      paymentMethod: d.paymentMethod ?? '',
      invoiceNumber: d.invoiceNumber ?? '',
      paymentReference: d.paymentReference ?? '',
      costNotes: d.costNotes ?? '',
    });
  }, [detailQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (input: UpdatePaymentInput) => apiSend(`/api/list-requests/${requestId}/payment`, 'PATCH', input),
    onSuccess: () => {
      toast.showSuccess('Payment details updated');
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-pipeline'] });
      onSaved?.();
      onClose();
    },
    onError: (error) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to update payment details');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;

    const input: UpdatePaymentInput = {
      paymentStatus: form.paymentStatus,
      costAmount: form.costAmount.trim() === '' ? null : Number(form.costAmount),
      pricingBasis: form.pricingBasis.trim() === '' ? null : form.pricingBasis,
      paymentDate: form.paymentDate.trim() === '' ? null : form.paymentDate,
      paymentMethod: form.paymentMethod.trim() === '' ? null : form.paymentMethod,
      invoiceNumber: form.invoiceNumber.trim() === '' ? null : form.invoiceNumber,
      paymentReference: form.paymentReference.trim() === '' ? null : form.paymentReference,
      costNotes: form.costNotes.trim() === '' ? null : form.costNotes,
    };
    saveMutation.mutate(input);
  };

  return (
    <Modal title={`Update Payment — ${requestLabel}`} onClose={onClose} widthClassName="max-w-lg">
      {detailQuery.isLoading && <LoadingState label="Loading request..." />}
      {detailQuery.isError && <ErrorState message="Failed to load request." onRetry={() => detailQuery.refetch()} />}

      {form && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Payment Status</label>
              <select
                value={form.paymentStatus}
                onChange={(e) => setForm({ ...form, paymentStatus: e.target.value as PaymentStatus })}
                className="text-sm border rounded-md px-2 py-1.5 bg-white capitalize"
              >
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Pricing Basis</label>
              <select
                value={form.pricingBasis}
                onChange={(e) => setForm({ ...form, pricingBasis: e.target.value })}
                className="text-sm border rounded-md px-2 py-1.5 bg-white capitalize"
              >
                <option value="">—</option>
                {PRICING_BASES.map((b) => (
                  <option key={b} value={b}>
                    {b.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Cost Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.costAmount}
                onChange={(e) => setForm({ ...form, costAmount: e.target.value })}
                className="text-sm border rounded-md px-2 py-1.5 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Payment Date</label>
              <input
                type="date"
                value={form.paymentDate}
                onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
                className="text-sm border rounded-md px-2 py-1.5 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Payment Method</label>
              <select
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                className="text-sm border rounded-md px-2 py-1.5 bg-white capitalize"
              >
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Invoice Number</label>
              <input
                type="text"
                value={form.invoiceNumber}
                onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
                className="text-sm border rounded-md px-2 py-1.5 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-xs font-medium text-gray-500">Payment Reference</label>
              <input
                type="text"
                value={form.paymentReference}
                onChange={(e) => setForm({ ...form, paymentReference: e.target.value })}
                className="text-sm border rounded-md px-2 py-1.5 bg-white"
                placeholder="Check #, confirmation #, transaction ID…"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-xs font-medium text-gray-500">Invoice Notes</label>
              <textarea
                value={form.costNotes}
                onChange={(e) => setForm({ ...form, costNotes: e.target.value })}
                rows={3}
                className="text-sm border rounded-md px-2 py-1.5 bg-white"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save Payment Details'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
