const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:5000/api';
const TOKEN_STORAGE_KEY = 'rentalERP.authToken';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
}

let authToken: string | null = localStorage.getItem(TOKEN_STORAGE_KEY);

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
};

export const getAuthToken = () => authToken;

export const SESSION_EXPIRED_EVENT = 'auth:expired';
export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please sign in again.';

// Reads the expiry out of a JWT's payload (no verification — the server does
// that); anything unreadable counts as expired since the server would reject it too.
export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

// A 401 on a request that carried a token means the sign-in is no longer valid
// (expired, or the user was removed). Drop it and tell the app to go to the login
// page — the login call itself is exempt, its 401 just means a wrong password.
function handleUnauthorized(path: string, hadToken: boolean): boolean {
  if (!hadToken || path === '/auth/login') return false;
  setAuthToken(null);
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  return true;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error('Unable to reach the server. Please verify the backend is running on port 5000.');
  }

  if (response.status === 401 && handleUnauthorized(path, headers.has('Authorization'))) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  const payload: ApiResponse<T> = await response.json().catch(() => ({ success: false }));
  if (!response.ok || !payload.success) {
    const detail = payload.errors?.map((e) => e.message).join(', ');
    throw new Error(detail || payload.message || 'Request failed');
  }

  return payload.data as T;
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const headers = new Headers();
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (response.status === 401 && handleUnauthorized(path, headers.has('Authorization'))) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  if (!response.ok) {
    throw new Error('Unable to download the file.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export { API_BASE_URL };
