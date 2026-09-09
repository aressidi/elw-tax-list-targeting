import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileDown, FileText, ListChecks, Trash2, UploadCloud } from 'lucide-react';
import { apiGet, apiSend, apiUpload, ApiError } from '../lib/api';
import type { ProcessedListFile } from '../types';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import FilePreviewModal from './FilePreviewModal';
import FieldMappingModal from './FieldMappingModal';
import ExportModal from './ExportModal';
import { LoadingState, ErrorState, EmptyState } from './QueryState';
import { useToast } from './Toast';

interface FileUploadDialogProps {
  listRequestId: number;
  requestLabel?: string;
  onClose: () => void;
  onChanged?: () => void;
}

const ALLOWED_EXTENSIONS = ['.csv', '.pdf', '.xlsx', '.xls', '.txt'];
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

function validateFile(file: File): string | null {
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
    return `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'File exceeds the 50MB upload limit.';
  }
  if (file.size === 0) {
    return 'File is empty.';
  }
  return null;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileUploadDialog({ listRequestId, requestLabel, onClose, onChanged }: FileUploadDialogProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewingFile, setPreviewingFile] = useState<ProcessedListFile | null>(null);
  const [deletingFile, setDeletingFile] = useState<ProcessedListFile | null>(null);
  const [mappingFile, setMappingFile] = useState<ProcessedListFile | null>(null);
  const [exportingFile, setExportingFile] = useState<ProcessedListFile | null>(null);

  const filesQuery = useQuery({
    queryKey: ['list-requests', listRequestId, 'files'],
    queryFn: async () => (await apiGet<ProcessedListFile[]>(`/api/list-requests/${listRequestId}/files`)).data ?? [],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['list-requests', listRequestId, 'files'] });
    queryClient.invalidateQueries({ queryKey: ['list-requests'] });
    onChanged?.();
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setUploadProgress(0);
      const { promise } = apiUpload<ProcessedListFile>(
        `/api/list-requests/${listRequestId}/upload`,
        file,
        setUploadProgress
      );
      return (await promise).data ?? null;
    },
    onSuccess: () => {
      setUploadProgress(null);
      toast.showSuccess('File uploaded.');
      invalidate();
    },
    onError: (error: unknown) => {
      setUploadProgress(null);
      toast.showError(error instanceof ApiError ? error.message : 'Failed to upload file.');
    },
  });

  const deleteFile = useMutation({
    mutationFn: async (fileId: number) => apiSend(`/api/processed-lists/${fileId}`, 'DELETE'),
    onSuccess: () => {
      toast.showSuccess('File deleted.');
      setDeletingFile(null);
      invalidate();
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to delete file.');
    },
  });

  const handleFile = (file: File) => {
    const error = validateFile(file);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    upload.mutate(file);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const files = filesQuery.data ?? [];

  return (
    <Modal
      title={requestLabel ? `Files — ${requestLabel}` : 'Uploaded Files'}
      onClose={onClose}
      widthClassName="max-w-2xl"
    >
      <div className="space-y-5">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg py-8 px-4 cursor-pointer transition-colors ${
            dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <UploadCloud className={`w-8 h-8 ${dragActive ? 'text-blue-500' : 'text-gray-400'}`} />
          <p className="text-sm text-gray-600">
            <span className="font-medium text-blue-700">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-gray-400">CSV, PDF, Excel (.xlsx/.xls), or TXT — up to 50MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_EXTENSIONS.join(',')}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = '';
            }}
          />
        </div>

        {validationError && <p className="text-sm text-red-600">{validationError}</p>}

        {uploadProgress !== null && (
          <div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">Uploading... {uploadProgress}%</p>
          </div>
        )}

        <div>
          <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Uploaded files</h4>
          {filesQuery.isLoading && <LoadingState label="Loading files..." />}
          {filesQuery.isError && <ErrorState message="Failed to load files." onRetry={() => filesQuery.refetch()} />}
          {!filesQuery.isLoading && !filesQuery.isError && files.length === 0 && (
            <EmptyState title="No files uploaded yet" description="Upload the list file received from this official." />
          )}
          {files.length > 0 && (
            <ul className="space-y-2">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.originalFilename}</p>
                      <p className="text-xs text-gray-500">
                        {file.fileType?.toUpperCase() ?? 'FILE'} &middot; {formatSize(file.fileSizeBytes)}
                        {file.rawDataStored && file.recordCount !== null && (
                          <> &middot; {file.recordCount} record{file.recordCount === 1 ? '' : 's'} mapped</>
                        )}
                        {file.processedAt && <> &middot; {new Date(file.processedAt).toLocaleString()}</>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setPreviewingFile(file)}
                      title="Preview"
                      className="p-1.5 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setMappingFile(file)}
                      title="Map fields & validate"
                      className={`p-1.5 rounded-lg hover:bg-blue-50 hover:text-blue-700 ${
                        file.rawDataStored ? 'text-green-600' : 'text-gray-500'
                      }`}
                    >
                      <ListChecks className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setExportingFile(file)}
                      disabled={!file.rawDataStored || !file.recordCount}
                      title="Export to ELW mailing list format"
                      className={`p-1.5 rounded-lg hover:bg-blue-50 hover:text-blue-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-500 ${
                        file.mailingListCreated ? 'text-green-600' : 'text-gray-500'
                      }`}
                    >
                      <FileDown className="w-4 h-4" />
                    </button>
                    <a
                      href={`/api/processed-lists/${file.id}/download`}
                      title="Download"
                      className="p-1.5 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                    <button
                      onClick={() => setDeletingFile(file)}
                      title="Delete"
                      className="p-1.5 text-gray-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800">
            Close
          </button>
        </div>
      </div>

      {previewingFile && (
        <FilePreviewModal
          fileId={previewingFile.id}
          fileName={previewingFile.originalFilename ?? 'file'}
          onClose={() => setPreviewingFile(null)}
        />
      )}

      {deletingFile && (
        <ConfirmDialog
          title="Delete file"
          message={`Delete "${deletingFile.originalFilename}"? This removes the file from disk and cannot be undone.`}
          confirmLabel="Delete"
          busy={deleteFile.isPending}
          onConfirm={() => deleteFile.mutate(deletingFile.id)}
          onCancel={() => setDeletingFile(null)}
        />
      )}

      {mappingFile && (
        <FieldMappingModal
          fileId={mappingFile.id}
          fileName={mappingFile.originalFilename ?? 'file'}
          onClose={() => setMappingFile(null)}
          onChanged={invalidate}
        />
      )}

      {exportingFile && (
        <ExportModal
          fileId={exportingFile.id}
          fileName={exportingFile.originalFilename ?? 'file'}
          onClose={() => setExportingFile(null)}
          onChanged={invalidate}
        />
      )}
    </Modal>
  );
}
