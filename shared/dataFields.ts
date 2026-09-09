// ============================================================
// Standard field definitions (card 12) — the canonical set of fields we
// try to map every incoming tax list onto, regardless of how the county
// happened to label its columns. Shared between server/services/dataParser.ts
// (auto-mapping + validation) and the client's field-mapping UI so both
// sides agree on ids/labels without duplicating the list.
// ============================================================

export const STANDARD_FIELDS = [
  { id: 'apn', label: 'APN / Parcel Number', critical: true },
  { id: 'owner_name', label: 'Owner Name', critical: true },
  { id: 'property_address', label: 'Property Address', critical: false },
  { id: 'mailing_address', label: 'Mailing Address', critical: false },
  { id: 'amount_due', label: 'Amount Due', critical: false },
  { id: 'property_description', label: 'Property / Legal Description', critical: false },
] as const;

export type StandardFieldId = (typeof STANDARD_FIELDS)[number]['id'];

export const CRITICAL_FIELD_IDS: StandardFieldId[] = STANDARD_FIELDS.filter((f) => f.critical).map((f) => f.id);

// Order matters: fields are matched against available headers in this
// order, and a header claimed by an earlier field is removed from the
// pool for later ones. Most-specific/least-ambiguous fields go first so
// they don't lose a good header to a more generic later match.
const FIELD_MATCH_ORDER: StandardFieldId[] = [
  'apn',
  'owner_name',
  'property_address',
  'mailing_address',
  'amount_due',
  'property_description',
];

// Alias phrases are normalized the same way headers are before matching
// (see normalizeHeader). Keep these specific — avoid bare words like
// "address" or "name" that would swallow an unrelated column.
const FIELD_ALIASES: Record<StandardFieldId, string[]> = {
  apn: [
    'apn',
    'parcel id',
    'parcel number',
    'parcel no',
    'parcel num',
    'parcel',
    'pin',
    'tax id',
    'tax id number',
    'account number',
    'account no',
    'account',
    'assessor parcel number',
  ],
  owner_name: [
    'owner',
    'owner name',
    'owners',
    'taxpayer',
    'taxpayer name',
    'assessed to',
    'assessed owner',
    'property owner',
    'name',
  ],
  property_address: [
    'situs',
    'situs address',
    'property address',
    'property location',
    'site address',
    'location',
  ],
  mailing_address: [
    'mail address',
    'mailing address',
    'billing address',
    'owner address',
    'owner mailing address',
    'mail to address',
    'mailing addr',
  ],
  amount_due: [
    'delinquent amount',
    'total due',
    'taxes due',
    'tax due',
    'balance',
    'amount due',
    'amount owed',
    'delinquent tax',
    'delinquent taxes',
    'total amount due',
    'tax amount',
  ],
  property_description: [
    'legal',
    'legal description',
    'description',
    'property description',
    'property desc',
  ],
};

export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function scoreHeaderForField(normalizedHeader: string, field: StandardFieldId): number {
  if (!normalizedHeader) return 0;
  let best = 0;
  for (const alias of FIELD_ALIASES[field]) {
    if (normalizedHeader === alias) {
      best = Math.max(best, 100);
    } else if (
      normalizedHeader.includes(alias) &&
      alias.length >= 3 // avoid short aliases matching as substrings of unrelated words
    ) {
      best = Math.max(best, 70);
    }
  }
  return best;
}

// Greedily assigns each standard field the best-scoring unused header,
// processed in FIELD_MATCH_ORDER so critical fields claim headers first.
// Fields with no header scoring above 0 are left unmapped (null).
export function autoMapFields(headers: string[]): Record<StandardFieldId, string | null> {
  const normalized = headers.map((h) => ({ original: h, norm: normalizeHeader(h) }));
  const used = new Set<string>();
  const mapping = {} as Record<StandardFieldId, string | null>;

  for (const field of FIELD_MATCH_ORDER) {
    let bestHeader: string | null = null;
    let bestScore = 0;
    for (const h of normalized) {
      if (used.has(h.original)) continue;
      const score = scoreHeaderForField(h.norm, field);
      if (score > bestScore) {
        bestScore = score;
        bestHeader = h.original;
      }
    }
    mapping[field] = bestHeader;
    if (bestHeader) used.add(bestHeader);
  }

  return mapping;
}
