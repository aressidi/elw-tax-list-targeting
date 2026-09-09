import type { UploadFileType } from './fileStorage.js';

// ============================================================
// File preview (card 11) — no CSV/PDF/Excel parsing library is installed
// in this repo, so previews are intentionally best-effort:
//   - CSV/TXT: a real (if minimal) RFC4180-ish line/row parse, since these
//     are plain text and the common case for received tax lists.
//   - PDF: approximate metadata scraped from the raw bytes (page count via
//     counting "/Type /Page" objects, Info dictionary strings). This can
//     under/over-count on PDFs that use compressed cross-reference/object
//     streams, which is why the result is labeled "approximate".
//   - Excel: metadata only (filename/size/type). Reading .xlsx properly
//     means unzipping + parsing XML, which needs a library this sandbox
//     can't install; card 12's real ingestion pipeline is a better place
//     to add that dependency than this preview endpoint.
// ============================================================

export const PREVIEW_ROW_LIMIT = 20;

export interface TextPreview {
  kind: 'text';
  totalLines: number;
  rows: string[][];
  truncated: boolean;
}

export interface PdfPreview {
  kind: 'pdf';
  approxPageCount: number | null;
  title: string | null;
  author: string | null;
  producer: string | null;
  note: string;
}

export interface MetadataOnlyPreview {
  kind: 'metadata';
  note: string;
}

export type FilePreview = TextPreview | PdfPreview | MetadataOnlyPreview;

// Splits one CSV line into fields, honoring double-quoted fields that may
// contain commas and escaped ("") quotes. Not a full RFC4180 implementation
// (doesn't handle quoted newlines mid-field, since we split on lines first)
// but covers the vast majority of real-world exports.
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function previewText(buffer: Buffer, fileType: 'csv' | 'txt'): TextPreview {
  const text = buffer.toString('utf8');
  const lines = text.split(/\r\n|\r|\n/).filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''));
  const limited = lines.slice(0, PREVIEW_ROW_LIMIT);
  const rows = fileType === 'csv' ? limited.map(splitCsvLine) : limited.map((line) => [line]);

  return {
    kind: 'text',
    totalLines: lines.length,
    rows,
    truncated: lines.length > PREVIEW_ROW_LIMIT,
  };
}

function extractPdfInfoString(latin1Text: string, key: string): string | null {
  const match = new RegExp(`/${key}\\s*\\(((?:[^()\\\\]|\\\\.)*)\\)`).exec(latin1Text);
  if (!match) return null;
  return match[1].replace(/\\(.)/g, '$1').trim() || null;
}

export function previewPdf(buffer: Buffer): PdfPreview {
  const latin1Text = buffer.toString('latin1');

  const pageObjectMatches = latin1Text.match(/\/Type\s*\/Page(?!s)\b/g);
  const pagesCountMatch = /\/Type\s*\/Pages\b[^>]*\/Count\s+(\d+)/.exec(latin1Text);

  const approxPageCount = pagesCountMatch
    ? parseInt(pagesCountMatch[1], 10)
    : pageObjectMatches
      ? pageObjectMatches.length
      : null;

  return {
    kind: 'pdf',
    approxPageCount,
    title: extractPdfInfoString(latin1Text, 'Title'),
    author: extractPdfInfoString(latin1Text, 'Author'),
    producer: extractPdfInfoString(latin1Text, 'Producer'),
    note: 'Approximate metadata scraped from the raw file — no PDF parsing library is installed, so page count may be inaccurate for PDFs using compressed object streams.',
  };
}

export function buildPreview(buffer: Buffer, fileType: UploadFileType | null): FilePreview {
  if (fileType === 'csv' || fileType === 'txt') return previewText(buffer, fileType);
  if (fileType === 'pdf') return previewPdf(buffer);
  return {
    kind: 'metadata',
    note:
      fileType === 'excel'
        ? 'Row-level preview is not available for Excel files in this environment — no spreadsheet parsing library is installed.'
        : 'No preview is available for this file type.',
  };
}
