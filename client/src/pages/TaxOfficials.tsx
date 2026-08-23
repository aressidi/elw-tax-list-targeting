import { useQuery } from '@tanstack/react-query';
import { Users, Mail, Phone, Globe } from 'lucide-react';

interface TaxOfficial {
  id: number;
  fullName: string;
  title: string | null;
  emailAddress: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  isPrimary: boolean;
  county: {
    name: string;
    state: {
      abbreviation: string;
    };
  };
}

export default function TaxOfficials() {
  const { data: officials, isLoading } = useQuery<TaxOfficial[]>({
    queryKey: ['tax-officials'],
    queryFn: async () => {
      const res = await fetch('/api/tax-officials');
      const json = await res.json();
      return json.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading tax officials...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Tax Officials</h2>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          Add Official
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3 px-4 font-medium text-gray-700">Name</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">Title</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">Location</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">Contact</th>
            </tr>
          </thead>
          <tbody>
            {officials?.map((official) => (
              <tr key={official.id} className="border-b hover:bg-gray-50">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-gray-400" />
                    <span className="font-medium text-gray-900">{official.fullName}</span>
                    {official.isPrimary && (
                      <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                        Primary
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-3 px-4 text-gray-600">{official.title || 'N/A'}</td>
                <td className="py-3 px-4 text-gray-600">
                  {official.county.name}, {official.county.state.abbreviation}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    {official.emailAddress && (
                      <a
                        href={`mailto:${official.emailAddress}`}
                        className="text-blue-600 hover:text-blue-800"
                        title={official.emailAddress}
                      >
                        <Mail className="w-4 h-4" />
                      </a>
                    )}
                    {official.phoneNumber && (
                      <a
                        href={`tel:${official.phoneNumber}`}
                        className="text-green-600 hover:text-green-800"
                        title={official.phoneNumber}
                      >
                        <Phone className="w-4 h-4" />
                      </a>
                    )}
                    {official.websiteUrl && (
                      <a
                        href={official.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-600 hover:text-purple-800"
                        title="Website"
                      >
                        <Globe className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
