import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Search } from 'lucide-react';
import { apiGet } from '../lib/api';
import type { StateWithCounts } from '../types';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import PriorityBadge from '../components/PriorityBadge';

export default function States() {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['states'],
    queryFn: async () => (await apiGet<StateWithCounts[]>('/api/states')).data ?? [],
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter(
      (state) =>
        state.name.toLowerCase().includes(term) || state.abbreviation.toLowerCase().includes(term)
    );
  }, [data, search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-900">States & Counties</h2>
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or abbreviation..."
            aria-label="Search states"
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {isLoading && <LoadingState label="Loading states..." />}
      {isError && <ErrorState message="Failed to load states." onRetry={() => refetch()} />}

      {!isLoading && !isError && filtered.length === 0 && (
        <EmptyState
          title={search ? 'No states match your search' : 'No states found'}
          description={search ? 'Try a different name or abbreviation.' : undefined}
        />
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((state) => (
            <Link
              key={state.id}
              href={`/states/${state.abbreviation}`}
              className="bg-white border rounded-lg p-4 hover:shadow-md hover:border-blue-300 transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                  <span className="text-blue-700 font-bold text-base">{state.abbreviation}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 truncate">{state.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {state.countyCount} {state.countyCount === 1 ? 'county' : 'counties'}
                  </p>
                  <div className="mt-2">
                    <PriorityBadge priority={state.topCountyPriority} />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
