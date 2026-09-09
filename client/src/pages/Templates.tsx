import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { Check, Copy, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type { FoiaTemplate } from '../types';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';

export default function Templates() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [, setLocation] = useLocation();
  const [deleteTarget, setDeleteTarget] = useState<FoiaTemplate | null>(null);

  const { data: templates, isLoading, isError, refetch } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => (await apiGet<FoiaTemplate[]>('/api/templates')).data ?? [],
  });

  const duplicateTemplate = useMutation({
    mutationFn: async (template: FoiaTemplate) =>
      (
        await apiSend<FoiaTemplate>('/api/templates', 'POST', {
          name: `${template.name} (Copy)`.slice(0, 100),
          subjectLine: template.subjectLine,
          bodyText: template.bodyText,
          isDefault: false,
        })
      ).data,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.showSuccess('Template duplicated.');
      if (created) setLocation(`/templates/${created.id}/edit`);
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to duplicate template.');
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: number) => apiSend(`/api/templates/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.showSuccess('Template deleted.');
      setDeleteTarget(null);
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to delete template.');
      setDeleteTarget(null);
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-gray-400" />
          FOIA Templates
        </h2>
        <Link
          href="/templates/new"
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Create New Template
        </Link>
      </div>

      {isLoading && <LoadingState label="Loading templates..." />}
      {isError && <ErrorState message="Failed to load templates." onRetry={() => refetch()} />}

      {!isLoading && !isError && (templates?.length ?? 0) === 0 && (
        <EmptyState
          title="No templates yet"
          description="Create your first FOIA request template to get started."
        />
      )}

      {!isLoading && !isError && (templates?.length ?? 0) > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates!.map((template) => (
            <div
              key={template.id}
              className={`border rounded-lg p-5 flex flex-col ${
                template.isDefault ? 'border-blue-300 bg-blue-50' : 'bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-gray-900 break-words">{template.name}</h3>
                {template.isDefault && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full shrink-0">
                    <Check className="w-3 h-3" />
                    Default
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-500 line-clamp-2 mb-4 flex-1">{template.subjectLine}</p>

              <div className="flex items-center gap-1 pt-3 border-t">
                <button
                  onClick={() => setLocation(`/templates/${template.id}/edit`)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  onClick={() => duplicateTemplate.mutate(template)}
                  disabled={duplicateTemplate.isPending}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Duplicate
                </button>
                <button
                  onClick={() => setDeleteTarget(template)}
                  disabled={template.isDefault}
                  title={template.isDefault ? 'Set another template as default before deleting this one' : undefined}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40 disabled:hover:bg-transparent ml-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Template"
          message={`Delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          busy={deleteTemplate.isPending}
          onConfirm={() => deleteTemplate.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
