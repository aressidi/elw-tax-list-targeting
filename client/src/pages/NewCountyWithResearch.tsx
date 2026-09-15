import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type { StateWithCounts, TargetPriority } from '../types';
import { useToast } from '../components/Toast';
import ResearchReviewPanel from '../components/ResearchReviewPanel';

interface CreatedCounty {
  id: number;
  name: string;
  stateId: number;
}

export default function NewCountyWithResearch() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [stateId, setStateId] = useState('');
  const [name, setName] = useState('');
  const [targetPriority, setTargetPriority] = useState<TargetPriority>('medium');
  const [researchEnabled, setResearchEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdCounty, setCreatedCounty] = useState<{
    id: number;
    name: string;
    state: { abbreviation: string; name: string };
  } | null>(null);

  const { data: states } = useQuery({
    queryKey: ['states'],
    queryFn: async () => (await apiGet<StateWithCounts[]>('/api/states')).data ?? [],
  });

  const createCounty = useMutation({
    mutationFn: async () => {
      const created = (
        await apiSend<CreatedCounty>('/api/counties', 'POST', {
          stateId: parseInt(stateId, 10),
          name: name.trim(),
          targetPriority,
        })
      ).data;
      if (!created) throw new ApiError('County was not created', 500);

      if (researchEnabled) {
        // Trigger research but never let a research failure block county creation;
        // the review panel handles a failed/unavailable provider gracefully.
        try {
          await apiSend(`/api/counties/${created.id}/research`, 'POST');
        } catch {
          // Swallowed intentionally: the review panel shows manual-add either way.
        }
      }
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['states'] });
      queryClient.invalidateQueries({ queryKey: ['counties'] });
      queryClient.invalidateQueries({ queryKey: ['research-queue'] });
      const state = states?.find((s) => s.id === created.stateId);
      toast.showSuccess('County created.');
      if (researchEnabled && state) {
        setCreatedCounty({ id: created.id, name: created.name, state: { abbreviation: state.abbreviation, name: state.name } });
      } else {
        setLocation(`/counties/${created.id}`);
      }
    },
    onError: (err: unknown) => {
      toast.showError(err instanceof ApiError ? err.message : 'Failed to create county.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stateId) {
      setError('Please select a state.');
      return;
    }
    if (!name.trim()) {
      setError('County name is required.');
      return;
    }
    setError(null);
    createCounty.mutate();
  };

  return (
    <div>
      <Link href="/counties" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Counties
      </Link>

      <div className="max-w-lg">
        <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-600" />
          Add County with AI Research
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          Create a county and immediately kick off contact research. You'll review and approve any
          discovered contacts before they're saved.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-county-state" className="block text-sm font-medium text-gray-700 mb-1">
              State <span className="text-red-500">*</span>
            </label>
            <select
              id="new-county-state"
              value={stateId}
              onChange={(e) => setStateId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a state...</option>
              {states?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.abbreviation})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="new-county-name" className="block text-sm font-medium text-gray-700 mb-1">
              County name <span className="text-red-500">*</span>
            </label>
            <input
              id="new-county-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Franklin"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="new-county-priority" className="block text-sm font-medium text-gray-700 mb-1">
              Target priority
            </label>
            <select
              id="new-county-priority"
              value={targetPriority}
              onChange={(e) => setTargetPriority(e.target.value as TargetPriority)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={researchEnabled}
              onChange={(e) => setResearchEnabled(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Research contacts automatically after creating this county
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setLocation('/counties')}
              disabled={createCounty.isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createCounty.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {createCounty.isPending
                ? researchEnabled
                  ? 'Creating & Researching...'
                  : 'Creating...'
                : 'Create County'}
            </button>
          </div>
        </form>
      </div>

      {createdCounty && (
        <ResearchReviewPanel county={createdCounty} onClose={() => setLocation(`/counties/${createdCounty.id}`)} />
      )}
    </div>
  );
}
