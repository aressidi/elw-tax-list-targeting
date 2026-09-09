// ====================
// FOIA Template Variable Substitution
//
// Single source of truth for supported template variables, shared between
// the server (create/update validation, POST /api/templates/:id/preview)
// and the client (editor's live preview). Rendering never evaluates
// arbitrary code: unknown {{tokens}} are left untouched in the output.
// ====================

export interface TemplateVariableDefinition {
  key: string;
  label: string;
  description: string;
}

export const TEMPLATE_VARIABLES: readonly TemplateVariableDefinition[] = [
  { key: 'county_name', label: 'County Name', description: 'County name' },
  { key: 'state_name', label: 'State Name', description: 'Full state name' },
  { key: 'state_abbr', label: 'State Abbreviation', description: 'State abbreviation' },
  { key: 'official_name', label: 'Official Name', description: "Contact's full name" },
  { key: 'official_title', label: 'Official Title', description: "Contact's title" },
  { key: 'current_date', label: 'Current Date', description: "Today's date" },
  { key: 'custom_note', label: 'Custom Note', description: 'Optional custom text' },
];

export const SUPPORTED_VARIABLE_KEYS: readonly string[] = TEMPLATE_VARIABLES.map((v) => v.key);

export interface TemplateSampleData {
  countyName: string;
  stateName: string;
  stateAbbr: string;
  officialName: string;
  officialTitle: string;
  customNote?: string;
}

export const DEFAULT_SAMPLE_DATA: TemplateSampleData = {
  countyName: 'Sample County',
  stateName: 'Sample State',
  stateAbbr: 'SS',
  officialName: '[Contact Name]',
  officialTitle: '[Title]',
  customNote: '',
};

const VARIABLE_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function resolveVariable(key: string, data: TemplateSampleData): string {
  switch (key) {
    case 'county_name':
      return data.countyName;
    case 'state_name':
      return data.stateName;
    case 'state_abbr':
      return data.stateAbbr;
    case 'official_name':
      return data.officialName;
    case 'official_title':
      return data.officialTitle;
    case 'current_date':
      return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    case 'custom_note':
      return data.customNote ?? '';
    default:
      return '';
  }
}

export function extractVariableKeys(text: string): string[] {
  const found = new Set<string>();
  const re = new RegExp(VARIABLE_TOKEN);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    found.add(match[1]);
  }
  return Array.from(found);
}

export interface TemplateVariableAnalysis {
  used: string[];
  known: string[];
  unknown: string[];
}

export function analyzeTemplateVariables(subjectLine: string, bodyText: string): TemplateVariableAnalysis {
  const used = Array.from(new Set([...extractVariableKeys(subjectLine), ...extractVariableKeys(bodyText)]));
  const known = used.filter((key) => SUPPORTED_VARIABLE_KEYS.includes(key));
  const unknown = used.filter((key) => !SUPPORTED_VARIABLE_KEYS.includes(key));
  return { used, known, unknown };
}

export type TemplateSegment =
  | { type: 'text'; value: string }
  | { type: 'known'; key: string; value: string }
  | { type: 'unknown'; key: string; value: string };

// Splits raw template text into text/known-variable/unknown-variable segments
// so the UI can highlight substitutions without ever rendering unknown tokens
// as anything other than inert text.
export function segmentTemplateText(text: string, data: TemplateSampleData): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let lastIndex = 0;
  const re = new RegExp(VARIABLE_TOKEN);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const key = match[1];
    if (SUPPORTED_VARIABLE_KEYS.includes(key)) {
      segments.push({ type: 'known', key, value: resolveVariable(key, data) });
    } else {
      segments.push({ type: 'unknown', key, value: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

export function renderTemplateText(text: string, data: TemplateSampleData): string {
  return segmentTemplateText(text, data)
    .map((segment) => segment.value)
    .join('');
}
