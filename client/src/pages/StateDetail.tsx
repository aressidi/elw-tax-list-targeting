import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, MapPin, Plus, Search, Users, Eye, Pencil } from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type { CountySummary, StateWithCounties, TargetPriority } from '../types';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import PriorityBadge from '../components/PriorityBadge';
import Modal from '../components/Modal';
import CountyForm, { type CountyFormValues } from '../components/CountyForm';
import { useToast } from '../components/Toast';

function StatusSummaryCell({ summary }: { summary: Record<string, number> }) {
  const entries = Object.entries(summary).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);

  if (total === 0) {
    return <span className="text-xs text-gray-400">No requests</span>;
  }

  const shown = entries.slice(0, 2);
  const remaining = entries.length - shown.length;

  return (
    <div className="flex flex-wrap gap-1">
      {shown.map(([status, n]) => (
        <span
          key={status}
          className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700"
        >
          {n} {status.replace(/_/g, ' ')}
        </span>
      ))}
      {remaining > 0 && (
        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">
          +{remaining} more
        </span>
      )}
    </div>
  );
}

function toCountyPayload(values: CountyFormValues) {
  return {
    name: values.name.trim(),
    countySeat: values.countySeat.trim() || null,
    fipsCode: values.fipsCode.trim() || null,
    population: values.population === '' ? null : Number(values.population),
    targetPriority: values.targetPriority,
  };
}

export default function StateDetail() {
  const { abbreviation } = useParams<{ abbreviation: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TargetPriority | 'all'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCounty, setEditingCounty] = useState<CountySummary | null>(null);

  const { data: state, isLoading, isError, refetch } = useQuery({
    queryKey: ['state', abbreviation],
    queryFn: async () => (await apiGet<StateWithCounties>(`/api/states/${abbreviation}`)).data ?? null,
    enabled: !!abbreviation,
  });

  const invalidateAfterCountyChange = () => {
    queryClient.invalidateQueries({ queryKey: ['state', abbreviation] });
    queryClient.invalidateQueries({ queryKey: ['states'] });
    queryClient.invalidateQueries({ queryKey: ['counties'] });
  };

  const createCounty = useMutation({
    mutationFn: (values: CountyFormValues) =>
      apiSend('/api/counties', 'POST', { stateId: state?.id, ...toCountyPayload(values) }),
    onSuccess: () => {
      invalidateAfterCountyChange();
      setShowAddModal(false);
      toast.showSuccess('County added.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to add county.');
    },
  });

  const updateCounty = useMutation({
    mutationFn: ({ id, values }: { id: number; values: CountyFormValues }) =>
      apiSend(`/api/counties/${id}`, 'PATCH', toCountyPayload(values)),
    onSuccess: () => {
      invalidateAfterCountyChange();
      setEditingCounty(null);
      toast.showSuccess('County updated.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to update county.');
    },
  });

  const filteredCounties = useMemo(() => {
    if (!state) return [];
    const term = search.trim().toLowerCase();
    return state.counties.filter((c) => {
      const matchesSearch = !term || c.name.toLowerCase().includes(term);
      const matchesPriority = priorityFilter === 'all' || c.targetPriority === priorityFilter;
      return matchesSearch && matchesPriority;
    });
  }, [state, search, priorityFilter]);

  if (isLoading) return <LoadingState label="Loading state..." />;
  if (isError || !state) {
    return <ErrorState message="Failed to load this state." onRetry={() => refetch()} />;
  }

  return (
    <div>
      <Link href="/states" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to States
      </Link>

      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
            <span className="text-blue-700 font-bold text-base">{state.abbreviation}</span>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{state.name}</h2>
            <p className="text-sm text-gray-500">{state.counties.length} counties</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add County
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search counties by name..."
            aria-label="Search counties"
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as TargetPriority | 'all')}
          aria-label="Filter by target priority"
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {filteredCounties.length === 0 ? (
        <EmptyState
          title={state.counties.length === 0 ? 'No counties yet' : 'No counties match your filters'}
          description={state.counties.length === 0 ? 'Add the first county for this state.' : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium text-gray-700">County</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">County Seat</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Priority</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Contacts</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Requests</th>
                <th className="text-right py-3 px-4 font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCounties.map((county) => (
                <tr key={county.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-900">{county.name}</td>
                  <td className="py-3 px-4 text-gray-600">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-gray-400" />
                      {county.countySeat || 'N/A'}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <PriorityBadge priority={county.targetPriority} />
                  </td>
                  <td className="py-3 px-4 text-gray-600">
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-gray-400" />
                      {county.contactCount}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <StatusSummaryCell summary={county.requestStatusSummary} />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/counties/${county.id}`}
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </Link>
                      <button
                        onClick={() => setEditingCounty(county)}
                        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                      >
                        <Pencil className="w-4 h-4" />
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <Modal title="Add County" onClose={() => setShowAddModal(false)}>
          <CountyForm
            stateName={state.name}
            submitting={createCounty.isPending}
            submitLabel="Add County"
            onSubmit={(values) => createCounty.mutate(values)}
            onCancel={() => setShowAddModal(false)}
          />
        </Modal>
      )}

      {editingCounty && (
        <Modal title={`Edit ${editingCounty.name}`} onClose={() => setEditingCounty(null)}>
          <CountyForm
            stateName={state.name}
            initialValues={{
              name: editingCounty.name,
              countySeat: editingCounty.countySeat ?? '',
              fipsCode: editingCounty.fipsCode ?? '',
              population: editingCounty.population != null ? String(editingCounty.population) : '',
              targetPriority: editingCounty.targetPriority ?? 'medium',
            }}
            submitting={updateCounty.isPending}
            submitLabel="Save Changes"
            onSubmit={(values) => updateCounty.mutate({ id: editingCounty.id, values })}
            onCancel={() => setEditingCounty(null)}
          />
        </Modal>
      )}
    </div>
  );
}
