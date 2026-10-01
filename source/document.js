// Shared, lossless document preparation for the browser and static builder.
const textFields = ['title','name','subtitle','slug','topic','era','region','description','excerpt','body','content','image','imagePath','imageAlt','references','author','authorUrl'];
const dateFields = ['createdAt','updatedAt','publishedAt'];
const text = value => value == null ? '' : Array.isArray(value) ? value.map(text).join('\n') : typeof value === 'object' ? JSON.stringify(value) : String(value);
const date = value => {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
function clean(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return date(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,clean(v)]));
  return value;
}
export function normalizeDocument(input) {
  const data = clean(input && typeof input === 'object' && !Array.isArray(input) ? input : {});
  data.articles = Array.isArray(data.articles) ? data.articles.map(item => {
    const article = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    for (const field of textFields) if (field in article) article[field] = text(article[field]);
    article.tags = Array.isArray(article.tags) ? article.tags.map(text).filter(Boolean) : article.tags == null ? [] : text(article.tags).split(',').map(x=>x.trim()).filter(Boolean);
    for (const field of dateFields) if (field in article) article[field] = date(article[field]);
    // Both names are retained for existing readers and legacy articles.
    const body = article.body || article.content || '';
    article.body = body;
    if ('content' in article) article.content = body;
    const isPublic = article.published === true || article.status === 'published';
    article.published = isPublic;
    article.status = isPublic ? 'published' : 'draft';
    return article;
  }) : [];
  return data;
}

export function validatePublished(data, originalSlugs = new Map()) {
  const slugs = new Set();
  const byId = new Map(data.articles.map(a => [String(a.id), a]));
  for (const [id, oldSlug] of originalSlugs) {
    const current = byId.get(id);
    if (!current || !current.published) throw Error(`公開済み記事「${oldSlug}」の非公開・削除は既存URLに影響します。先に転送先を用意してください。`);
  }
  for (const [index, a] of data.articles.entries()) {
    if (!a.published) continue;
    const label = a.title?.trim() || `記事 ${index+1}`;
    if (!a.title?.trim()) throw Error(`${label}：公開するにはタイトルが必要です。`);
    if (!a.body?.trim()) throw Error(`${label}：公開するには本文が必要です。`);
    if (!a.topic?.trim() || !data.topics?.includes(a.topic)) throw Error(`${label}：公開するには登録済みのTOPICを指定してください。`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug || '')) throw Error(`${label}：slug は英小文字・数字・ハイフンで入力してください。`);
    if (slugs.has(a.slug)) throw Error(`slug「${a.slug}」が重複しています。`);
    slugs.add(a.slug);
    const old = originalSlugs.get(String(a.id));
    if (old && old !== a.slug) throw Error(`${label}：公開済みのslugを変更すると既存URLが消えます。元の「${old}」に戻してください。`);
  }
}
