import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Search, Wand2, XCircle } from 'lucide-react';
import { STANDARD_FIELDS } from '@shared/dataFields';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type {
  FieldMapping,
  FieldMappingResponse,
  MapFieldsResponse,
  ParseFileResponse,
  ParsedRecordPreview,
  ProcessedListRecord,
  StandardFieldId,
  ValidationSummary,
} from '../types';
import Modal from './Modal';
import { LoadingState, ErrorState } from './QueryState';
import { useToast } from './Toast';

interface FieldMappingModalProps {
  fileId: number;
  fileName: string;
  onClose: () => void;
  onChanged?: () => void;
}

const RECORDS_PAGE_SIZE = 25;

type RecordStatusFilter = 'all' | 'valid' | 'error' | 'duplicate';

const STATUS_FILTERS: { value: RecordStatusFilter; label: string }[] = [
  { value: 'all', label: 'All records' },
  { value: 'valid', label: 'Valid' },
  { value: 'error', label: 'Errors' },
  { value: 'duplicate', label: 'Duplicates' },
];

function emptyMapping(): FieldMapping {
  const mapping: FieldMapping = {};
  for (const field of STANDARD_FIELDS) mapping[field.id] = null;
  return mapping;
}

function SummaryCard({ summary }: { summary: ValidationSummary }) {
  const tiles: { label: string; value: number; className: string }[] = [
    { label: 'Total', value: summary.totalRecords, className: 'text-gray-900' },
    { label: 'Valid', value: summary.validRecords, className: 'text-green-700' },
    { label: 'Warnings', value: summary.warningRecords, className: 'text-yellow-700' },
    { label: 'Errors', value: summary.errorRecords, className: 'text-red-700' },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {tiles.map((tile) => (
        <div key={tile.label} className="border rounded-lg px-3 py-2 text-center bg-gray-50">
          <p className={`text-xl font-semibold ${tile.className}`}>{tile.value}</p>
          <p className="text-xs text-gray-500">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ record }: { record: { isValid: boolean; isDuplicate: boolean } }) {
  if (!record.isValid) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
        <XCircle className="w-3 h-3" /> Error
      </span>
    );
  }
  if (record.isDuplicate) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700">
        <AlertTriangle className="w-3 h-3" /> Duplicate
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
      <CheckCircle2 className="w-3 h-3" /> Valid
    </span>
  );
}

function RecordRow({ record }: { record: ParsedRecordPreview | ProcessedListRecord }) {
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <StatusBadge record={record} />
      </td>
      {STANDARD_FIELDS.map((field) => (
        <td key={field.id} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[200px] truncate">
          {record.mappedData[field.id] ?? <span className="text-gray-300">—</span>}
        </td>
      ))}
      <td className="px-3 py-2 text-xs text-gray-500 max-w-[240px]">
        {record.validationErrors && record.validationErrors.length > 0 ? record.validationErrors.join('; ') : ''}
      </td>
    </tr>
  );
}

export default function FieldMappingModal({ fileId, fileName, onClose, onChanged }: FieldMappingModalProps) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'mapping' | 'records'>('mapping');
  const [draft, setDraft] = useState<FieldMapping>(emptyMapping());
  const [preview, setPreview] = useState<ParseFileResponse | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<RecordStatusFilter>('all');
  const [search, setSearch] = useState('');

  const mappingQuery = useQuery({
    queryKey: ['processed-lists', fileId, 'mapping'],
    queryFn: async () => (await apiGet<FieldMappingResponse>(`/api/processed-lists/${fileId}/mapping`)).data ?? null,
  });

  const parseMutation = useMutation({
    mutationFn: async () => (await apiSend<ParseFileResponse>(`/api/processed-lists/${fileId}/parse`, 'POST')).data ?? null,
    onSuccess: (data) => {
      if (!data) return;
      setPreview(data);
      if (data.mapping) setDraft({ ...emptyMapping(), ...data.mapping });
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to parse file.');
    },
  });

  // On first load: if a mapping was already saved, use it as the starting
  // draft. Otherwise auto-run the parser to suggest one.
  useEffect(() => {
    if (!mappingQuery.data) return;
    if (mappingQuery.data.mapping) {
      setDraft({ ...emptyMapping(), ...mappingQuery.data.mapping });
    } else if (!preview && !parseMutation.isPending) {
      parseMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingQuery.data]);

  const headers = preview?.headers ?? mappingQuery.data?.headers ?? [];
  const summary = preview?.validationSummary ?? mappingQuery.data?.validationSummary ?? null;
  const warnings = preview?.warnings ?? mappingQuery.data?.warnings ?? [];
  const sampleRecords = preview?.sampleRecords ?? [];

  const mapFieldsMutation = useMutation({
    mutationFn: async () =>
      (await apiSend<MapFieldsResponse>(`/api/processed-lists/${fileId}/map-fields`, 'POST', { mapping: draft })).data,
    onSuccess: (data) => {
      toast.showSuccess(`Processed ${data?.validationSummary.totalRecords ?? 0} records.`);
      queryClient.invalidateQueries({ queryKey: ['processed-lists', fileId, 'mapping'] });
      queryClient.invalidateQueries({ queryKey: ['processed-lists', fileId, 'records'] });
      queryClient.invalidateQueries({ queryKey: ['list-requests'] });
      setView('records');
      setPage(1);
      onChanged?.();
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to save field mapping.');
    },
  });

  const recordsQuery = useQuery({
    queryKey: ['processed-lists', fileId, 'records', page, statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(RECORDS_PAGE_SIZE) });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await apiGet<ProcessedListRecord[]>(`/api/processed-lists/${fileId}/records?${params.toString()}`);
      const pagination = (res as unknown as { pagination?: { total: number; totalPages: number } }).pagination;
      return { records: res.data ?? [], pagination };
    },
    enabled: view === 'records',
  });

  const usedHeaders = new Set(Object.values(draft).filter((v): v is string => !!v));
  const hasHeaders = headers.length > 0;

  const updateMapping = (fieldId: StandardFieldId, value: string) => {
    setDraft((prev) => {
      const next: FieldMapping = { ...prev };
      next[fieldId] = value || null;
      return next;
    });
  };

  return (
    <Modal title={`Map Fields & Validate — ${fileName}`} onClose={onClose} widthClassName="max-w-5xl">
      <div className="space-y-5">
        <div className="flex items-center gap-2 border-b pb-3">
          <button
            onClick={() => setView('mapping')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
              view === 'mapping' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Field Mapping
          </button>
          <button
            onClick={() => setView('records')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
              view === 'records' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Records
          </button>
        </div>

        {mappingQuery.isLoading && <LoadingState label="Loading file..." />}
        {mappingQuery.isError && <ErrorState message="Failed to load file." onRetry={() => mappingQuery.refetch()} />}

        {mappingQuery.data && (
          <>
            {warnings.length > 0 && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 space-y-1">
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs text-yellow-800 flex gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            )}

            {!hasHeaders && (
              <p className="text-sm text-gray-500">
                No columns could be detected in this file yet. {parseMutation.isPending ? 'Parsing…' : ''}
              </p>
            )}

            {view === 'mapping' && hasHeaders && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium text-gray-500 uppercase">Map raw columns to standard fields</h4>
                  <button
                    onClick={() => parseMutation.mutate()}
                    disabled={parseMutation.isPending}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    {parseMutation.isPending ? 'Analyzing…' : 'Auto-suggest mapping'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {STANDARD_FIELDS.map((field) => (
                    <div key={field.id} className="flex items-center gap-3">
                      <label className="text-sm text-gray-700 w-44 shrink-0">
                        {field.label}
                        {field.critical && <span className="text-red-500"> *</span>}
                      </label>
                      <select
                        value={draft[field.id as StandardFieldId] ?? ''}
                        onChange={(e) => updateMapping(field.id as StandardFieldId, e.target.value)}
                        className="flex-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">— Not mapped —</option>
                        {headers.map((h) => (
                          <option
                            key={h}
                            value={h}
                            disabled={usedHeaders.has(h) && draft[field.id as StandardFieldId] !== h}
                          >
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                {summary && (
                  <div>
                    <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                      Validation preview {preview ? `(first ${sampleRecords.length} of ${preview.rowCount})` : ''}
                    </h4>
                    <SummaryCard summary={summary} />
                  </div>
                )}

                {sampleRecords.length > 0 && (
                  <div className="overflow-x-auto border rounded-lg max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          {STANDARD_FIELDS.map((field) => (
                            <th
                              key={field.id}
                              className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                            >
                              {field.label}
                            </th>
                          ))}
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issues</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sampleRecords.map((record, i) => (
                          <RecordRow key={i} record={record} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800">
                    Close
                  </button>
                  <button
                    onClick={() => mapFieldsMutation.mutate()}
                    disabled={mapFieldsMutation.isPending || !draft.apn || !draft.owner_name}
                    title={!draft.apn || !draft.owner_name ? 'APN and Owner Name must be mapped' : undefined}
                    className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {mapFieldsMutation.isPending ? 'Processing…' : 'Approve & Process'}
                  </button>
                </div>
              </div>
            )}

            {view === 'records' && (
              <div className="space-y-4">
                {summary && <SummaryCard summary={summary} />}

                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Search owner, APN, address..."
                      className="w-full text-sm border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value as RecordStatusFilter);
                      setPage(1);
                    }}
                    className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {STATUS_FILTERS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                {recordsQuery.isLoading && <LoadingState label="Loading records..." />}
                {recordsQuery.isError && (
                  <ErrorState message="Failed to load records." onRetry={() => recordsQuery.refetch()} />
                )}

                {recordsQuery.data && recordsQuery.data.records.length === 0 && (
                  <p className="text-sm text-gray-500 py-8 text-center">
                    No records yet. Map fields and click "Approve &amp; Process" to save records.
                  </p>
                )}

                {recordsQuery.data && recordsQuery.data.records.length > 0 && (
                  <>
                    <div className="overflow-x-auto border rounded-lg max-h-96 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                            {STANDARD_FIELDS.map((field) => (
                              <th
                                key={field.id}
                                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                              >
                                {field.label}
                              </th>
                            ))}
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issues</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recordsQuery.data.records.map((record) => (
                            <RecordRow key={record.id} record={record} />
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {recordsQuery.data.pagination && recordsQuery.data.pagination.totalPages > 1 && (
                      <div className="flex items-center justify-between text-sm text-gray-600">
                        <span>
                          Page {page} of {recordsQuery.data.pagination.totalPages} ({recordsQuery.data.pagination.total}{' '}
                          records)
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page <= 1}
                            className="p-1.5 border border-gray-300 rounded-lg disabled:opacity-40"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setPage((p) => Math.min(recordsQuery.data!.pagination!.totalPages, p + 1))}
                            disabled={page >= recordsQuery.data.pagination.totalPages}
                            className="p-1.5 border border-gray-300 rounded-lg disabled:opacity-40"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setView('mapping')} className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800">
                    Edit mapping
                  </button>
                  <button onClick={onClose} className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                    Done
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
