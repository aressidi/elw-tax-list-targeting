import { useState } from 'react';
import type { TargetPriority } from '../types';

export interface CountyFormValues {
  name: string;
  countySeat: string;
  fipsCode: string;
  population: string;
  targetPriority: TargetPriority;
}

interface CountyFormProps {
  stateName: string;
  initialValues?: Partial<CountyFormValues>;
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: (values: CountyFormValues) => void;
  onCancel: () => void;
}

const DEFAULTS: CountyFormValues = {
  name: '',
  countySeat: '',
  fipsCode: '',
  population: '',
  targetPriority: 'medium',
};

export default function CountyForm({
  stateName,
  initialValues,
  submitting = false,
  submitLabel = 'Save County',
  onSubmit,
  onCancel,
}: CountyFormProps) {
  const [values, setValues] = useState<CountyFormValues>({ ...DEFAULTS, ...initialValues });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.name.trim()) {
      setError('County name is required.');
      return;
    }
    setError(null);
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
        <input
          type="text"
          value={stateName}
          disabled
          className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500"
        />
      </div>

      <div>
        <label htmlFor="county-name" className="block text-sm font-medium text-gray-700 mb-1">
          County name <span className="text-red-500">*</span>
        </label>
        <input
          id="county-name"
          type="text"
          required
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g. Franklin"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="county-seat" className="block text-sm font-medium text-gray-700 mb-1">
            County seat
          </label>
          <input
            id="county-seat"
            type="text"
            value={values.countySeat}
            onChange={(e) => setValues((v) => ({ ...v, countySeat: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="county-fips" className="block text-sm font-medium text-gray-700 mb-1">
            FIPS code
          </label>
          <input
            id="county-fips"
            type="text"
            value={values.fipsCode}
            onChange={(e) => setValues((v) => ({ ...v, fipsCode: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="county-population" className="block text-sm font-medium text-gray-700 mb-1">
            Population
          </label>
          <input
            id="county-population"
            type="number"
            min="0"
            value={values.population}
            onChange={(e) => setValues((v) => ({ ...v, population: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="county-priority" className="block text-sm font-medium text-gray-700 mb-1">
            Target priority
          </label>
          <select
            id="county-priority"
            value={values.targetPriority}
            onChange={(e) => setValues((v) => ({ ...v, targetPriority: e.target.value as TargetPriority }))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

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
