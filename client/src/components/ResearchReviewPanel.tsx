import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, RefreshCw, Sparkles, Star, Trash2 } from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type { ConfidenceLevel, ResearchResultsResponse } from '../types';
import Modal from './Modal';
import { LoadingState, ErrorState } from './QueryState';
import { useToast } from './Toast';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TITLE_SUGGESTIONS = ['Tax Collector', 'County Treasurer', 'County Assessor', 'County Clerk'];
const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
};

interface ReviewRow {
  key: string;
  fullName: string;
  title: string;
  emailAddress: string;
  phoneNumber: string;
  websiteUrl: string;
  confidence: ConfidenceLevel;
  sourceUrl: string;
  sourceSnippet: string;
  include: boolean;
  isPrimary: boolean;
  isManual: boolean;
}

let manualRowSeq = 0;
function blankRow(): ReviewRow {
  return {
    key: `manual-${++manualRowSeq}`,
    fullName: '',
    title: '',
    emailAddress: '',
    phoneNumber: '',
    websiteUrl: '',
    confidence: 'low',
    sourceUrl: '',
    sourceSnippet: '',
    include: true,
    isPrimary: false,
    isManual: true,
  };
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

interface ResearchReviewPanelProps {
  county: { id: number; name: string; state: { abbreviation: string; name: string } };
  onClose: () => void;
}

export default function ResearchReviewPanel({ county, onClose }: ResearchReviewPanelProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [initializedForRunId, setInitializedForRunId] = useState<number | null | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['research-results', county.id],
    queryFn: async () =>
      (await apiGet<ResearchResultsResponse>(`/api/counties/${county.id}/research-results`)).data ?? null,
  });

  const latestRun = data?.runs?.[0] ?? null;

  useEffect(() => {
    const runId = latestRun?.id ?? null;
    if (initializedForRunId === runId) return;
    setInitializedForRunId(runId);
    const candidates = latestRun?.resultData?.candidates ?? [];
    setRows(
      candidates.map((c, index) => ({
        key: `candidate-${runId}-${index}`,
        fullName: c.fullName,
        title: c.title ?? '',
        emailAddress: c.emailAddress ?? '',
        phoneNumber: c.phoneNumber ?? '',
        websiteUrl: c.websiteUrl ?? '',
        confidence: c.confidence,
        sourceUrl: c.sourceUrl ?? '',
        sourceSnippet: c.sourceSnippet ?? '',
        include: true,
        isPrimary: false,
        isManual: false,
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRun?.id]);

  const invalidateAfterChange = () => {
    queryClient.invalidateQueries({ queryKey: ['research-results', county.id] });
    queryClient.invalidateQueries({ queryKey: ['research-queue'] });
    queryClient.invalidateQueries({ queryKey: ['county', county.id] });
    queryClient.invalidateQueries({ queryKey: ['counties'] });
    queryClient.invalidateQueries({ queryKey: ['states'] });
  };

  const runResearch = useMutation({
    mutationFn: (force: boolean) =>
      apiSend(`/api/counties/${county.id}/research`, 'POST', { provider: 'mock', force }),
    onSuccess: () => {
      invalidateAfterChange();
      toast.showSuccess('Research complete. Review the results below.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to trigger research.');
    },
  });

  const saveApproved = useMutation({
    mutationFn: (payload: { runId: number | null; contacts: Record<string, unknown>[] }) =>
      apiSend(`/api/counties/${county.id}/contacts/ai-import`, 'POST', {
        runId: payload.runId,
        contacts: payload.contacts,
      }),
    onSuccess: (result) => {
      invalidateAfterChange();
      const count = Array.isArray(result.data) ? result.data.length : 0;
      toast.showSuccess(`Saved ${count} contact${count === 1 ? '' : 's'}.`);
      onClose();
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to save approved contacts.');
    },
  });

  const skipCounty = useMutation({
    mutationFn: () => apiSend('/api/research/bulk', 'POST', { countyIds: [county.id], action: 'skip' }),
    onSuccess: () => {
      invalidateAfterChange();
      toast.showSuccess('Marked as skipped.');
      onClose();
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to skip county.');
    },
  });

  const updateRow = (key: string, patch: Partial<ReviewRow>) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) {
          return patch.isPrimary ? { ...row, isPrimary: false } : row;
        }
        return { ...row, ...patch };
      })
    );
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((row) => row.key !== key));
  };

  const handleSave = () => {
    setFormError(null);
    const included = rows.filter((r) => r.include);

    if (included.length === 0) {
      setFormError('Select at least one contact to include, or add one manually.');
      return;
    }
    for (const row of included) {
      if (!row.fullName.trim()) {
        setFormError('Every included contact needs a name.');
        return;
      }
      if (row.emailAddress && !EMAIL_REGEX.test(row.emailAddress.trim())) {
        setFormError(`"${row.emailAddress}" is not a valid email address.`);
        return;
      }
      if (row.websiteUrl && !isValidUrl(row.websiteUrl.trim())) {
        setFormError(`"${row.websiteUrl}" is not a valid website URL.`);
        return;
      }
    }
    if (included.filter((r) => r.isPrimary).length > 1) {
      setFormError('Only one contact can be marked primary.');
      return;
    }

    saveApproved.mutate({
      runId: latestRun?.id ?? null,
      contacts: included.map((r) => ({
        fullName: r.fullName.trim(),
        title: r.title.trim() || null,
        emailAddress: r.emailAddress.trim() || null,
        phoneNumber: r.phoneNumber.trim() || null,
        websiteUrl: r.websiteUrl.trim() || null,
        confidence: r.isManual ? null : r.confidence,
        sourceUrl: r.sourceUrl.trim() || null,
        sourceSnippet: r.sourceSnippet.trim() || null,
        isPrimary: r.isPrimary,
      })),
    });
  };

  const busy = runResearch.isPending || saveApproved.isPending || skipCounty.isPending;

  return (
    <Modal
      title={`Research Contacts — ${county.name} County, ${county.state.abbreviation}`}
      onClose={onClose}
      widthClassName="max-w-3xl"
    >
      <datalist id="title-suggestions">
        {TITLE_SUGGESTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {isLoading && <LoadingState label="Loading research results..." />}
      {isError && <ErrorState message="Failed to load research results." onRetry={() => refetch()} />}

      {!isLoading && !isError && (
        <div className="space-y-4">
          {latestRun?.isDemo && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
              <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                These are <strong>demo results</strong> from the mock research provider — not verified
                contact information. Configure a real provider before relying on this data.
              </span>
            </div>
          )}

          {latestRun?.status === 'failed' && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{latestRun.errorMessage || 'The last research attempt failed.'}</span>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-gray-500">
              {rows.length === 0
                ? 'No candidates yet. Trigger research or add a contact manually.'
                : `${rows.length} candidate${rows.length === 1 ? '' : 's'} — review, edit, and select which to save.`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => runResearch.mutate(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${runResearch.isPending ? 'animate-spin' : ''}`} />
                {runResearch.isPending ? 'Researching...' : rows.length === 0 ? 'Research Contacts' : 'Research Again'}
              </button>
              <button
                onClick={() => setRows((prev) => [...prev, blankRow()])}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Manually
              </button>
            </div>
          </div>

          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            {rows.map((row) => (
              <div key={row.key} className="border rounded-lg p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => updateRow(row.key, { include: e.target.checked })}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Include this contact
                  </label>
                  <div className="flex items-center gap-3">
                    {!row.isManual && (
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full capitalize ${CONFIDENCE_COLORS[row.confidence]}`}>
                        {row.confidence} confidence
                      </span>
                    )}
                    <button
                      onClick={() => updateRow(row.key, { isPrimary: !row.isPrimary })}
                      title={row.isPrimary ? 'Unset as primary' : 'Make primary contact'}
                      className={`p-1 rounded hover:bg-gray-100 ${row.isPrimary ? 'text-yellow-500' : 'text-gray-300'}`}
                    >
                      <Star className={`w-4 h-4 ${row.isPrimary ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      onClick={() => removeRow(row.key)}
                      title="Remove candidate"
                      className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={row.fullName}
                    onChange={(e) => updateRow(row.key, { fullName: e.target.value })}
                    placeholder="Full name *"
                    aria-label="Full name"
                    className="border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    list="title-suggestions"
                    value={row.title}
                    onChange={(e) => updateRow(row.key, { title: e.target.value })}
                    placeholder="Title"
                    aria-label="Title"
                    className="border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="email"
                    value={row.emailAddress}
                    onChange={(e) => updateRow(row.key, { emailAddress: e.target.value })}
                    placeholder="Email address"
                    aria-label="Email address"
                    className="border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="tel"
                    value={row.phoneNumber}
                    onChange={(e) => updateRow(row.key, { phoneNumber: e.target.value })}
                    placeholder="Phone number"
                    aria-label="Phone number"
                    className="border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="url"
                    value={row.websiteUrl}
                    onChange={(e) => updateRow(row.key, { websiteUrl: e.target.value })}
                    placeholder="Website URL"
                    aria-label="Website URL"
                    className="border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 col-span-2"
                  />
                </div>

                {!row.isManual && (row.sourceUrl || row.sourceSnippet) && (
                  <div className="mt-2 pt-2 border-t text-xs text-gray-500 space-y-1">
                    {row.sourceUrl && (
                      <p>
                        Source:{' '}
                        <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                          {row.sourceUrl}
                        </a>
                      </p>
                    )}
                    {row.sourceSnippet && <p className="italic">{row.sourceSnippet}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex justify-between items-center pt-2 border-t">
            <button
              onClick={() => skipCounty.mutate()}
              disabled={busy}
              className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
            >
              {skipCounty.isPending ? 'Skipping...' : 'Skip This County'}
            </button>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={busy || rows.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {saveApproved.isPending ? 'Saving...' : 'Save Approved Contacts'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
