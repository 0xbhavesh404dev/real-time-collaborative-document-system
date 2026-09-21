const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('collab_token');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const requestOptions = options.method?.toUpperCase() === 'GET' || !options.method
    ? { cache: 'no-store', ...options }
    : options;
  const response = await fetch(`${API_URL}${path}`, { ...requestOptions, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}
