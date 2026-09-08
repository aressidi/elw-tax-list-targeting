export type TargetPriority = 'high' | 'medium' | 'low';

export interface State {
  id: number;
  abbreviation: string;
  name: string;
  fipsCode: string | null;
  priority: number | null;
  notes: string | null;
  createdAt: string;
}

export interface StateWithCounts extends State {
  countyCount: number;
  highPriorityCountyCount: number;
  mediumPriorityCountyCount: number;
  lowPriorityCountyCount: number;
  topCountyPriority: TargetPriority | null;
}

export interface CountySummary {
  id: number;
  stateId: number;
  name: string;
  countySeat: string | null;
  fipsCode: string | null;
  population: number | null;
  targetPriority: TargetPriority | null;
  notes: string | null;
  createdAt: string;
  contactCount: number;
  requestStatusSummary: Record<string, number>;
}

export interface StateWithCounties extends State {
  counties: CountySummary[];
}

export interface ListRequestPrice {
  id: number;
  listRequestId: number;
  basis: string | null;
  unitAmount: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  currency: string | null;
  totalAmount: string | null;
  effectiveDate: string | null;
  rawText: string | null;
  sourceLabel: string | null;
  notes: string | null;
}

export interface ListRequestEvent {
  id: number;
  listRequestId: number;
  eventType: string;
  occurredAt: string | null;
  channel: string | null;
  summary: string | null;
  body: string | null;
}

export interface ListRequestStatusHistoryEntry {
  id: number;
  listRequestId: number;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
  reason: string | null;
}

export interface ListRequest {
  id: number;
  taxOfficialId: number;
  requestStatus: string;
  listType: string;
  costAmount: string | null;
  costCurrency: string | null;
  costNotes: string | null;
  pricingBasis: string | null;
  responseSummary: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  prices: ListRequestPrice[];
  events: ListRequestEvent[];
  statusHistory: ListRequestStatusHistoryEntry[];
}

export interface TaxOfficial {
  id: number;
  countyId: number;
  fullName: string;
  title: string | null;
  phoneNumber: string | null;
  emailAddress: string | null;
  officeAddress: string | null;
  websiteUrl: string | null;
  isPrimary: boolean | null;
  notes: string | null;
  createdAt: string;
  listRequests?: ListRequest[];
}

export interface CountyDetail {
  id: number;
  stateId: number;
  name: string;
  countySeat: string | null;
  fipsCode: string | null;
  population: number | null;
  targetPriority: TargetPriority | null;
  notes: string | null;
  createdAt: string;
  state: State;
  taxOfficials: TaxOfficial[];
}
