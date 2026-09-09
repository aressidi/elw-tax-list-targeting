import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { apiGet } from '../lib/api';
import Modal from './Modal';
import { LoadingState, ErrorState } from './QueryState';
import type { FilePreviewResponse } from '../types';

interface FilePreviewModalProps {
  fileId: number;
  fileName: string;
  onClose: () => void;
}

export default function FilePreviewModal({ fileId, fileName, onClose }: FilePreviewModalProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['processed-lists', fileId, 'preview'],
    queryFn: async () => (await apiGet<FilePreviewResponse>(`/api/processed-lists/${fileId}/preview`)).data ?? null,
  });

  return (
    <Modal title={`Preview: ${fileName}`} onClose={onClose} widthClassName="max-w-3xl">
      <div className="space-y-4">
        {isLoading && <LoadingState label="Loading preview..." />}
        {isError && <ErrorState message="Failed to load preview." onRetry={() => refetch()} />}

        {data && data.preview.kind === 'text' && (
          <div>
            <p className="text-xs text-gray-500 mb-2">
              Showing {data.preview.rows.length} of {data.preview.totalLines} line
              {data.preview.totalLines === 1 ? '' : 's'}
              {data.preview.truncated ? ' (truncated)' : ''}.
            </p>
            <div className="overflow-x-auto border rounded-lg max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {data.preview.rows.map((row, i) => (
                    <tr key={i} className={i === 0 ? 'bg-gray-50 font-medium' : 'border-t'}>
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-1.5 whitespace-nowrap text-gray-700">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && data.preview.kind === 'pdf' && (
          <div className="space-y-2 text-sm text-gray-700">
            <p>
              <span className="font-medium text-gray-900">Approximate page count:</span>{' '}
              {data.preview.approxPageCount ?? 'unknown'}
            </p>
            {data.preview.title && (
              <p>
                <span className="font-medium text-gray-900">Title:</span> {data.preview.title}
              </p>
            )}
            {data.preview.author && (
              <p>
                <span className="font-medium text-gray-900">Author:</span> {data.preview.author}
              </p>
            )}
            {data.preview.producer && (
              <p>
                <span className="font-medium text-gray-900">Producer:</span> {data.preview.producer}
              </p>
            )}
            <p className="text-xs text-gray-500 italic">{data.preview.note}</p>
          </div>
        )}

        {data && data.preview.kind === 'metadata' && (
          <div className="text-sm text-gray-600 space-y-2">
            <p>
              <span className="font-medium text-gray-900">File type:</span> {data.file.fileType ?? 'unknown'}
            </p>
            <p>
              <span className="font-medium text-gray-900">Size:</span>{' '}
              {data.file.fileSizeBytes ? `${Math.round(data.file.fileSizeBytes / 1024)} KB` : 'unknown'}
            </p>
            <p className="text-xs text-gray-500 italic">{data.preview.note}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <a
            href={`/api/processed-lists/${fileId}/download`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Download className="w-3.5 h-3.5" />
            Download original
          </a>
          <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
