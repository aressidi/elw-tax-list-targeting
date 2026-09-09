import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  DollarSign,
  Clock,
  PackageCheck,
  Gift,
  Download,
  Pencil,
  CheckCircle2,
} from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import PaymentUpdateDialog from '../components/PaymentUpdateDialog';
import { useToast } from '../components/Toast';
import type {
  CostByCountyEntry,
  CostByStateEntry,
  CostSummaryReport,
  PaidUnfulfilledEntry,
  PendingPaymentEntry,
} from '../types';

type TabKey = 'overview' | 'pending' | 'paid-unfulfilled' | 'explorer';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview & Spending' },
  { key: 'pending', label: 'Pending Payments / Aging' },
  { key: 'paid-unfulfilled', label: 'Paid but Unfulfilled' },
  { key: 'explorer', label: 'Cost by State & County' },
];

function money(value: number | null | undefined): string {
  return `$${(value ?? 0).toFixed(2)}`;
}

function agingColor(days: number): string {
  if (days >= 21) return 'text-red-600';
  if (days >= 7) return 'text-amber-600';
  return 'text-gray-500';
}

export default function Reports() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('overview');
  const [editingRequest, setEditingRequest] = useState<{ id: number; label: string } | null>(null);
  const [countySearch, setCountySearch] = useState('');

  const invalidateReports = () => {
    queryClient.invalidateQueries({ queryKey: ['reports'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-pipeline'] });
  };

  const summaryQuery = useQuery({
    queryKey: ['reports', 'costs'],
    queryFn: async () => (await apiGet<CostSummaryReport>('/api/reports/costs')).data ?? null,
  });

  const byStateQuery = useQuery({
    queryKey: ['reports', 'by-state'],
    queryFn: async () => (await apiGet<CostByStateEntry[]>('/api/reports/by-state')).data ?? [],
    enabled: tab === 'overview' || tab === 'explorer',
  });

  const byCountyQuery = useQuery({
    queryKey: ['reports', 'by-county'],
    queryFn: async () => (await apiGet<CostByCountyEntry[]>('/api/reports/by-county')).data ?? [],
    enabled: tab === 'explorer',
  });

  const pendingQuery = useQuery({
    queryKey: ['reports', 'pending-payments'],
    queryFn: async () => (await apiGet<PendingPaymentEntry[]>('/api/reports/pending-payments')).data ?? [],
    enabled: tab === 'pending',
  });

  const paidUnfulfilledQuery = useQuery({
    queryKey: ['reports', 'paid-unfulfilled'],
    queryFn: async () => (await apiGet<PaidUnfulfilledEntry[]>('/api/reports/paid-unfulfilled')).data ?? [],
    enabled: tab === 'paid-unfulfilled',
  });

  const markPaidMutation = useMutation({
    mutationFn: async (requestId: number) =>
      apiSend(`/api/list-requests/${requestId}/payment`, 'PATCH', {
        paymentStatus: 'paid',
        paymentDate: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      toast.showSuccess('Marked as paid');
      invalidateReports();
    },
    onError: (error) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to mark as paid');
    },
  });

  const filteredCounties = useMemo(() => {
    const rows = byCountyQuery.data ?? [];
    if (!countySearch.trim()) return rows;
    const q = countySearch.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.countyName.toLowerCase().includes(q) ||
        r.stateAbbreviation.toLowerCase().includes(q) ||
        r.officialName.toLowerCase().includes(q)
    );
  }, [byCountyQuery.data, countySearch]);

  const summary = summaryQuery.data;
  const maxStateSpend = Math.max(1, ...(byStateQuery.data ?? []).map((s) => s.totalSpend));

  if (summaryQuery.isLoading) {
    return <LoadingState label="Loading budget report..." />;
  }
  if (summaryQuery.isError || !summary) {
    return <ErrorState message="Failed to load budget report." onRetry={() => summaryQuery.refetch()} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-900">Budget & Reports</h2>
        <a
          href="/api/reports/export-csv"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <Download className="w-4 h-4" /> Export Report CSV
        </a>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Total Spent" value={money(summary.totalSpending)} icon={DollarSign} color="bg-green-500" />
        <MetricCard label="Pending Invoices / Quotes" value={money(summary.totalQuotesPending)} icon={Clock} color="bg-amber-500" />
        <MetricCard
          label="Paid & Awaiting Delivery"
          value={`${money(summary.totalPaid)}`}
          subvalue={`${summary.paidListCount} list${summary.paidListCount === 1 ? '' : 's'}`}
          icon={PackageCheck}
          color="bg-orange-500"
        />
        <MetricCard label="Free Lists Received" value={summary.listTypeBreakdown.free} icon={Gift} color="bg-blue-500" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Top States by Cost</h3>
            {byStateQuery.isLoading && <LoadingState label="Loading state spending..." />}
            {byStateQuery.isError && <ErrorState message="Failed to load state spending." onRetry={() => byStateQuery.refetch()} />}
            {byStateQuery.data && byStateQuery.data.length === 0 && (
              <EmptyState title="No spending recorded yet" />
            )}
            {byStateQuery.data && byStateQuery.data.length > 0 && (
              <div className="space-y-2">
                {byStateQuery.data.slice(0, 10).map((s) => (
                  <div key={s.stateId} className="flex items-center gap-3">
                    <span className="w-10 text-xs font-medium text-gray-600">{s.stateAbbreviation}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        className="bg-blue-500 h-4 rounded-full"
                        style={{ width: `${Math.max(2, (s.totalSpend / maxStateSpend) * 100)}%` }}
                      />
                    </div>
                    <span className="w-24 text-right text-xs font-medium text-gray-700">{money(s.totalSpend)}</span>
                    <span className="w-16 text-right text-xs text-gray-400">{s.listCount} lists</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Pricing Basis Distribution</h3>
            {summary.pricingBasisBreakdown.length === 0 ? (
              <EmptyState title="No priced lists yet" />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {summary.pricingBasisBreakdown.map((b) => (
                  <div key={b.basis} className="border rounded-lg p-3">
                    <p className="text-xs text-gray-500 capitalize">{b.basis.replace(/_/g, ' ')}</p>
                    <p className="text-lg font-bold text-gray-900">{money(b.totalAmount)}</p>
                    <p className="text-xs text-gray-400">
                      {b.count} list{b.count === 1 ? '' : 's'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">List Type Breakdown</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(Object.entries(summary.listTypeBreakdown) as [string, number][]).map(([type, cnt]) => (
                <div key={type} className="border rounded-lg p-3">
                  <p className="text-xs text-gray-500 capitalize">{type.replace(/_/g, ' ')}</p>
                  <p className="text-lg font-bold text-gray-900">{cnt}</p>
                </div>
              ))}
            </div>
            {summary.averageCostPerPaidList !== null && (
              <p className="text-sm text-gray-600 mt-3">
                Average cost per paid list: <span className="font-medium text-gray-900">{money(summary.averageCostPerPaidList)}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'pending' && (
        <div>
          {pendingQuery.isLoading && <LoadingState label="Loading pending payments..." />}
          {pendingQuery.isError && <ErrorState message="Failed to load pending payments." onRetry={() => pendingQuery.refetch()} />}
          {pendingQuery.data && pendingQuery.data.length === 0 && (
            <EmptyState title="No pending payments" description="Every quoted request has been paid or resolved." />
          )}
          {pendingQuery.data && pendingQuery.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">County</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">State</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Amount</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Invoice #</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Days Pending</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingQuery.data.map((row) => (
                    <tr key={row.requestId} className="border-b hover:bg-gray-50">
                      <td className="py-2.5 px-3">
                        <Link href={`/counties/${row.countyId}`} className="font-medium text-gray-900 hover:text-blue-700">
                          {row.countyName} County
                        </Link>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">{row.stateAbbreviation}</td>
                      <td className="py-2.5 px-3 text-gray-700">{money(row.costAmount)}</td>
                      <td className="py-2.5 px-3 text-gray-500">{row.invoiceNumber || '—'}</td>
                      <td className={`py-2.5 px-3 font-medium ${agingColor(row.daysPending)}`}>{row.daysPending}d</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => markPaidMutation.mutate(row.requestId)}
                            disabled={markPaidMutation.isPending}
                            className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-900 disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Mark Paid
                          </button>
                          <button
                            onClick={() => setEditingRequest({ id: row.requestId, label: `${row.countyName} County, ${row.stateAbbreviation}` })}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'paid-unfulfilled' && (
        <div>
          {paidUnfulfilledQuery.isLoading && <LoadingState label="Loading paid-but-unfulfilled requests..." />}
          {paidUnfulfilledQuery.isError && (
            <ErrorState message="Failed to load paid-but-unfulfilled requests." onRetry={() => paidUnfulfilledQuery.refetch()} />
          )}
          {paidUnfulfilledQuery.data && paidUnfulfilledQuery.data.length === 0 && (
            <EmptyState title="Nothing outstanding" description="Every paid request has had its file delivered." />
          )}
          {paidUnfulfilledQuery.data && paidUnfulfilledQuery.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">County</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">State</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Amount Paid</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Payment Date</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Days Since Paid</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paidUnfulfilledQuery.data.map((row) => (
                    <tr key={row.requestId} className="border-b hover:bg-amber-50">
                      <td className="py-2.5 px-3">
                        <Link href={`/counties/${row.countyId}`} className="font-medium text-gray-900 hover:text-blue-700">
                          {row.countyName} County
                        </Link>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">{row.stateAbbreviation}</td>
                      <td className="py-2.5 px-3 text-gray-700">{money(row.costAmount)}</td>
                      <td className="py-2.5 px-3 text-gray-500">
                        {row.paymentDate ? new Date(row.paymentDate).toLocaleDateString() : '—'}
                      </td>
                      <td className={`py-2.5 px-3 font-medium ${agingColor(row.daysSincePaid ?? 0)}`}>
                        {row.daysSincePaid !== null ? `${row.daysSincePaid}d` : '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                          Awaiting file
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'explorer' && (
        <div>
          <div className="mb-4">
            <input
              type="text"
              value={countySearch}
              onChange={(e) => setCountySearch(e.target.value)}
              placeholder="Search county, state, or official..."
              className="text-sm border rounded-md px-3 py-2 bg-white w-full max-w-sm"
            />
          </div>
          {byCountyQuery.isLoading && <LoadingState label="Loading cost records..." />}
          {byCountyQuery.isError && <ErrorState message="Failed to load cost records." onRetry={() => byCountyQuery.refetch()} />}
          {byCountyQuery.data && filteredCounties.length === 0 && (
            <EmptyState title="No matching cost records" />
          )}
          {byCountyQuery.data && filteredCounties.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">County</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">State</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">List Type</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Pricing Basis</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Cost</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">Payment Status</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700">File Received</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-700"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCounties.map((row) => (
                    <tr key={row.requestId} className="border-b hover:bg-gray-50">
                      <td className="py-2.5 px-3">
                        <Link href={`/counties/${row.countyId}`} className="font-medium text-gray-900 hover:text-blue-700">
                          {row.countyName} County
                        </Link>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">{row.stateAbbreviation}</td>
                      <td className="py-2.5 px-3 text-gray-600 capitalize">{(row.listType ?? 'unknown').replace(/_/g, ' ')}</td>
                      <td className="py-2.5 px-3 text-gray-600 capitalize">{(row.pricingBasis ?? '—').replace(/_/g, ' ')}</td>
                      <td className="py-2.5 px-3 text-gray-700">{row.costAmount !== null ? money(row.costAmount) : '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                          {(row.paymentStatus ?? 'not_required').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">{row.listFileReceived ? 'Yes' : 'No'}</td>
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => setEditingRequest({ id: row.requestId, label: `${row.countyName} County, ${row.stateAbbreviation}` })}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editingRequest && (
        <PaymentUpdateDialog
          requestId={editingRequest.id}
          requestLabel={editingRequest.label}
          onClose={() => setEditingRequest(null)}
          onSaved={invalidateReports}
        />
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subvalue,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  subvalue?: string;
  icon: typeof DollarSign;
  color: string;
}) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {subvalue && <p className="text-xs text-gray-400 mt-0.5">{subvalue}</p>}
        </div>
        <div className={`${color} p-2.5 rounded-lg`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}
