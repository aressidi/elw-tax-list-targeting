export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  [key: string]: unknown;
}

async function handle<T>(res: Response): Promise<Envelope<T>> {
  let json: Envelope<T>;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('Unexpected server response', res.status);
  }
  if (!res.ok || !json.success) {
    throw new ApiError(json.error || `Request failed with status ${res.status}`, res.status);
  }
  return json;
}

export async function apiGet<T>(path: string): Promise<Envelope<T>> {
  const res = await fetch(path);
  return handle<T>(res);
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<Envelope<T>> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res);
}

// Uses XMLHttpRequest rather than fetch so we can report upload progress —
// fetch has no cross-browser-reliable way to observe request-body upload
// progress, only response download progress.
export function apiUpload<T>(
  path: string,
  file: File,
  onProgress?: (percent: number) => void
): { promise: Promise<Envelope<T>>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const formData = new FormData();
  formData.append('file', file);

  const promise = new Promise<Envelope<T>>((resolve, reject) => {
    xhr.open('POST', path);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });
    }

    xhr.addEventListener('load', () => {
      let json: Envelope<T>;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        reject(new ApiError('Unexpected server response', xhr.status));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && json.success) {
        resolve(json);
      } else {
        reject(new ApiError(json.error || `Request failed with status ${xhr.status}`, xhr.status));
      }
    });

    xhr.addEventListener('error', () => reject(new ApiError('Network error during upload', 0)));
    xhr.addEventListener('abort', () => reject(new ApiError('Upload cancelled', 0)));

    xhr.send(formData);
  });

  return { promise, abort: () => xhr.abort() };
}
