import { useQuery } from '@tanstack/react-query';
import { FileText, Clock, CheckCircle, XCircle } from 'lucide-react';

interface ListRequest {
  id: number;
  requestStatus: string;
  listType: string;
  costAmount: string | null;
  emailSentAt: string | null;
  responseReceivedAt: string | null;
  assignedTo: string | null;
  createdAt: string;
  taxOfficial: {
    fullName: string;
    county: {
      name: string;
      state: {
        abbreviation: string;
      };
    };
  };
}

export default function ListRequests() {
  const { data: requests, isLoading } = useQuery<ListRequest[]>({
    queryKey: ['list-requests'],
    queryFn: async () => {
      const res = await fetch('/api/list-requests');
      const json = await res.json();
      return json.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading list requests...</div>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'list_provided':
      case 'fulfilled':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'not_available':
      case 'declined':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'list_provided':
        return 'bg-green-100 text-green-700';
      case 'email_sent':
      case 'awaiting_response':
        return 'bg-blue-100 text-blue-700';
      case 'not_available':
      case 'declined':
        return 'bg-red-100 text-red-700';
      case 'requires_payment':
        return 'bg-orange-100 text-orange-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">List Requests</h2>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          New Request
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3 px-4 font-medium text-gray-700">ID</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">Tax Official</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">Location</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">List Type</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">Cost</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">Assigned</th>
            </tr>
          </thead>
          <tbody>
            {requests?.map((request) => (
              <tr key={request.id} className="border-b hover:bg-gray-50">
                <td className="py-3 px-4 text-gray-600">#{request.id}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span className="font-medium text-gray-900">
                      {request.taxOfficial.fullName}
                    </span>
                  </div>
                </td>
                <td className="py-3 px-4 text-gray-600">
                  {request.taxOfficial.county.name},{' '}
                  {request.taxOfficial.county.state.abbreviation}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(request.requestStatus)}
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                        request.requestStatus
                      )}`}
                    >
                      {request.requestStatus.replace(/_/g, ' ')}
                    </span>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <span className="capitalize text-gray-600">{request.listType}</span>
                </td>
                <td className="py-3 px-4 text-gray-600">
                  {request.costAmount ? `$${request.costAmount}` : 'N/A'}
                </td>
                <td className="py-3 px-4 text-gray-600">
                  {request.assignedTo || 'Unassigned'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
