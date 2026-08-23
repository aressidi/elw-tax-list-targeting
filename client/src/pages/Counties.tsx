import { useQuery } from '@tanstack/react-query';
import { Building2, MapPin } from 'lucide-react';

interface County {
  id: number;
  name: string;
  countySeat: string | null;
  targetPriority: 'high' | 'medium' | 'low';
  state: {
    abbreviation: string;
    name: string;
  };
}

export default function Counties() {
  const { data: counties, isLoading } = useQuery<County[]>({
    queryKey: ['counties'],
    queryFn: async () => {
      const res = await fetch('/api/counties');
      const json = await res.json();
      return json.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading counties...</div>
      </div>
    );
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-700';
      case 'medium':
        return 'bg-yellow-100 text-yellow-700';
      case 'low':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Counties</h2>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3 px-4 font-medium text-gray-700">County</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">State</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">County Seat</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">Priority</th>
            </tr>
          </thead>
          <tbody>
            {counties?.map((county) => (
              <tr key={county.id} className="border-b hover:bg-gray-50">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gray-400" />
                    <span className="font-medium text-gray-900">{county.name}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-gray-600">{county.state.name}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2 text-gray-600">
                    <MapPin className="w-4 h-4" />
                    {county.countySeat || 'N/A'}
                  </div>
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getPriorityColor(
                      county.targetPriority
                    )}`}
                  >
                    {county.targetPriority}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
