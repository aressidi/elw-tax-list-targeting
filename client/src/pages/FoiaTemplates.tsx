import { useQuery } from '@tanstack/react-query';
import { Mail, Check, Copy } from 'lucide-react';

interface FoiaTemplate {
  id: number;
  name: string;
  subjectLine: string;
  bodyText: string;
  isDefault: boolean;
  createdAt: string;
}

export default function FoiaTemplates() {
  const { data: templates, isLoading } = useQuery<FoiaTemplate[]>({
    queryKey: ['foia-templates'],
    queryFn: async () => {
      const res = await fetch('/api/foia-templates');
      const json = await res.json();
      return json.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading templates...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">FOIA Templates</h2>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          New Template
        </button>
      </div>

      <div className="space-y-4">
        {templates?.map((template) => (
          <div
            key={template.id}
            className={`border rounded-lg p-6 ${template.isDefault ? 'border-blue-300 bg-blue-50' : 'bg-white'}`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-gray-400" />
                <div>
                  <h3 className="font-semibold text-gray-900">{template.name}</h3>
                  {template.isDefault && (
                    <span className="inline-flex items-center gap-1 text-xs text-blue-600 mt-1">
                      <Check className="w-3 h-3" />
                      Default Template
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="p-2 text-gray-400 hover:text-gray-600" title="Copy">
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">Subject</label>
                <p className="text-sm text-gray-900 mt-1 bg-white p-2 rounded border">
                  {template.subjectLine}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">Body</label>
                <pre className="text-sm text-gray-700 mt-1 bg-white p-3 rounded border whitespace-pre-wrap font-sans">
                  {template.bodyText}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
