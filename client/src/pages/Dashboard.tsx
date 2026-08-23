import { useQuery } from '@tanstack/react-query';
import { 
  Map, 
  Building2, 
  Users, 
  FileText,
  TrendingUp,
  Clock
} from 'lucide-react';

interface DashboardStats {
  overview: {
    totalStates: number;
    totalCounties: number;
    totalTaxOfficials: number;
    totalListRequests: number;
  };
  requestsByStatus: Array<{ status: string; count: number }>;
}

export default function Dashboard() {
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/stats');
      const json = await res.json();
      return json.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  const stats = data?.overview;

  const statCards = [
    { label: 'States', value: stats?.totalStates || 0, icon: Map, color: 'bg-blue-500' },
    { label: 'Counties', value: stats?.totalCounties || 0, icon: Building2, color: 'bg-green-500' },
    { label: 'Tax Officials', value: stats?.totalTaxOfficials || 0, icon: Users, color: 'bg-purple-500' },
    { label: 'List Requests', value: stats?.totalListRequests || 0, icon: FileText, color: 'bg-orange-500' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-white rounded-lg border p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{card.label}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{card.value}</p>
                </div>
                <div className={`${card.color} p-3 rounded-lg`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Requests by Status */}
      <div className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Requests by Status</h3>
        </div>
        <div className="p-6">
          {data?.requestsByStatus && data.requestsByStatus.length > 0 ? (
            <div className="space-y-3">
              {data.requestsByStatus.map((item) => (
                <div key={item.status} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 capitalize">
                    {item.status.replace(/_/g, ' ')}
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="w-48 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{
                          width: `${(item.count / (stats?.totalListRequests || 1)) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium text-gray-900 w-8 text-right">
                      {item.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">No requests yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
