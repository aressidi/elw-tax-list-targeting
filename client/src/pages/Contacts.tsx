import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Copy, ExternalLink, Mail, Phone, Plus, Search, Star, Users } from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type { ContactListItem, CountySummary, State } from '../types';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import ConfidenceBadge from '../components/ConfidenceBadge';
import Modal from '../components/Modal';
import ContactForm, { type ContactFormValues } from '../components/ContactForm';
import { useToast } from '../components/Toast';

interface ContactsResponse {
  data: ContactListItem[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

type SortOption = 'county' | 'name';

export default function Contacts() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sort, setSort] = useState<SortOption>('county');
  const [page, setPage] = useState(1);
  const [showAddContact, setShowAddContact] = useState(false);
  const [addContactCountyId, setAddContactCountyId] = useState<string>('');

  const { data: states } = useQuery({
    queryKey: ['states'],
    queryFn: async () => (await apiGet<State[]>('/api/states')).data ?? [],
  });

  const { data: counties } = useQuery({
    queryKey: ['counties', 'picker'],
    queryFn: async () => (await apiGet<CountySummary[]>('/api/counties?limit=100')).data ?? [],
  });

  const queryParams = new URLSearchParams();
  if (search.trim()) queryParams.set('search', search.trim());
  if (stateFilter) queryParams.set('state', stateFilter);
  queryParams.set('sort', sort);
  queryParams.set('page', String(page));
  queryParams.set('limit', '25');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['contacts', search, stateFilter, sort, page],
    queryFn: async () => {
      const res = await apiGet<ContactListItem[]>(`/api/contacts?${queryParams.toString()}`);
      return { data: res.data ?? [], pagination: (res as any).pagination } as ContactsResponse;
    },
  });

  const createContact = useMutation({
    mutationFn: (values: ContactFormValues & { countyId: number }) =>
      apiSend('/api/contacts', 'POST', {
        countyId: values.countyId,
        fullName: values.fullName.trim(),
        title: values.title.trim() || null,
        emailAddress: values.emailAddress.trim() || null,
        phoneNumber: values.phoneNumber.trim() || null,
        officeAddress: values.officeAddress.trim() || null,
        websiteUrl: values.websiteUrl.trim() || null,
        isPrimary: values.isPrimary,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['county'] });
      queryClient.invalidateQueries({ queryKey: ['counties'] });
      queryClient.invalidateQueries({ queryKey: ['states'] });
      setShowAddContact(false);
      setAddContactCountyId('');
      toast.showSuccess('Contact added.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to add contact.');
    },
  });

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      toast.showSuccess('Email address copied to clipboard.');
    } catch {
      toast.showError('Could not copy email address.');
    }
  };

  const contacts = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="w-6 h-6 text-gray-400" />
          Contacts
        </h2>
        <button
          onClick={() => setShowAddContact(true)}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Contact
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name, email, or county..."
            aria-label="Search contacts"
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by state"
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All states</option>
          {(states ?? []).map((s) => (
            <option key={s.id} value={s.abbreviation}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          aria-label="Sort contacts"
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="county">Sort by county</option>
          <option value="name">Sort by name</option>
        </select>
      </div>

      {isLoading && <LoadingState label="Loading contacts..." />}
      {isError && <ErrorState message="Failed to load contacts." onRetry={() => refetch()} />}

      {!isLoading && !isError && contacts.length === 0 && (
        <EmptyState
          title="No contacts found"
          description={search || stateFilter ? 'Try a different search or filter.' : 'Add the first contact to get started.'}
        />
      )}

      {!isLoading && !isError && contacts.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Name</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">County</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Contact</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Confidence</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className={contact.isPrimary ? 'font-bold text-gray-900' : 'font-medium text-gray-900'}>
                          {contact.fullName}
                        </span>
                        {contact.isPrimary && (
                          <Star
                            className="w-3.5 h-3.5 text-yellow-500 fill-current shrink-0"
                            aria-label="Primary contact"
                          />
                        )}
                      </div>
                      {contact.title && <p className="text-xs text-gray-500">{contact.title}</p>}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      <Link
                        href={`/counties/${contact.county.id}`}
                        className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                      >
                        {contact.county.name}, {contact.county.state.abbreviation}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1 text-sm">
                        {contact.emailAddress && (
                          <div className="flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <a href={`mailto:${contact.emailAddress}`} className="text-blue-600 hover:text-blue-800 truncate">
                              {contact.emailAddress}
                            </a>
                            <button
                              onClick={() => copyEmail(contact.emailAddress!)}
                              title="Copy email address"
                              aria-label={`Copy email address for ${contact.fullName}`}
                              className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 shrink-0"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {contact.phoneNumber && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <a href={`tel:${contact.phoneNumber}`} className="text-gray-600 hover:text-gray-900">
                              {contact.phoneNumber}
                            </a>
                          </div>
                        )}
                        {!contact.emailAddress && !contact.phoneNumber && (
                          <span className="text-xs text-gray-400 italic">No contact info</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <ConfidenceBadge confidence={contact.confidenceScore} />
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/counties/${contact.county.id}`}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                      >
                        View County
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} contacts)
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {showAddContact && (
        <Modal
          title="Add Contact"
          onClose={() => {
            setShowAddContact(false);
            setAddContactCountyId('');
          }}
        >
          <div className="mb-4">
            <label htmlFor="contact-county" className="block text-sm font-medium text-gray-700 mb-1">
              County <span className="text-red-500">*</span>
            </label>
            <select
              id="contact-county"
              value={addContactCountyId}
              onChange={(e) => setAddContactCountyId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a county...</option>
              {(counties ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} County
                </option>
              ))}
            </select>
          </div>
          {addContactCountyId ? (
            <ContactForm
              submitting={createContact.isPending}
              submitLabel="Add Contact"
              onSubmit={(values) => createContact.mutate({ ...values, countyId: parseInt(addContactCountyId, 10) })}
              onCancel={() => {
                setShowAddContact(false);
                setAddContactCountyId('');
              }}
            />
          ) : (
            <p className="text-sm text-gray-500">Select a county to continue.</p>
          )}
        </Modal>
      )}
    </div>
  );
}
