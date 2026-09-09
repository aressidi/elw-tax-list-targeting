import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request } from 'express';

// ============================================================
// File Upload & Storage (card 11) — no multipart-parsing dependency
// (multer/busboy) is installed in this repo and the sandbox this was
// written in cannot run `npm install`, so this is a small hand-rolled
// multipart/form-data reader built on Node's http/fs/crypto builtins only.
// It buffers the whole request body in memory, which is fine at the
// MAX_FILE_SIZE_BYTES ceiling below but would need to become streaming
// if that ceiling ever grows into the hundreds of MB.
// ============================================================

export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export type UploadFileType = 'csv' | 'pdf' | 'excel' | 'txt' | 'other';

const EXTENSION_TO_FILE_TYPE: Record<string, UploadFileType> = {
  '.csv': 'csv',
  '.pdf': 'pdf',
  '.xlsx': 'excel',
  '.xls': 'excel',
  '.txt': 'txt',
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(EXTENSION_TO_FILE_TYPE));

const EXTENSION_TO_MIME: Record<string, string> = {
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.txt': 'text/plain',
};

export function ensureUploadsDir(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Strips directory components, null bytes, and anything that isn't a
// reasonable filename character. What actually lands on disk is a
// generated UUID name (see storedFilenameFor) -- this sanitized value is
// only ever used for display and for the Content-Disposition header, but
// it's sanitized anyway since a malicious originalFilename could otherwise
// be used for header injection or displayed unsafely in the UI.
export function sanitizeOriginalFilename(rawName: string): string {
  const noNulls = rawName.replace(/\0/g, '');
  const base = path.basename(noNulls.replace(/\\/g, '/'));
  const cleaned = base.replace(/[^a-zA-Z0-9 ._-]/g, '_').trim();
  return cleaned.slice(0, 255) || 'upload';
}

export function extensionFor(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function detectFileType(filename: string): UploadFileType | null {
  const ext = extensionFor(filename);
  return EXTENSION_TO_FILE_TYPE[ext] ?? null;
}

export function mimeTypeFor(filename: string): string {
  const ext = extensionFor(filename);
  return EXTENSION_TO_MIME[ext] ?? 'application/octet-stream';
}

export function isAllowedExtension(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(extensionFor(filename));
}

// Content-addressable-ish: <listRequestId>-<uuid>.<ext>. Guarantees no path
// traversal (the extension is drawn from an allowlist, everything else is
// generated) and no collisions between concurrent uploads for the same or
// different requests.
export function storedFilenameFor(listRequestId: number, originalFilename: string): string {
  const ext = extensionFor(originalFilename);
  return `${listRequestId}-${randomUUID()}${ext}`;
}

export function absoluteUploadPath(storedFilename: string): string {
  return path.join(UPLOADS_DIR, storedFilename);
}

// filePath as stored in the DB / returned over the API: relative to the
// repo root, e.g. "uploads/12-<uuid>.csv".
export function relativeUploadPath(storedFilename: string): string {
  return path.posix.join('uploads', storedFilename);
}

export function absolutePathFromRelative(relativePath: string): string {
  const resolved = path.resolve(process.cwd(), relativePath);
  // Belt-and-suspenders: refuse to touch anything outside uploads/, even
  // though relativePath always originates from our own DB rows and is
  // never taken directly from user input.
  if (!resolved.startsWith(UPLOADS_DIR + path.sep) && resolved !== UPLOADS_DIR) {
    throw new Error('Resolved path escapes the uploads directory');
  }
  return resolved;
}

// Reads the whole request body into memory, aborting once it exceeds
// maxBytes so an oversized upload can't be used to exhaust server memory.
export function readRawBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

export interface MultipartField {
  fieldName: string;
  filename: string | null;
  contentType: string | null;
  data: Buffer;
}

export function parseContentTypeBoundary(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = /multipart\/form-data;.*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  return (match[1] || match[2] || '').trim();
}

// Minimal multipart/form-data reader. Handles the standard shape produced
// by browser FormData (and curl -F): each part separated by
// "--<boundary>\r\n", headers, blank line, body, terminated by
// "--<boundary>--". Operates on raw Buffers throughout so binary file
// contents (PDF/Excel) are never corrupted by string re-encoding.
export function parseMultipart(body: Buffer, boundary: string): MultipartField[] {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const fields: MultipartField[] = [];

  let cursor = body.indexOf(boundaryBuf);
  if (cursor === -1) return fields;
  cursor += boundaryBuf.length;

  while (true) {
    if (body.slice(cursor, cursor + 2).toString('latin1') === '--') break;

    if (body.slice(cursor, cursor + 2).toString('latin1') === '\r\n') {
      cursor += 2;
    }

    const nextBoundary = body.indexOf(boundaryBuf, cursor);
    if (nextBoundary === -1) break;

    // Trailing \r\n before the next boundary belongs to the multipart
    // framing, not the part's content.
    let partEnd = nextBoundary;
    if (body.slice(partEnd - 2, partEnd).toString('latin1') === '\r\n') {
      partEnd -= 2;
    }

    const partBuf = body.slice(cursor, partEnd);
    const headerEnd = partBuf.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = partBuf.slice(0, headerEnd).toString('utf8');
      const dataBuf = partBuf.slice(headerEnd + 4);

      const dispositionMatch = /Content-Disposition:\s*form-data;\s*name="([^"]*)"(?:;\s*filename="([^"]*)")?/i.exec(
        headerText
      );
      if (dispositionMatch) {
        const contentTypeMatch = /^Content-Type:\s*(.+)$/im.exec(headerText);
        fields.push({
          fieldName: dispositionMatch[1],
          filename: dispositionMatch[2] !== undefined ? dispositionMatch[2] : null,
          contentType: contentTypeMatch ? contentTypeMatch[1].trim() : null,
          data: dataBuf,
        });
      }
    }

    cursor = nextBoundary + boundaryBuf.length;
  }

  return fields;
}
