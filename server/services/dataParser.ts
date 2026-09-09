import zlib from 'zlib';
import type { UploadFileType } from './fileStorage.js';
import { STANDARD_FIELDS, CRITICAL_FIELD_IDS, autoMapFields, type StandardFieldId } from '../../shared/dataFields.js';

// ============================================================
// Data Parsing & Validation (card 12) — like fileStorage.ts/filePreview.ts
// before it, no CSV/Excel/PDF parsing library is installed in this repo,
// so everything here is a hand-rolled, pure Node/TS implementation:
//   - CSV/TXT: real delimiter-sniffing + RFC4180-ish quoted-field parsing.
//   - Excel (.xlsx): a minimal ZIP reader (using Node's builtin zlib for
//     DEFLATE) + regex-based XML parsing of the first worksheet. This
//     covers the common case (single-sheet exports from Excel/Sheets/
//     LibreOffice/openpyxl) but is not a full OOXML implementation —
//     legacy .xls (binary, pre-2007) is not zip-based and is not parsed.
//   - PDF: best-effort text extraction from FlateDecode content streams,
//     heuristically re-assembled into lines. PDFs are frequently not
//     tabular once flattened to text, so this is explicitly a fallback,
//     not a structured parse.
// ============================================================

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  sourceFormat: 'csv' | 'txt' | 'excel' | 'pdf' | 'unsupported';
  warnings: string[];
}

export interface RecordValidation {
  isValid: boolean;
  isDuplicate: boolean;
  validationErrors: string[];
}

export interface ParsedRecord extends RecordValidation {
  rawData: Record<string, string>;
  mappedData: Record<StandardFieldId, string | number | null>;
}

export interface ValidationSummary {
  totalRecords: number;
  validRecords: number;
  warningRecords: number;
  errorRecords: number;
  duplicateRecords: number;
}

export { STANDARD_FIELDS, CRITICAL_FIELD_IDS, autoMapFields };
export type { StandardFieldId };

// ------------------------------------------------------------
// Delimited text (CSV/TXT) parsing
// ------------------------------------------------------------

const DELIMITER_CANDIDATES = [',', '\t', ';', '|'] as const;

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      count++;
    }
  }
  return count;
}

// Picks whichever candidate delimiter splits the sample lines into the
// same (non-zero) field count most consistently, preferring more fields
// among equally-consistent candidates. Falls back to comma.
export function detectDelimiter(sampleLines: string[]): string {
  let best = ',' as string;
  let bestScore = -1;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const counts = sampleLines.map((line) => countDelimiterOutsideQuotes(line, delimiter));
    if (counts.length === 0 || counts[0] === 0) continue;
    const consistent = counts.every((c) => c === counts[0]);
    const score = (consistent ? 1000 : 0) + counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
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
    } else if (ch === delimiter) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseDelimitedText(text: string): { headers: string[]; rows: string[][]; delimiter: string } {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], delimiter: ',' };

  const delimiter = detectDelimiter(lines.slice(0, Math.min(10, lines.length)));
  const [headerLine, ...dataLines] = lines;
  const headers = splitDelimitedLine(headerLine, delimiter);
  const rows = dataLines.map((line) => {
    const fields = splitDelimitedLine(line, delimiter);
    // Pad/truncate to header length so downstream mapping never indexes
    // past the end of a short row.
    const normalized = headers.map((_, i) => fields[i] ?? '');
    return normalized;
  });

  return { headers, rows, delimiter };
}

// ------------------------------------------------------------
// Excel (.xlsx) parsing — minimal ZIP + OOXML reader
// ------------------------------------------------------------

function readZipEntries(buffer: Buffer, namePredicate: (name: string) => boolean): Map<string, Buffer> {
  const result = new Map<string, Buffer>();

  const eocdSig = 0x06054b50;
  const maxCommentLen = 65535;
  const searchStart = Math.max(0, buffer.length - 22 - maxCommentLen);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === eocdSig) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Not a valid ZIP file (no end-of-central-directory record found)');

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const cdEntryCount = buffer.readUInt16LE(eocdOffset + 10);

  let cursor = cdOffset;
  const cdSig = 0x02014b50;
  const localSig = 0x04034b50;

  for (let i = 0; i < cdEntryCount; i++) {
    if (buffer.readUInt32LE(cursor) !== cdSig) break;

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.toString('utf8', cursor + 46, cursor + 46 + fileNameLen);

    if (namePredicate(fileName)) {
      if (buffer.readUInt32LE(localHeaderOffset) === localSig) {
        const localFileNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
        const compressedData = buffer.slice(dataStart, dataStart + compressedSize);

        let entryData: Buffer;
        if (compressionMethod === 0) {
          entryData = compressedData;
        } else if (compressionMethod === 8) {
          entryData = zlib.inflateRawSync(compressedData);
        } else {
          cursor += 46 + fileNameLen + extraLen + commentLen;
          continue;
        }
        result.set(fileName, entryData);
      }
    }

    cursor += 46 + fileNameLen + extraLen + commentLen;
  }

  return result;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml))) {
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let text = '';
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(siMatch[1]))) {
      text += decodeXmlEntities(tMatch[1]);
    }
    strings.push(text);
  }
  return strings;
}

// Converts a spreadsheet column letter reference (e.g. the "A" in "A1")
// to a zero-based column index.
function columnLettersToIndex(letters: string): number {
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

function parseSheetXml(xml: string, sharedStrings: string[]): string[][] {
  const sheetDataMatch = /<sheetData>([\s\S]*?)<\/sheetData>/.exec(xml);
  if (!sheetDataMatch) return [];

  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(sheetDataMatch[1]))) {
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    const cells: { col: number; value: string }[] = [];
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] ?? '';
      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      const typeMatch = /t="([^"]+)"/.exec(attrs);
      const col = refMatch ? columnLettersToIndex(refMatch[1]) : cells.length;
      const type = typeMatch ? typeMatch[1] : null;

      let value = '';
      if (type === 's') {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const idx = vMatch ? parseInt(vMatch[1], 10) : NaN;
        value = !isNaN(idx) ? (sharedStrings[idx] ?? '') : '';
      } else if (type === 'inlineStr') {
        const tMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        value = tMatch ? decodeXmlEntities(tMatch[1]) : '';
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
        value = vMatch ? decodeXmlEntities(vMatch[1]) : '';
      }

      cells.push({ col, value });
    }

    if (cells.length === 0) {
      rows.push([]);
      continue;
    }
    const maxCol = Math.max(...cells.map((c) => c.col));
    const rowArray = new Array(maxCol + 1).fill('');
    for (const c of cells) rowArray[c.col] = c.value;
    rows.push(rowArray);
  }

  return rows;
}

export function parseExcel(buffer: Buffer): { headers: string[]; rows: string[][] } | null {
  try {
    const entries = readZipEntries(buffer, (name) => name === 'xl/sharedStrings.xml' || name === 'xl/worksheets/sheet1.xml');
    const sheetBuf = entries.get('xl/worksheets/sheet1.xml');
    if (!sheetBuf) return null;

    const sharedStringsBuf = entries.get('xl/sharedStrings.xml');
    const sharedStrings = sharedStringsBuf ? parseSharedStrings(sharedStringsBuf.toString('utf8')) : [];

    const grid = parseSheetXml(sheetBuf.toString('utf8'), sharedStrings);
    const nonEmptyGrid = grid.filter((row) => row.some((cell) => cell.trim().length > 0));
    if (nonEmptyGrid.length === 0) return null;

    const width = Math.max(...nonEmptyGrid.map((r) => r.length));
    const headers = (nonEmptyGrid[0] ?? []).map((h, i) => (h.trim() ? h.trim() : `Column ${i + 1}`));
    while (headers.length < width) headers.push(`Column ${headers.length + 1}`);

    const rows = nonEmptyGrid.slice(1).map((row) => {
      const padded = row.slice(0, width);
      while (padded.length < width) padded.push('');
      return padded;
    });

    return { headers, rows };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// PDF heuristic text extraction
// ------------------------------------------------------------

function inflateContentStream(raw: Buffer): Buffer | null {
  try {
    return zlib.inflateSync(raw);
  } catch {
    return null;
  }
}

// Pulls plain text out of a decoded PDF content stream by scanning for
// text-showing operators (Tj / TJ) and inserting line breaks on
// positioning operators (Td / TD / T* / ' / "). Not a real PDF content
// stream interpreter — no font/encoding awareness — so results can be
// garbled for non-ASCII text or unusual encodings.
function extractTextFromContentStream(stream: Buffer): string {
  const text = stream.toString('latin1');
  let out = '';
  const tokenRegex = /\((?:[^()\\]|\\.)*\)\s*Tj|\[(?:[^\[\]]|\\.)*\]\s*TJ|T\*|T[dD]|'|"/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text))) {
    const token = match[0];
    if (token.endsWith('Tj')) {
      const strMatch = /^\(((?:[^()\\]|\\.)*)\)/.exec(token);
      if (strMatch) out += strMatch[1].replace(/\\(.)/g, '$1') + ' ';
    } else if (token.endsWith('TJ')) {
      const parts = token.match(/\(((?:[^()\\]|\\.)*)\)/g) ?? [];
      for (const p of parts) {
        out += p.slice(1, -1).replace(/\\(.)/g, '$1');
      }
      out += ' ';
    } else {
      out += '\n';
    }
  }

  return out;
}

export function extractPdfText(buffer: Buffer): { text: string; warnings: string[] } {
  const latin1 = buffer.toString('latin1');
  const warnings: string[] = [];
  let combined = '';

  const streamRegex = /(\/Filter\s*(?:\[[^\]]*\]|\/\w+)[^]*?)?stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  let streamCount = 0;
  let decodedCount = 0;

  while ((match = streamRegex.exec(latin1))) {
    streamCount++;
    const dictText = match[1] ?? '';
    const bodyLatin1 = match[2];
    const bodyBuffer = Buffer.from(bodyLatin1, 'latin1');

    if (/FlateDecode/.test(dictText)) {
      const inflated = inflateContentStream(bodyBuffer);
      if (inflated) {
        decodedCount++;
        combined += extractTextFromContentStream(inflated);
      }
    } else if (/Tj|TJ/.test(bodyLatin1)) {
      // Uncompressed content stream — rare, but handle it directly.
      decodedCount++;
      combined += extractTextFromContentStream(bodyBuffer);
    }
  }

  if (streamCount === 0) {
    warnings.push('No content streams found in this PDF — it may be scanned/image-based, which cannot be parsed without OCR.');
  } else if (decodedCount === 0) {
    warnings.push('PDF content streams could not be decoded (unsupported filter/encoding) — no text could be extracted.');
  } else {
    warnings.push(
      'Text was extracted from the PDF heuristically (no PDF layout engine is available) — rows/columns may not align correctly. Review the field mapping and sample data carefully.'
    );
  }

  return { text: combined, warnings };
}

// Attempts to interpret extracted PDF text as a delimited table; falls
// back to one column of raw lines if no consistent delimiter is found.
function tableFromPdfText(text: string): { headers: string[]; rows: string[][]; warnings: string[] } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [], warnings: ['No extractable text found in this PDF.'] };
  }

  const delimiter = detectDelimiter(lines.slice(0, Math.min(10, lines.length)));
  const hasDelimiter = lines[0].includes(delimiter) && delimiter !== ' ';
  if (hasDelimiter) {
    const parsed = parseDelimitedText(lines.join('\n'));
    return { headers: parsed.headers, rows: parsed.rows, warnings: [] };
  }

  return {
    headers: ['text'],
    rows: lines.map((l) => [l]),
    warnings: [
      'This PDF did not appear to contain a delimited table once flattened to text — each line was kept as a single "text" column. Manual field mapping is unlikely to produce useful structured data for this file.',
    ],
  };
}

// ------------------------------------------------------------
// Top-level dispatch
// ------------------------------------------------------------

export function parseFileBuffer(buffer: Buffer, fileType: UploadFileType | null): ParsedTable {
  if (fileType === 'csv' || fileType === 'txt') {
    const { headers, rows } = parseDelimitedText(buffer.toString('utf8'));
    return { headers, rows, sourceFormat: fileType, warnings: [] };
  }

  if (fileType === 'excel') {
    const parsed = parseExcel(buffer);
    if (parsed) {
      return { headers: parsed.headers, rows: parsed.rows, sourceFormat: 'excel', warnings: [] };
    }
    return {
      headers: [],
      rows: [],
      sourceFormat: 'excel',
      warnings: [
        'This Excel file could not be parsed. Only modern .xlsx workbooks (single-sheet, standard structure) are supported — legacy .xls binary workbooks are not.',
      ],
    };
  }

  if (fileType === 'pdf') {
    const { text, warnings: extractWarnings } = extractPdfText(buffer);
    const { headers, rows, warnings: tableWarnings } = tableFromPdfText(text);
    return { headers, rows, sourceFormat: 'pdf', warnings: [...extractWarnings, ...tableWarnings] };
  }

  return {
    headers: [],
    rows: [],
    sourceFormat: 'unsupported',
    warnings: ['This file type is not supported for parsing.'],
  };
}

// ------------------------------------------------------------
// Record building & validation
// ------------------------------------------------------------

export function buildMappedRecords(
  headers: string[],
  rows: string[][],
  mapping: Record<string, string | null>
): { rawData: Record<string, string>; mappedData: Record<StandardFieldId, string | number | null> }[] {
  return rows.map((row) => {
    const rawData: Record<string, string> = {};
    headers.forEach((h, i) => {
      rawData[h] = row[i] ?? '';
    });

    const mappedData = {} as Record<StandardFieldId, string | number | null>;
    for (const field of STANDARD_FIELDS) {
      const sourceHeader = mapping[field.id];
      const rawValue = sourceHeader !== null && sourceHeader !== undefined ? (rawData[sourceHeader] ?? '') : '';
      const trimmed = rawValue.trim();

      if (field.id === 'amount_due') {
        mappedData[field.id] = trimmed ? parseAmount(trimmed) : null;
      } else {
        mappedData[field.id] = trimmed || null;
      }
    }

    return { rawData, mappedData };
  });
}

// Strips $, commas, whitespace, and parenthetical negatives (accounting
// notation) before parsing. Returns NaN (not null) when the field was
// non-empty but unparseable, so callers can distinguish "missing" from
// "malformed" — validateRecords relies on this.
export function parseAmount(raw: string): number {
  let cleaned = raw.trim();
  let negative = false;
  if (/^\(.*\)$/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.replace(/[$,\s]/g, '');
  if (cleaned === '') return NaN;
  const value = Number(cleaned);
  if (isNaN(value)) return NaN;
  return negative ? -value : value;
}

function duplicateKeys(mappedData: Record<StandardFieldId, string | number | null>): string[] {
  const keys: string[] = [];
  const apn = typeof mappedData.apn === 'string' ? mappedData.apn.trim().toLowerCase() : '';
  if (apn) keys.push(`apn:${apn}`);

  const owner = typeof mappedData.owner_name === 'string' ? mappedData.owner_name.trim().toLowerCase() : '';
  const address =
    typeof mappedData.property_address === 'string' ? mappedData.property_address.trim().toLowerCase() : '';
  if (owner && address) keys.push(`owner_address:${owner}|${address}`);

  return keys;
}

export function validateRecords(
  records: { rawData: Record<string, string>; mappedData: Record<StandardFieldId, string | number | null> }[]
): { records: ParsedRecord[]; summary: ValidationSummary } {
  const seenKeys = new Set<string>();
  const duplicateFlags = records.map((record) => {
    const keys = duplicateKeys(record.mappedData);
    let isDup = false;
    for (const key of keys) {
      if (seenKeys.has(key)) isDup = true;
      seenKeys.add(key);
    }
    return isDup;
  });

  const validated: ParsedRecord[] = records.map((record, i) => {
    const errors: string[] = [];

    if (!record.mappedData.apn) errors.push('Missing APN / parcel number');
    if (!record.mappedData.owner_name) errors.push('Missing owner name');

    const amountRaw = record.mappedData.amount_due;
    if (typeof amountRaw === 'number' && isNaN(amountRaw)) {
      errors.push('Invalid amount due — could not parse as a number');
    }

    const isDuplicate = duplicateFlags[i];
    if (isDuplicate) errors.push('Duplicate record (matching APN or owner + property address)');

    const isValid = !CRITICAL_FIELD_IDS.some((f) => !record.mappedData[f]) && !(typeof amountRaw === 'number' && isNaN(amountRaw));

    return { ...record, isValid, isDuplicate, validationErrors: errors };
  });

  const summary: ValidationSummary = {
    totalRecords: validated.length,
    validRecords: validated.filter((r) => r.isValid && !r.isDuplicate).length,
    warningRecords: validated.filter((r) => r.isValid && r.isDuplicate).length,
    errorRecords: validated.filter((r) => !r.isValid).length,
    duplicateRecords: validated.filter((r) => r.isDuplicate).length,
  };

  return { records: validated, summary };
}
