import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileDown, History } from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type { ExportPreviewResponse, MailingListExport } from '../types';
import Modal from './Modal';
import { LoadingState, ErrorState } from './QueryState';
import { useToast } from './Toast';

interface ExportModalProps {
  fileId: number;
  fileName: string;
  onClose: () => void;
  onChanged?: () => void;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export default function ExportModal({ fileId, fileName, onClose, onChanged }: ExportModalProps) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [validOnly, setValidOnly] = useState(true);

  const previewParams = new URLSearchParams({
    includeDuplicates: String(includeDuplicates),
    validOnly: String(validOnly),
  });

  const previewQuery = useQuery({
    queryKey: ['processed-lists', fileId, 'export-preview', includeDuplicates, validOnly],
    queryFn: async () =>
      (
        await apiGet<ExportPreviewResponse>(
          `/api/processed-lists/${fileId}/export-preview?${previewParams.toString()}`
        )
      ).data ?? null,
  });

  const historyQuery = useQuery({
    queryKey: ['processed-lists', fileId, 'export-history'],
    queryFn: async () => (await apiGet<MailingListExport[]>(`/api/processed-lists/${fileId}/export-history`)).data ?? [],
  });

  const generateMutation = useMutation({
    mutationFn: async () =>
      (
        await apiSend<{ downloadUrl: string; recordCount: number }>(`/api/processed-lists/${fileId}/export`, 'POST', {
          includeDuplicates,
          validOnly,
        })
      ).data,
    onSuccess: (data) => {
      toast.showSuccess(`Export generated: ${data?.recordCount ?? 0} record${data?.recordCount === 1 ? '' : 's'}.`);
      queryClient.invalidateQueries({ queryKey: ['processed-lists', fileId, 'export-history'] });
      queryClient.invalidateQueries({ queryKey: ['list-requests', 'files'] });
      if (data?.downloadUrl) {
        const link = document.createElement('a');
        link.href = data.downloadUrl;
        link.click();
      }
      onChanged?.();
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to generate export.');
    },
  });

  const preview = previewQuery.data;

  return (
    <Modal title={`Export to ELW — ${fileName}`} onClose={onClose} widthClassName="max-w-5xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-5 border rounded-lg px-4 py-3 bg-gray-50">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={validOnly}
              onChange={(e) => setValidOnly(e.target.checked)}
              className="rounded border-gray-300"
            />
            Valid records only
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={includeDuplicates}
              onChange={(e) => setIncludeDuplicates(e.target.checked)}
              className="rounded border-gray-300"
            />
            Include duplicates
          </label>
          {preview && (
            <span className="text-sm text-gray-500 ml-auto">
              {preview.totalMatching} record{preview.totalMatching === 1 ? '' : 's'} match{' '}
              {preview.totalMatching === 1 ? 'this' : 'these'} filters
            </span>
          )}
        </div>

        <div>
          <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
            Preview {preview ? `(first ${preview.previewCount} of ${preview.totalMatching})` : ''}
          </h4>

          {previewQuery.isLoading && <LoadingState label="Building preview..." />}
          {previewQuery.isError && <ErrorState message="Failed to build export preview." onRetry={() => previewQuery.refetch()} />}

          {preview && preview.rows.length === 0 && (
            <p className="text-sm text-gray-500 py-6 text-center border rounded-lg">
              No records match the selected filters.
            </p>
          )}

          {preview && preview.rows.length > 0 && (
            <div className="overflow-x-auto border rounded-lg max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {preview.columns.map((col) => (
                      <th key={col} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="border-t align-top">
                      {preview.columns.map((col) => (
                        <td key={col} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[180px] truncate">
                          {row[col] || <span className="text-gray-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h4 className="text-xs font-medium text-gray-500 uppercase mb-2 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" /> Export history
          </h4>
          {historyQuery.isLoading && <LoadingState label="Loading history..." />}
          {historyQuery.isError && <ErrorState message="Failed to load export history." onRetry={() => historyQuery.refetch()} />}
          {historyQuery.data && historyQuery.data.length === 0 && (
            <p className="text-sm text-gray-500">No exports generated yet.</p>
          )}
          {historyQuery.data && historyQuery.data.length > 0 && (
            <ul className="space-y-1.5">
              {historyQuery.data.map((exp) => (
                <li key={exp.id} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900 truncate">{exp.filename}</p>
                    <p className="text-xs text-gray-500">
                      {exp.recordCount} record{exp.recordCount === 1 ? '' : 's'} &middot; {formatDate(exp.exportedAt)}
                      {exp.includeDuplicates && ' · incl. duplicates'}
                      {!exp.validOnly && ' · incl. invalid'}
                    </p>
                  </div>
                  <a
                    href={`/api/exports/${exp.id}/download`}
                    title="Download"
                    className="shrink-0 p-1.5 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800">
            Close
          </button>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || (preview !== null && preview !== undefined && preview.totalMatching === 0)}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown className="w-4 h-4" />
            {generateMutation.isPending ? 'Generating…' : 'Generate & Download'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
