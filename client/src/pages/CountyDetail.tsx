import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import {
  ArrowLeft,
  Building2,
  FileText,
  Globe,
  Mail,
  Phone,
  Plus,
  Star,
  Trash2,
  Pencil,
  Users,
} from 'lucide-react';
import { apiGet, apiSend, ApiError } from '../lib/api';
import type { CountyDetail as CountyDetailType, ListRequest, TargetPriority, TaxOfficial } from '../types';
import { LoadingState, ErrorState, EmptyState } from '../components/QueryState';
import PriorityBadge from '../components/PriorityBadge';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import ContactForm, { type ContactFormValues } from '../components/ContactForm';
import { useToast } from '../components/Toast';

function toContactPayload(values: ContactFormValues) {
  return {
    fullName: values.fullName.trim(),
    title: values.title.trim() || null,
    emailAddress: values.emailAddress.trim() || null,
    phoneNumber: values.phoneNumber.trim() || null,
    officeAddress: values.officeAddress.trim() || null,
    websiteUrl: values.websiteUrl.trim() || null,
    isPrimary: values.isPrimary,
  };
}

function formatPricing(request: ListRequest) {
  if (request.costAmount) {
    return `$${request.costAmount} ${request.costCurrency ?? 'USD'}`;
  }
  const latestPrice = request.prices?.[0];
  if (latestPrice?.totalAmount) {
    return `$${latestPrice.totalAmount} ${latestPrice.currency ?? 'USD'}`;
  }
  if (latestPrice?.unitAmount) {
    return `$${latestPrice.unitAmount} / ${latestPrice.quantityUnit ?? 'unit'}`;
  }
  return 'Pricing unknown';
}

export default function CountyDetail() {
  const { id } = useParams<{ id: string }>();
  const countyId = parseInt(id ?? '', 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [editingContact, setEditingContact] = useState<TaxOfficial | null>(null);
  const [deletingContact, setDeletingContact] = useState<TaxOfficial | null>(null);
  const [confirmDeleteCounty, setConfirmDeleteCounty] = useState(false);

  const { data: county, isLoading, isError, refetch } = useQuery({
    queryKey: ['county', countyId],
    queryFn: async () => (await apiGet<CountyDetailType>(`/api/counties/${countyId}`)).data ?? null,
    enabled: Number.isFinite(countyId),
  });

  useEffect(() => {
    if (county && !notesDirty) {
      setNotes(county.notes ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county?.notes]);

  const invalidateCounty = () => {
    queryClient.invalidateQueries({ queryKey: ['county', countyId] });
    if (county) {
      queryClient.invalidateQueries({ queryKey: ['state', county.state.abbreviation] });
    }
    queryClient.invalidateQueries({ queryKey: ['states'] });
    queryClient.invalidateQueries({ queryKey: ['counties'] });
  };

  const updatePriority = useMutation({
    mutationFn: (targetPriority: TargetPriority) =>
      apiSend(`/api/counties/${countyId}`, 'PATCH', { targetPriority }),
    onSuccess: () => {
      invalidateCounty();
      toast.showSuccess('Target priority updated.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to update priority.');
    },
  });

  const saveNotes = useMutation({
    mutationFn: () => apiSend(`/api/counties/${countyId}`, 'PATCH', { notes }),
    onSuccess: () => {
      setNotesDirty(false);
      invalidateCounty();
      toast.showSuccess('Notes saved.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to save notes.');
    },
  });

  const deleteCounty = useMutation({
    mutationFn: () => apiSend(`/api/counties/${countyId}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['states'] });
      queryClient.invalidateQueries({ queryKey: ['counties'] });
      if (county) queryClient.invalidateQueries({ queryKey: ['state', county.state.abbreviation] });
      toast.showSuccess('County deleted.');
      setLocation(county ? `/states/${county.state.abbreviation}` : '/states');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to delete county.');
      setConfirmDeleteCounty(false);
    },
  });

  const createContact = useMutation({
    mutationFn: (values: ContactFormValues) =>
      apiSend('/api/tax-officials', 'POST', { countyId, ...toContactPayload(values) }),
    onSuccess: () => {
      invalidateCounty();
      setShowAddContact(false);
      toast.showSuccess('Contact added.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to add contact.');
    },
  });

  const updateContact = useMutation({
    mutationFn: ({ contactId, values }: { contactId: number; values: ContactFormValues }) =>
      apiSend(`/api/tax-officials/${contactId}`, 'PATCH', {
        fullName: values.fullName.trim(),
        title: values.title.trim() || null,
        emailAddress: values.emailAddress.trim() || null,
        phoneNumber: values.phoneNumber.trim() || null,
        officeAddress: values.officeAddress.trim() || null,
        websiteUrl: values.websiteUrl.trim() || null,
      }),
    onSuccess: () => {
      invalidateCounty();
      setEditingContact(null);
      toast.showSuccess('Contact updated.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to update contact.');
    },
  });

  const deleteContact = useMutation({
    mutationFn: (contactId: number) => apiSend(`/api/tax-officials/${contactId}`, 'DELETE'),
    onSuccess: () => {
      invalidateCounty();
      setDeletingContact(null);
      toast.showSuccess('Contact deleted.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to delete contact.');
      setDeletingContact(null);
    },
  });

  const togglePrimary = useMutation({
    mutationFn: ({ contactId, isPrimary }: { contactId: number; isPrimary: boolean }) =>
      apiSend(`/api/tax-officials/${contactId}/primary`, 'PATCH', { isPrimary }),
    onSuccess: () => {
      invalidateCounty();
      toast.showSuccess('Primary contact updated.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to update primary contact.');
    },
  });

  const createListRequest = useMutation({
    mutationFn: (taxOfficialId: number) =>
      apiSend('/api/list-requests', 'POST', { taxOfficialId, requestStatus: 'not_started' }),
    onSuccess: () => {
      invalidateCounty();
      toast.showSuccess('List request created.');
    },
    onError: (error: unknown) => {
      toast.showError(error instanceof ApiError ? error.message : 'Failed to create list request.');
    },
  });

  const allListRequests = useMemo(() => {
    if (!county) return [];
    return county.taxOfficials.flatMap((official) =>
      (official.listRequests ?? []).map((request) => ({ request, official }))
    );
  }, [county]);

  const primaryContact = county?.taxOfficials.find((o) => o.isPrimary) ?? county?.taxOfficials[0];

  if (isLoading) return <LoadingState label="Loading county..." />;
  if (isError || !county) {
    return <ErrorState message="Failed to load this county." onRetry={() => refetch()} />;
  }

  return (
    <div>
      <Link
        href={`/states/${county.state.abbreviation}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {county.state.name}
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
            <Building2 className="w-6 h-6 text-green-700" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{county.name} County</h2>
            <p className="text-sm text-gray-500">
              {county.state.name} ({county.state.abbreviation})
            </p>
          </div>
        </div>
        <button
          onClick={() => setConfirmDeleteCounty(true)}
          className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-800 px-3 py-2 rounded-lg hover:bg-red-50"
        >
          <Trash2 className="w-4 h-4" />
          Delete County
        </button>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">County Seat</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">{county.countySeat || 'N/A'}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Population</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">
            {county.population != null ? county.population.toLocaleString() : 'N/A'}
          </p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">FIPS Code</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">{county.fipsCode || 'N/A'}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Target Priority</p>
          <select
            value={county.targetPriority ?? 'medium'}
            onChange={(e) => updatePriority.mutate(e.target.value as TargetPriority)}
            disabled={updatePriority.isPending}
            aria-label="Target priority"
            className="w-full border rounded-lg px-2 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Notes */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Notes</h3>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(true);
          }}
          rows={3}
          aria-label="County notes"
          placeholder="Add notes about this county..."
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={() => saveNotes.mutate()}
            disabled={!notesDirty || saveNotes.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saveNotes.isPending ? 'Saving...' : 'Save Notes'}
          </button>
        </div>
      </div>

      {/* Contacts */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-gray-400" />
            Contacts
          </h3>
          <button
            onClick={() => setShowAddContact(true)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Contact
          </button>
        </div>

        {county.taxOfficials.length === 0 ? (
          <EmptyState title="No contacts yet" description="Add the first tax official for this county." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {county.taxOfficials.map((contact) => (
              <div key={contact.id} className="border rounded-lg p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">{contact.fullName}</span>
                      {contact.isPrimary && (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
                          <Star className="w-3 h-3 fill-current" />
                          Primary
                        </span>
                      )}
                    </div>
                    {contact.title && <p className="text-sm text-gray-500">{contact.title}</p>}
                  </div>
                  <button
                    onClick={() => togglePrimary.mutate({ contactId: contact.id, isPrimary: !contact.isPrimary })}
                    disabled={togglePrimary.isPending}
                    title={contact.isPrimary ? 'Unset as primary' : 'Set as primary'}
                    aria-label={contact.isPrimary ? 'Unset as primary contact' : 'Set as primary contact'}
                    className={`shrink-0 p-1.5 rounded-md hover:bg-gray-100 ${
                      contact.isPrimary ? 'text-yellow-500' : 'text-gray-300'
                    }`}
                  >
                    <Star className={`w-4 h-4 ${contact.isPrimary ? 'fill-current' : ''}`} />
                  </button>
                </div>

                <div className="mt-3 space-y-1.5 text-sm text-gray-600">
                  {contact.emailAddress && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <a href={`mailto:${contact.emailAddress}`} className="text-blue-600 hover:text-blue-800 truncate">
                        {contact.emailAddress}
                      </a>
                    </div>
                  )}
                  {contact.phoneNumber && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <a href={`tel:${contact.phoneNumber}`} className="hover:text-gray-900">
                        {contact.phoneNumber}
                      </a>
                    </div>
                  )}
                  {contact.websiteUrl && (
                    <div className="flex items-center gap-2">
                      <Globe className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <a
                        href={contact.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 truncate"
                      >
                        {contact.websiteUrl}
                      </a>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4 mt-3 pt-3 border-t">
                  <button
                    onClick={() => setEditingContact(contact)}
                    className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => setDeletingContact(contact)}
                    className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* List Requests */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-gray-400" />
            List Requests
          </h3>
          <button
            onClick={() => primaryContact && createListRequest.mutate(primaryContact.id)}
            disabled={!primaryContact || createListRequest.isPending}
            title={!primaryContact ? 'Add a contact first' : undefined}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            New Request
          </button>
        </div>

        {allListRequests.length === 0 ? (
          <EmptyState
            title="No list requests yet"
            description="Start a new request once a contact has been added."
          />
        ) : (
          <div className="space-y-3">
            {allListRequests.map(({ request, official }) => (
              <div key={request.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 capitalize">
                      {request.requestStatus.replace(/_/g, ' ')}
                    </span>
                    <span className="ml-2 text-sm text-gray-500">to {official.fullName}</span>
                  </div>
                  <span className="text-sm font-medium text-gray-700">{formatPricing(request)}</span>
                </div>
                {request.responseSummary && (
                  <p className="text-sm text-gray-600 mt-2">{request.responseSummary}</p>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  Created {new Date(request.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddContact && (
        <Modal title="Add Contact" onClose={() => setShowAddContact(false)}>
          <ContactForm
            submitting={createContact.isPending}
            submitLabel="Add Contact"
            onSubmit={(values) => createContact.mutate(values)}
            onCancel={() => setShowAddContact(false)}
          />
        </Modal>
      )}

      {editingContact && (
        <Modal title={`Edit ${editingContact.fullName}`} onClose={() => setEditingContact(null)}>
          <ContactForm
            initialValues={{
              fullName: editingContact.fullName,
              title: editingContact.title ?? '',
              emailAddress: editingContact.emailAddress ?? '',
              phoneNumber: editingContact.phoneNumber ?? '',
              officeAddress: editingContact.officeAddress ?? '',
              websiteUrl: editingContact.websiteUrl ?? '',
              isPrimary: !!editingContact.isPrimary,
            }}
            submitting={updateContact.isPending}
            submitLabel="Save Changes"
            onSubmit={(values) => updateContact.mutate({ contactId: editingContact.id, values })}
            onCancel={() => setEditingContact(null)}
          />
        </Modal>
      )}

      {deletingContact && (
        <ConfirmDialog
          title="Delete Contact"
          message={`Are you sure you want to delete ${deletingContact.fullName}? This will also remove any associated list requests.`}
          confirmLabel="Delete"
          busy={deleteContact.isPending}
          onConfirm={() => deleteContact.mutate(deletingContact.id)}
          onCancel={() => setDeletingContact(null)}
        />
      )}

      {confirmDeleteCounty && (
        <ConfirmDialog
          title="Delete County"
          message={`Are you sure you want to delete ${county.name} County? This will also remove all of its contacts and list requests.`}
          confirmLabel="Delete"
          busy={deleteCounty.isPending}
          onConfirm={() => deleteCounty.mutate()}
          onCancel={() => setConfirmDeleteCounty(false)}
        />
      )}
    </div>
  );
}
