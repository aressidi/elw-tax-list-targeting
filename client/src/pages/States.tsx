import { useQuery } from '@tanstack/react-query';
import { Map } from 'lucide-react';

interface State {
  id: number;
  abbreviation: string;
  name: string;
  fipsCode: string | null;
  priority: number;
}

export default function States() {
  const { data: states, isLoading } = useQuery<State[]>({
    queryKey: ['states'],
    queryFn: async () => {
      const res = await fetch('/api/states');
      const json = await res.json();
      return json.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading states...</div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">States</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {states?.map((state) => (
          <div
            key={state.id}
            className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <span className="text-blue-700 font-bold text-sm">{state.abbreviation}</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{state.name}</p>
                <p className="text-xs text-gray-500">FIPS: {state.fipsCode || 'N/A'}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
