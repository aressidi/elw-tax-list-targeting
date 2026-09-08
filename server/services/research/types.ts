export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ResearchCandidate {
  fullName: string;
  title: string | null;
  emailAddress: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  confidence: ConfidenceLevel;
  sourceUrl: string | null;
  sourceSnippet: string | null;
}

export interface ResearchInput {
  countyName: string;
  stateName: string;
  stateAbbreviation: string;
}

export interface ResearchOutcome {
  ok: boolean;
  provider: string;
  isDemo: boolean;
  candidates: ResearchCandidate[];
  error?: string;
}

export interface ResearchProvider {
  name: string;
  research(input: ResearchInput): Promise<ResearchOutcome>;
}
