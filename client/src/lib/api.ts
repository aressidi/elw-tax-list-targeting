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
