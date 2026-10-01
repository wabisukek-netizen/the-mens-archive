// THE MEN'S ARCHIVE — production Supabase adapter
// Public reads use `apikey` only. Authorization is attached only for an authenticated admin session.
import { normalizeDocument } from './document.js';
export class CloudStore {
  constructor(config = {}) {
    this.config = { ...config };
    const key = this.config.anonKey || '';

    if (!this.config.url || !key || key.startsWith('sb_secret_')) this.config = {};

    try {
      if (key.split('.').length === 3) {
        const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.role !== 'anon') this.config = {};
      }
    } catch {
      if (key && !key.startsWith('sb_publishable_')) this.config = {};
    }

    this.session = null;
    this.refreshing = null;
    this.sessionKey = 'mens-archive-auth:' + (config.url || 'unset');

    try {
      this.session = JSON.parse(sessionStorage.getItem(this.sessionKey) || 'null');
    } catch {}
  }

  get configured() {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(this.config.url || '') &&
      !!this.config.anonKey;
  }

  remember(session) {
    this.session = session;
    try {
      if (session) sessionStorage.setItem(this.sessionKey, JSON.stringify(session));
      else sessionStorage.removeItem(this.sessionKey);
    } catch {}
  }

  async request(path, {
    method = 'GET',
    body,
    auth = true,
    binary = false,
    retry = true,
    headers = {}
  } = {}) {
    if (!this.configured) throw Error('オンライン保存先が未設定です。config.js を確認してください。');

    if (auth && this.session && this.session.expires_at * 1000 < Date.now() + 60000) {
      await this.refresh();
    }

    const authHeaders = auth && this.session?.access_token
      ? { Authorization: 'Bearer ' + this.session.access_token }
      : {};

    const response = await fetch(this.config.url + path, {
      method,
      cache: 'no-store',
      signal: AbortSignal.timeout(body && !(body instanceof Blob) ? 120000 : 30000),
      headers: {
        apikey: this.config.anonKey,
        ...authHeaders,
        ...(body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: body instanceof Blob
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body)
    });

    if (response.status === 401 && auth && this.session && retry) {
      await this.refresh();
      return this.request(path, { method, body, auth, binary, retry: false, headers });
    }

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));

      if (detail.message?.includes('ARCHIVE_CONFLICT')) {
        throw Error('別の画面で更新されています。保存は行いませんでした。「オンラインの最新内容を読み直す」を押してください。');
      }

      if (
        detail.message?.includes('ARCHIVE_FORBIDDEN') ||
        response.status === 401 ||
        response.status === 403
      ) {
        throw Error('管理者の認証が必要です。ログインまたは管理者登録を確認してください。');
      }

      throw Error(
        detail.msg ||
        detail.error_description ||
        detail.message ||
        `通信に失敗しました (${response.status})`
      );
    }

    if (binary) return response.blob();
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async refresh() {
    if (this.refreshing) return this.refreshing;
    if (!this.session?.refresh_token) throw Error('再ログインしてください。');

    this.refreshing = (async () => {
      try {
        const session = await this.request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          auth: false,
          body: { refresh_token: this.session.refresh_token }
        });
        this.remember(session);
      } catch (e) {
        this.remember(null);
        throw e;
      }
    })();

    try { await this.refreshing; }
    finally { this.refreshing = null; }
  }

  async login(email, password) {
    const session = await this.request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      auth: false,
      body: { email, password }
    });

    this.remember(session);

    try {
      return await this.read(true);
    } catch (e) {
      await this.logout();
      throw e;
    }
  }

  async logout() {
    try {
      if (this.session) {
        await this.request('/auth/v1/logout?scope=local', { method: 'POST' });
      }
    } finally {
      this.remember(null);
    }
  }

  read(admin = false) {
    return this.request(
      '/rest/v1/rpc/' + (admin ? 'archive_read_admin' : 'archive_read_public'),
      { method: 'POST', body: {}, auth: admin }
    );
  }

  save(data, revision) {
    if (!this.session?.access_token) throw Error('保存するには管理者ログインが必要です。');
    return this.request('/rest/v1/rpc/archive_save', {
      method: 'POST',
      auth: true,
      body: { payload: normalizeDocument(data), expected_revision: revision }
    });
  }

  async upload(dataURL) {
    if (!this.session?.access_token) throw Error('写真のアップロードには管理者ログインが必要です。');

    const blob = await (await fetch(dataURL)).blob();
    if (!['image/jpeg','image/png','image/webp'].includes(blob.type) || blob.size > 5 * 1024 * 1024) {
      throw Error('写真はJPEG・PNG・WebPの5MB以下にしてください。');
    }

    const ext = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[blob.type];
    const path = crypto.randomUUID() + '.' + ext;

    await this.request('/storage/v1/object/archive-media/' + path, {
      method: 'POST',
      auth: true,
      body: blob,
      headers: {
        'Content-Type': blob.type,
        'Cache-Control': '31536000, immutable'
      }
    });

    return path;
  }

  publicImageUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path) || /^data:image\//i.test(path)) return path;
    if (!/^[a-zA-Z0-9._/-]+$/.test(path)) return '';
    return `${this.config.url}/storage/v1/object/public/archive-media/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  }
}
