import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Building2,
  TrendingUp,
  Clock,
  Activity,
  CheckCircle2,
  LayoutGrid,
  List as ListIcon,
  Mail,
  Paperclip,
  ExternalLink,
  Search,
} from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import PriorityBadge from '../components/PriorityBadge';
import SendEmailDialog from '../components/SendEmailDialog';
import FileUploadDialog from '../components/FileUploadDialog';
import { useToast } from '../components/Toast';
import type { DashboardMetrics, PipelineCard, PipelineResponse, PipelineStageKey, TargetPriority } from '../types';

// Reverse of server/services/pipelineService.ts STAGE_DEFAULT_STATUS -- the
// request_status (or the "data_processed" pseudo-status) to write when a
// card is moved into a given column.
const STAGE_TARGET_STATUS: Record<PipelineStageKey, string> = {
  not_started: 'not_started',
  researching: 'research_needed',
  ready_to_email: 'ready_to_email',
  email_sent: 'email_sent',
  awaiting_response: 'awaiting_response',
  response_received: 'response_received',
  list_provided: 'list_provided',
  data_processed: 'data_processed',
};

const STAGE_COLORS: Record<PipelineStageKey, string> = {
  not_started: 'bg-gray-100 text-gray-700',
  researching: 'bg-purple-100 text-purple-700',
  ready_to_email: 'bg-indigo-100 text-indigo-700',
  email_sent: 'bg-blue-100 text-blue-700',
  awaiting_response: 'bg-amber-100 text-amber-700',
  response_received: 'bg-cyan-100 text-cyan-700',
  list_provided: 'bg-green-100 text-green-700',
  data_processed: 'bg-emerald-100 text-emerald-700',
};

interface Filters {
  state: string;
  listType: string;
  priority: string;
  dateFrom: string;
  dateTo: string;
  search: string;
}

const EMPTY_FILTERS: Filters = { state: '', listType: '', priority: '', dateFrom: '', dateTo: '', search: '' };

function agingLabel(card: PipelineCard): string {
  if (card.daysSinceSent !== null && (card.stage === 'email_sent' || card.stage === 'awaiting_response')) {
    return card.stage === 'awaiting_response' ? `Waiting ${card.daysSinceSent}d` : `Sent ${card.daysSinceSent}d ago`;
  }
  return card.daysInStage === 0 ? 'Today' : `${card.daysInStage}d in stage`;
}

function agingColor(card: PipelineCard): string {
  const days = card.daysSinceSent ?? card.daysInStage;
  if (days >= 14) return 'text-red-600';
  if (days >= 7) return 'text-amber-600';
  return 'text-gray-500';
}

function matchesFilters(card: PipelineCard, filters: Filters): boolean {
  if (filters.state && card.stateAbbreviation !== filters.state) return false;
  if (filters.listType && card.listType !== filters.listType) return false;
  if (filters.priority && card.priority !== filters.priority) return false;
  if (filters.dateFrom && new Date(card.updatedAt) < new Date(filters.dateFrom)) return false;
  if (filters.dateTo && new Date(card.updatedAt) > new Date(`${filters.dateTo}T23:59:59`)) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const matchesCounty = card.countyName.toLowerCase().includes(q);
    const matchesContact = card.contact?.name.toLowerCase().includes(q) ?? false;
    if (!matchesCounty && !matchesContact) return false;
  }
  return true;
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sendingCard, setSendingCard] = useState<PipelineCard | null>(null);
  const [uploadingCard, setUploadingCard] = useState<PipelineCard | null>(null);

  const metricsQuery = useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => (await apiGet<DashboardMetrics>('/api/dashboard/metrics')).data ?? null,
  });

  const pipelineQuery = useQuery({
    queryKey: ['dashboard-pipeline'],
    queryFn: async () => (await apiGet<PipelineResponse>('/api/dashboard/pipeline')).data ?? null,
  });

  const invalidatePipeline = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard-pipeline'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
  };

  const moveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiSend(`/api/list-requests/${id}/status`, 'PATCH', { status }),
    onSuccess: () => {
      invalidatePipeline();
      toast.showSuccess('Pipeline stage updated');
    },
    onError: (error) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to update stage');
    },
  });

  const stages = pipelineQuery.data?.stages ?? [];
  const allCards = useMemo(() => stages.flatMap((s) => s.cards), [stages]);

  const stateOptions = useMemo(
    () => Array.from(new Set(allCards.map((c) => c.stateAbbreviation))).sort(),
    [allCards]
  );
  const listTypeOptions = useMemo(
    () => Array.from(new Set(allCards.map((c) => c.listType).filter((v): v is string => Boolean(v)))).sort(),
    [allCards]
  );

  const filteredCards = useMemo(() => allCards.filter((c) => matchesFilters(c, filters)), [allCards, filters]);
  const filtersActive = Object.values(filters).some((v) => v !== '');

  const groupedStages = useMemo(
    () =>
      stages.map((s) => {
        const cards = filteredCards.filter((c) => c.stage === s.key);
        return { ...s, cards, count: cards.length };
      }),
    [stages, filteredCards]
  );

  const moveCard = (card: PipelineCard, targetStage: PipelineStageKey) => {
    if (card.requestId === null || targetStage === card.stage) return;
    moveMutation.mutate({ id: card.requestId, status: STAGE_TARGET_STATUS[targetStage] });
  };

  if (metricsQuery.isLoading || pipelineQuery.isLoading) {
    return <LoadingState label="Loading pipeline dashboard..." />;
  }
  if (metricsQuery.isError || pipelineQuery.isError) {
    return (
      <ErrorState
        message="Failed to load dashboard."
        onRetry={() => {
          metricsQuery.refetch();
          pipelineQuery.refetch();
        }}
      />
    );
  }

  const metrics = metricsQuery.data;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-900">Pipeline Dashboard</h2>
        <div className="flex items-center gap-3">
          <Link
            href="/list-requests"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-900"
          >
            All List Requests <ExternalLink className="w-3.5 h-3.5" />
          </Link>
          <div className="inline-flex rounded-lg border overflow-hidden">
            <button
              onClick={() => setViewMode('kanban')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${
                viewMode === 'kanban' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <LayoutGrid className="w-4 h-4" /> Kanban
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-l ${
                viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <ListIcon className="w-4 h-4" /> List
            </button>
          </div>
        </div>
      </div>

      {/* Metric Widgets */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <MetricWidget label="Total Counties" value={metrics.totalCounties} icon={Building2} color="bg-blue-500" />
          <MetricWidget label="Response Rate" value={`${metrics.responseRate}%`} icon={TrendingUp} color="bg-green-500" />
          <MetricWidget
            label="Avg Response Time"
            value={metrics.avgResponseTimeDays !== null ? `${metrics.avgResponseTimeDays}d` : 'N/A'}
            icon={Clock}
            color="bg-amber-500"
          />
          <MetricWidget label="Active Requests" value={metrics.activeRequests} icon={Activity} color="bg-orange-500" />
          <MetricWidget label="Processed Lists" value={metrics.processedLists} icon={CheckCircle2} color="bg-purple-500" />
        </div>
      )}

      {metrics && metrics.cost.totalAll > 0 && (
        <div className="mb-6 text-sm text-gray-600 bg-gray-50 border rounded-lg px-4 py-2 flex flex-wrap gap-x-6 gap-y-1">
          <span>
            Total cost: <span className="font-medium text-gray-900">${metrics.cost.totalAll.toFixed(2)}</span>
          </span>
          <span>
            Quoted: <span className="font-medium text-gray-900">${metrics.cost.totalQuoted.toFixed(2)}</span>
          </span>
          <span>
            Paid: <span className="font-medium text-gray-900">${metrics.cost.totalPaid.toFixed(2)}</span>
          </span>
        </div>
      )}

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-end gap-3 mb-6 bg-gray-50 border rounded-lg p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">State</label>
          <select
            value={filters.state}
            onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))}
            className="text-sm border rounded-md px-2 py-1.5 bg-white"
          >
            <option value="">All</option>
            {stateOptions.map((abbr) => (
              <option key={abbr} value={abbr}>
                {abbr}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">List Type</label>
          <select
            value={filters.listType}
            onChange={(e) => setFilters((f) => ({ ...f, listType: e.target.value }))}
            className="text-sm border rounded-md px-2 py-1.5 bg-white capitalize"
          >
            <option value="">All</option>
            {listTypeOptions.map((lt) => (
              <option key={lt} value={lt} className="capitalize">
                {lt.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Priority</label>
          <select
            value={filters.priority}
            onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
            className="text-sm border rounded-md px-2 py-1.5 bg-white capitalize"
          >
            <option value="">All</option>
            {(['high', 'medium', 'low'] as TargetPriority[]).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Updated From</label>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className="text-sm border rounded-md px-2 py-1.5 bg-white"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Updated To</label>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className="text-sm border rounded-md px-2 py-1.5 bg-white"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-gray-500">Search County or Official</label>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Search..."
              className="text-sm border rounded-md pl-8 pr-2 py-1.5 bg-white w-full"
            />
          </div>
        </div>
        {filtersActive && (
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5"
          >
            Clear filters
          </button>
        )}
      </div>

      {filteredCards.length === 0 ? (
        <EmptyState title="No requests match these filters" description="Try clearing filters or check back after research is added." />
      ) : viewMode === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {groupedStages.map((stage) => (
            <div key={stage.key} className="w-72 flex-shrink-0 bg-gray-50 rounded-lg border flex flex-col max-h-[75vh]">
              <div className="px-3 py-2.5 border-b bg-white rounded-t-lg flex items-center justify-between sticky top-0">
                <span className="text-sm font-semibold text-gray-800">{stage.label}</span>
                <span className="text-xs font-medium bg-gray-200 text-gray-700 rounded-full px-2 py-0.5">
                  {stage.count}
                </span>
              </div>
              <div
                className="flex-1 overflow-y-auto p-2 space-y-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const raw = e.dataTransfer.getData('text/plain');
                  if (!raw) return;
                  try {
                    const { id } = JSON.parse(raw) as { id: number };
                    const card = allCards.find((c) => c.requestId === id);
                    if (card) moveCard(card, stage.key);
                  } catch {
                    // ignore malformed drag payloads
                  }
                }}
              >
                {stage.cards.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">No cards</p>
                ) : (
                  stage.cards.map((card) => (
                    <KanbanCardView
                      key={card.requestId ?? `county-${card.countyId}`}
                      card={card}
                      stages={stages.map((s) => ({ key: s.key, label: s.label }))}
                      onMove={(targetStage) => moveCard(card, targetStage)}
                      onSend={() => setSendingCard(card)}
                      onUpload={() => setUploadingCard(card)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <PipelineTable
          cards={filteredCards}
          stages={stages.map((s) => ({ key: s.key, label: s.label }))}
          onMove={moveCard}
          onSend={(card) => setSendingCard(card)}
          onUpload={(card) => setUploadingCard(card)}
        />
      )}

      {sendingCard && sendingCard.requestId !== null && (
        <SendEmailDialog
          listRequestId={sendingCard.requestId}
          recipientLabel={`${sendingCard.countyName} County primary contact`}
          alreadySent={sendingCard.emailSentAt !== null}
          onClose={() => setSendingCard(null)}
          onSent={invalidatePipeline}
        />
      )}

      {uploadingCard && uploadingCard.requestId !== null && (
        <FileUploadDialog
          listRequestId={uploadingCard.requestId}
          requestLabel={`${uploadingCard.countyName} County, ${uploadingCard.stateAbbreviation}`}
          onClose={() => setUploadingCard(null)}
          onChanged={invalidatePipeline}
        />
      )}
    </div>
  );
}

function MetricWidget({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: typeof Building2;
  color: string;
}) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`${color} p-2.5 rounded-lg`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

function KanbanCardView({
  card,
  stages,
  onMove,
  onSend,
  onUpload,
}: {
  card: PipelineCard;
  stages: { key: PipelineStageKey; label: string }[];
  onMove: (stage: PipelineStageKey) => void;
  onSend: () => void;
  onUpload: () => void;
}) {
  const draggable = card.requestId !== null;

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        if (card.requestId === null) return;
        e.dataTransfer.setData('text/plain', JSON.stringify({ id: card.requestId }));
      }}
      className={`bg-white rounded-lg border p-3 shadow-sm space-y-2 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link href={`/counties/${card.countyId}`} className="font-medium text-gray-900 hover:text-blue-700 text-sm">
            {card.countyName} County
          </Link>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="inline-flex px-1.5 py-0.5 text-[11px] font-medium rounded bg-gray-100 text-gray-600">
              {card.stateAbbreviation}
            </span>
            <PriorityBadge priority={card.priority} />
          </div>
        </div>
        {card.costAmount && (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-green-50 text-green-700 whitespace-nowrap">
            ${card.costAmount}
          </span>
        )}
      </div>

      {card.contact ? (
        <div className="text-xs text-gray-600">
          <p className="font-medium text-gray-700">{card.contact.name}</p>
          {card.contact.email && <p className="truncate">{card.contact.email}</p>}
        </div>
      ) : (
        <p className="text-xs text-amber-600">No primary contact yet</p>
      )}

      <p className={`text-xs font-medium ${agingColor(card)}`}>{agingLabel(card)}</p>

      <div className="flex items-center justify-between pt-1 border-t">
        <div className="flex items-center gap-2">
          {card.requestId !== null && (
            <>
              <button
                onClick={onSend}
                title="Send Email"
                className="text-gray-500 hover:text-blue-700"
                aria-label="Send Email"
              >
                <Mail className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onUpload}
                title="Upload File"
                className="text-gray-500 hover:text-blue-700"
                aria-label="Upload File"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <Link
            href={`/counties/${card.countyId}`}
            title="View Details"
            className="text-gray-500 hover:text-blue-700"
            aria-label="View Details"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
        {card.requestId !== null && (
          <select
            value={card.stage}
            onChange={(e) => onMove(e.target.value as PipelineStageKey)}
            className="text-[11px] border rounded px-1 py-0.5 bg-white text-gray-600"
            aria-label={`Move ${card.countyName} to stage`}
          >
            {stages.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function PipelineTable({
  cards,
  stages,
  onMove,
  onSend,
  onUpload,
}: {
  cards: PipelineCard[];
  stages: { key: PipelineStageKey; label: string }[];
  onMove: (card: PipelineCard, stage: PipelineStageKey) => void;
  onSend: (card: PipelineCard) => void;
  onUpload: (card: PipelineCard) => void;
}) {
  const stageLabel = (key: PipelineStageKey) => stages.find((s) => s.key === key)?.label ?? key;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-4 font-medium text-gray-700">County</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Contact</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Stage</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Priority</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Cost</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Aging</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700"></th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.requestId ?? `county-${card.countyId}`} className="border-b hover:bg-gray-50">
              <td className="py-3 px-4">
                <Link href={`/counties/${card.countyId}`} className="font-medium text-gray-900 hover:text-blue-700">
                  {card.countyName} County
                </Link>
                <span className="text-xs text-gray-500 ml-1">{card.stateAbbreviation}</span>
              </td>
              <td className="py-3 px-4 text-gray-600 text-sm">
                {card.contact ? (
                  <>
                    <p>{card.contact.name}</p>
                    {card.contact.email && <p className="text-xs text-gray-400">{card.contact.email}</p>}
                  </>
                ) : (
                  <span className="text-amber-600 text-xs">No primary contact</span>
                )}
              </td>
              <td className="py-3 px-4">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STAGE_COLORS[card.stage]}`}>
                  {stageLabel(card.stage)}
                </span>
              </td>
              <td className="py-3 px-4">
                <PriorityBadge priority={card.priority} />
              </td>
              <td className="py-3 px-4 text-gray-600 text-sm">{card.costAmount ? `$${card.costAmount}` : 'N/A'}</td>
              <td className={`py-3 px-4 text-sm font-medium ${agingColor(card)}`}>{agingLabel(card)}</td>
              <td className="py-3 px-4">
                <div className="flex items-center justify-end gap-3">
                  {card.requestId !== null && (
                    <>
                      <select
                        value={card.stage}
                        onChange={(e) => onMove(card, e.target.value as PipelineStageKey)}
                        className="text-xs border rounded px-1.5 py-1 bg-white text-gray-600"
                        aria-label={`Move ${card.countyName} to stage`}
                      >
                        {stages.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => onSend(card)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900"
                      >
                        <Mail className="w-3.5 h-3.5" /> Send
                      </button>
                      <button
                        onClick={() => onUpload(card)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
                      >
                        <Paperclip className="w-3.5 h-3.5" /> Files
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
