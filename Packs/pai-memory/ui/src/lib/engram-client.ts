const API_BASE = import.meta.env.DEV ? 'http://localhost:3000' : '';

class EngramClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('engram_token', token);
  }

  getToken(): string | null {
    if (!this.token) this.token = localStorage.getItem('engram_token');
    return this.token;
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('engram_token');
  }

  private async request<T>(path: string, opts?: RequestInit): Promise<T> {
    const token = this.getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...opts?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // Auth
  me() {
    return this.request<any>('/me');
  }

  // Search
  search(query: string, opts?: Record<string, any>) {
    return this.request<any>('/search', {
      method: 'POST',
      body: JSON.stringify({ query, ...opts }),
    });
  }

  // Stats
  stats() {
    return this.request<any>('/stats');
  }

  // Sources
  listSources() {
    return this.request<any[]>('/sources');
  }
  createSource(data: any) {
    return this.request<any>('/sources', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  getSource(id: string) {
    return this.request<any>(`/sources/${id}`);
  }
  updateSource(id: string, data: any) {
    return this.request<any>(`/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
  deleteSource(id: string) {
    return this.request<any>(`/sources/${id}`, { method: 'DELETE' });
  }
  syncSource(id: string, force?: boolean) {
    return this.request<any>(`/sources/${id}/sync`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
  }
  getSourceFiles(id: string) {
    return this.request<any[]>(`/sources/${id}/files`);
  }

  // Credentials
  listCredentials() {
    return this.request<any[]>('/credentials');
  }
  createCredential(data: any) {
    return this.request<any>('/credentials', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  deleteCredential(id: string) {
    return this.request<any>(`/credentials/${id}`, { method: 'DELETE' });
  }
  testCredential(id: string) {
    return this.request<any>(`/credentials/${id}/test`, { method: 'POST' });
  }

  // Import
  importMarkdown(files: File[]) {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    const token = this.getToken();
    return fetch(`${API_BASE}/import/markdown`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }).then((r) => r.json());
  }
  importJson(data: any) {
    return this.request<any>('/import/json', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Export
  exportMarkdown(filter: any) {
    return this.request<any>('/export/markdown', {
      method: 'POST',
      body: JSON.stringify(filter),
    });
  }
  exportJson(filter: any) {
    return this.request<any>('/export/json', {
      method: 'POST',
      body: JSON.stringify(filter),
    });
  }

  // Chunks
  getChunk(id: string) {
    return this.request<any>(`/chunk/${id}`);
  }
  updateChunk(id: string, data: any) {
    return this.request<any>(`/chunk/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
  deleteChunk(id: string) {
    return this.request<any>(`/chunk/${id}`, { method: 'DELETE' });
  }

  // Entities
  getEntity(name: string) {
    return this.request<any>(`/entity/${encodeURIComponent(name)}`);
  }
  getEntityChunks(name: string) {
    return this.request<any>(
      `/entity/${encodeURIComponent(name)}/chunks`
    );
  }

  // Tenants
  listTenants() {
    return this.request<any[]>('/tenants');
  }
}

export const engram = new EngramClient();
