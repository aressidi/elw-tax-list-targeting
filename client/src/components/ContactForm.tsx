import { useState } from 'react';

export interface ContactFormValues {
  fullName: string;
  title: string;
  emailAddress: string;
  phoneNumber: string;
  officeAddress: string;
  websiteUrl: string;
  isPrimary: boolean;
}

interface ContactFormProps {
  initialValues?: Partial<ContactFormValues>;
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: (values: ContactFormValues) => void;
  onCancel: () => void;
}

const DEFAULTS: ContactFormValues = {
  fullName: '',
  title: '',
  emailAddress: '',
  phoneNumber: '',
  officeAddress: '',
  websiteUrl: '',
  isPrimary: false,
};

export default function ContactForm({
  initialValues,
  submitting = false,
  submitLabel = 'Save Contact',
  onSubmit,
  onCancel,
}: ContactFormProps) {
  const [values, setValues] = useState<ContactFormValues>({ ...DEFAULTS, ...initialValues });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.fullName.trim()) {
      setError('Full name is required.');
      return;
    }
    setError(null);
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="contact-name" className="block text-sm font-medium text-gray-700 mb-1">
          Full name <span className="text-red-500">*</span>
        </label>
        <input
          id="contact-name"
          type="text"
          required
          value={values.fullName}
          onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g. Jane Smith"
        />
      </div>

      <div>
        <label htmlFor="contact-title" className="block text-sm font-medium text-gray-700 mb-1">
          Title
        </label>
        <input
          id="contact-title"
          type="text"
          value={values.title}
          onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g. Tax Collector"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="contact-email" className="block text-sm font-medium text-gray-700 mb-1">
            Email address
          </label>
          <input
            id="contact-email"
            type="email"
            value={values.emailAddress}
            onChange={(e) => setValues((v) => ({ ...v, emailAddress: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="contact-phone" className="block text-sm font-medium text-gray-700 mb-1">
            Phone number
          </label>
          <input
            id="contact-phone"
            type="tel"
            value={values.phoneNumber}
            onChange={(e) => setValues((v) => ({ ...v, phoneNumber: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label htmlFor="contact-address" className="block text-sm font-medium text-gray-700 mb-1">
          Office address
        </label>
        <input
          id="contact-address"
          type="text"
          value={values.officeAddress}
          onChange={(e) => setValues((v) => ({ ...v, officeAddress: e.target.value }))}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="contact-website" className="block text-sm font-medium text-gray-700 mb-1">
          Website URL
        </label>
        <input
          id="contact-website"
          type="url"
          value={values.websiteUrl}
          onChange={(e) => setValues((v) => ({ ...v, websiteUrl: e.target.value }))}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="https://"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={values.isPrimary}
          onChange={(e) => setValues((v) => ({ ...v, isPrimary: e.target.checked }))}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        Set as primary contact
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
        >
          {submitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
