import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft, Info } from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type { CountyDetail, FoiaTemplate, State } from '../types';
import { LoadingState, ErrorState } from '../components/QueryState';
import { useToast } from '../components/Toast';
import {
  TEMPLATE_VARIABLES,
  DEFAULT_SAMPLE_DATA,
  analyzeTemplateVariables,
  segmentTemplateText,
  type TemplateSampleData,
  type TemplateSegment,
} from '@shared/templateVariables';

const NAME_MAX = 100;
const SUBJECT_MAX = 500;
const BODY_MAX = 10000;

interface CountyOption {
  id: number;
  name: string;
  state: { id: number; abbreviation: string; name: string };
}

type Field = 'subject' | 'body';

function renderSegments(segments: TemplateSegment[]) {
  return segments.map((segment, i) => {
    if (segment.type === 'text') return <span key={i}>{segment.value}</span>;
    if (segment.type === 'known') {
      return (
        <mark key={i} className="bg-blue-100 text-blue-900 rounded px-0.5" title={`{{${segment.key}}}`}>
          {segment.value}
        </mark>
      );
    }
    return (
      <mark
        key={i}
        className="bg-red-100 text-red-700 rounded px-0.5"
        title={`Unknown variable: {{${segment.key}}}`}
      >
        {segment.value}
      </mark>
    );
  });
}

export default function TemplateEditor() {
  const params = useParams<{ id?: string }>();
  const id = params.id;
  const isEdit = !!id;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState('');
  const [subjectLine, setSubjectLine] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedForId, setLoadedForId] = useState<string | undefined>(undefined);

  const [viewMode, setViewMode] = useState<'raw' | 'preview'>('preview');
  const [sampleSource, setSampleSource] = useState<'sample' | 'real'>('sample');
  const [selectedStateAbbr, setSelectedStateAbbr] = useState('');
  const [selectedCountyId, setSelectedCountyId] = useState('');
  const [selectedContactId, setSelectedContactId] = useState('');
  const [customNote, setCustomNote] = useState('');

  const [lastFocusedField, setLastFocusedField] = useState<Field>('body');
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const { data: existing, isLoading, isError, refetch } = useQuery({
    queryKey: ['template', id],
    queryFn: async () => (await apiGet<FoiaTemplate>(`/api/templates/${id}`)).data ?? null,
    enabled: isEdit,
  });

  useEffect(() => {
    if (existing && loadedForId !== id) {
      setName(existing.name);
      setSubjectLine(existing.subjectLine);
      setBodyText(existing.bodyText);
      setIsDefault(existing.isDefault);
      setLoadedForId(id);
    }
  }, [existing, id, loadedForId]);

  const { data: states } = useQuery({
    queryKey: ['states'],
    queryFn: async () => (await apiGet<State[]>('/api/states')).data ?? [],
  });

  const { data: counties } = useQuery({
    queryKey: ['counties', 'template-sample'],
    queryFn: async () => (await apiGet<CountyOption[]>('/api/counties?limit=200')).data ?? [],
  });

  const countyOptions = useMemo(
    () => (counties ?? []).filter((c) => !selectedStateAbbr || c.state.abbreviation === selectedStateAbbr),
    [counties, selectedStateAbbr]
  );

  const { data: countyDetail } = useQuery({
    queryKey: ['county', selectedCountyId],
    queryFn: async () => (await apiGet<CountyDetail>(`/api/counties/${selectedCountyId}`)).data ?? null,
    enabled: sampleSource === 'real' && !!selectedCountyId,
  });

  const selectedCounty = countyOptions.find((c) => String(c.id) === selectedCountyId);
  const selectedContact = countyDetail?.taxOfficials.find((t) => String(t.id) === selectedContactId);

  const sampleData: TemplateSampleData = useMemo(() => {
    if (sampleSource === 'sample' || !selectedCounty) {
      return { ...DEFAULT_SAMPLE_DATA, customNote };
    }
    return {
      countyName: selectedCounty.name,
      stateName: selectedCounty.state.name,
      stateAbbr: selectedCounty.state.abbreviation,
      officialName: selectedContact?.fullName ?? DEFAULT_SAMPLE_DATA.officialName,
      officialTitle: selectedContact?.title ?? DEFAULT_SAMPLE_DATA.officialTitle,
      customNote,
    };
  }, [sampleSource, selectedCounty, selectedContact, customNote]);

  const variableAnalysis = useMemo(() => analyzeTemplateVariables(subjectLine, bodyText), [subjectLine, bodyText]);
  const subjectSegments = useMemo(() => segmentTemplateText(subjectLine, sampleData), [subjectLine, sampleData]);
  const bodySegments = useMemo(() => segmentTemplateText(bodyText, sampleData), [bodyText, sampleData]);

  const insertVariable = (key: string) => {
    const token = `{{${key}}}`;
    if (lastFocusedField === 'subject') {
      const el = subjectRef.current;
      if (!el) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      setSubjectLine(el.value.slice(0, start) + token + el.value.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      const el = bodyRef.current;
      if (!el) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      setBodyText(el.value.slice(0, start) + token + el.value.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), subjectLine: subjectLine.trim(), bodyText, isDefault };
      if (isEdit) return (await apiSend<FoiaTemplate>(`/api/templates/${id}`, 'PATCH', payload)).data;
      return (await apiSend<FoiaTemplate>('/api/templates', 'POST', payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['template', id] });
      toast.showSuccess(isEdit ? 'Template updated.' : 'Template created.');
      setLocation('/templates');
    },
    onError: (err: unknown) => {
      toast.showError(err instanceof ApiError ? err.message : 'Failed to save template.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Name is required.');
    if (name.length > NAME_MAX) return setError(`Name must be ${NAME_MAX} characters or fewer.`);
    if (!subjectLine.trim()) return setError('Subject line is required.');
    if (subjectLine.length > SUBJECT_MAX) return setError(`Subject line must be ${SUBJECT_MAX} characters or fewer.`);
    if (!bodyText.trim()) return setError('Body is required.');
    if (bodyText.length > BODY_MAX) return setError(`Body must be ${BODY_MAX} characters or fewer.`);
    if (variableAnalysis.unknown.length > 0) {
      return setError(`Unknown template variable(s): ${variableAnalysis.unknown.map((v) => `{{${v}}}`).join(', ')}`);
    }
    if (variableAnalysis.known.length === 0) {
      return setError('Template must use at least one supported variable.');
    }
    setError(null);
    save.mutate();
  };

  const lockedAsDefault = isEdit && existing?.isDefault === true;

  if (isEdit && isLoading) return <LoadingState label="Loading template..." />;
  if (isEdit && isError) return <ErrorState message="Failed to load template." onRetry={() => refetch()} />;

  return (
    <div>
      <Link href="/templates" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Templates
      </Link>

      <h2 className="text-2xl font-bold text-gray-900 mb-6">{isEdit ? 'Edit Template' : 'Create New Template'}</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="template-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="template-name"
              type="text"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard FOIA Request"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">{name.length}/{NAME_MAX}</p>
          </div>

          <div>
            <label htmlFor="template-subject" className="block text-sm font-medium text-gray-700 mb-1">
              Subject line <span className="text-red-500">*</span>
            </label>
            <input
              id="template-subject"
              ref={subjectRef}
              type="text"
              value={subjectLine}
              maxLength={SUBJECT_MAX}
              onFocus={() => setLastFocusedField('subject')}
              onChange={(e) => setSubjectLine(e.target.value)}
              placeholder="e.g. FOIA Request - Tax Delinquent Property List - {{county_name}} County"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">{subjectLine.length}/{SUBJECT_MAX}</p>
          </div>

          <div>
            <label htmlFor="template-body" className="block text-sm font-medium text-gray-700 mb-1">
              Body <span className="text-red-500">*</span>
            </label>
            <textarea
              id="template-body"
              ref={bodyRef}
              value={bodyText}
              maxLength={BODY_MAX}
              onFocus={() => setLastFocusedField('body')}
              onChange={(e) => setBodyText(e.target.value)}
              rows={16}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">{bodyText.length}/{BODY_MAX}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 uppercase mb-2">Insert variable</p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVariable(v.key)}
                  title={v.description}
                  className="inline-flex items-center px-2.5 py-1 text-xs font-mono font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full hover:bg-blue-100"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>

          <label
            className={`flex items-center gap-2 text-sm ${lockedAsDefault ? 'text-gray-400' : 'text-gray-700'}`}
            title={lockedAsDefault ? 'Set another template as default to change this' : undefined}
          >
            <input
              type="checkbox"
              checked={isDefault}
              disabled={lockedAsDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
            />
            Set as default template
          </label>

          {(variableAnalysis.unknown.length > 0 || variableAnalysis.known.length === 0) && (
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {variableAnalysis.unknown.length > 0
                  ? `Unknown variable(s): ${variableAnalysis.unknown.map((v) => `{{${v}}}`).join(', ')}`
                  : 'This template does not use any variables yet.'}
              </span>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setLocation('/templates')}
              disabled={save.isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {save.isPending ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </form>

        <div className="border rounded-lg p-4 bg-gray-50 h-fit sticky top-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">Preview</h3>
            <div className="inline-flex rounded-lg border bg-white p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('raw')}
                className={`px-3 py-1 text-xs font-medium rounded-md ${
                  viewMode === 'raw' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Raw
              </button>
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={`px-3 py-1 text-xs font-medium rounded-md ${
                  viewMode === 'preview' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Preview
              </button>
            </div>
          </div>

          {viewMode === 'preview' && (
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-2 text-xs">
                <select
                  value={sampleSource}
                  onChange={(e) => setSampleSource(e.target.value as 'sample' | 'real')}
                  className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="sample">Sample data</option>
                  <option value="real">Real county/contact</option>
                </select>
                {sampleSource === 'real' && (
                  <>
                    <select
                      value={selectedStateAbbr}
                      onChange={(e) => {
                        setSelectedStateAbbr(e.target.value);
                        setSelectedCountyId('');
                        setSelectedContactId('');
                      }}
                      className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All states</option>
                      {(states ?? []).map((s) => (
                        <option key={s.id} value={s.abbreviation}>
                          {s.abbreviation}
                        </option>
                      ))}
                    </select>
                    <select
                      value={selectedCountyId}
                      onChange={(e) => {
                        setSelectedCountyId(e.target.value);
                        setSelectedContactId('');
                      }}
                      className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select county...</option>
                      {countyOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {selectedCountyId && (
                      <select
                        value={selectedContactId}
                        onChange={(e) => setSelectedContactId(e.target.value)}
                        className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">No contact</option>
                        {(countyDetail?.taxOfficials ?? []).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.fullName}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                )}
              </div>
              <input
                type="text"
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                placeholder="Custom note (optional, fills {{custom_note}})"
                className="w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div className="bg-white border rounded-lg p-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase">Subject</label>
              <p className="text-sm text-gray-900 mt-1 font-mono whitespace-pre-wrap break-words">
                {viewMode === 'raw' ? subjectLine || <span className="text-gray-400">(empty)</span> : renderSegments(subjectSegments)}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase">Body</label>
              <pre className="text-sm text-gray-900 mt-1 font-mono whitespace-pre-wrap break-words font-sans">
                {viewMode === 'raw' ? bodyText || <span className="text-gray-400">(empty)</span> : renderSegments(bodySegments)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
