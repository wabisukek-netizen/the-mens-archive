import { CloudStore } from './store.js';
import { normalizeDocument, validatePublished } from './document.js';

const $ = s => document.querySelector(s);
const store = new CloudStore(window.ARCHIVE_CONFIG || {});
const state = { revision: 0, data: null, selectedId: null, dirty: false, saving: false, editVersion: 0, publishedSlugs: new Map() };

function blankData() {
  return {
    version: 2,
    hero: {
      title: '服を読む。時代を知る。',
      text: '王室からストリートまで。メンズファッションを通じて、歴史・文化・音楽・デザインのつながりを読み解く。',
      image: ''
    },
    topicImages: {},
    topics: ['HISTORY','ICONS & DESIGNERS','MUSIC & CULTURE','VINTAGE','GARMENTS & CRAFT','MODERN STYLE','BRANDS','VISUAL ARCHIVE'],
    eras: ['1900s','1920s','1930s','1940s','1950s','1960s','1970s','1980s','1990s','2000s','2010s','2020s'],
    articles: []
  };
}
function normalize(res) {
  const d = normalizeDocument(res?.data || res || {});
  const b = blankData();
  return {
    ...b, ...d,
    hero: {...b.hero, ...(d.hero || {})},
    topicImages: d.topicImages && typeof d.topicImages === 'object' ? d.topicImages : {},
    topics: Array.isArray(d.topics) ? d.topics : b.topics,
    eras: Array.isArray(d.eras) ? d.eras : b.eras,
    articles: Array.isArray(d.articles) ? d.articles : []
  };
}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function title(a){return a?.title || a?.name || '無題';}
function published(a){return a?.published === true || a?.status === 'published';}
function uid(){return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;}
function toLocal(v){if(!v)return'';const d=new Date(v);if(Number.isNaN(d.getTime()))return'';const p=n=>String(n).padStart(2,'0');return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
function iso(v){if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString();}
function message(t='', err=false){const el=$('#msg');el.textContent=t;el.classList.toggle('error',err);}

function setDirty(v=true) {
  state.dirty = v;
  if (v) state.editVersion++;
  $('#saveBtn').disabled = !v || state.saving;
}

function sync() {
  const id = $('#articleId').value;
  if (!id) return;
  const a = state.data.articles.find(x => String(x.id) === String(id));
  if (!a) return;

  const wasPublished = published(a);
  const now = new Date().toISOString();

  a.title = $('#title').value.trim();
  a.subtitle = $('#subtitle').value.trim();
  a.slug = $('#slug').value.trim();
  a.topic = $('#topic').value.trim();
  a.era = $('#era').value.trim();
  a.region = $('#region').value.trim();
  a.tags = $('#tags').value.split(',').map(x=>x.trim()).filter(Boolean);
  a.description = $('#description').value.trim();
  a.body = $('#body').value;
  // Keep the legacy alias only on records that already use it. New articles
  // store one body, avoiding a second copy of every long article in the RPC.
  if (Object.hasOwn(a, 'content')) a.content = a.body;
  a.image = $('#image').value.trim();
  a.imageAlt = $('#imageAlt').value.trim();
  a.references = $('#references').value.trim();
  a.published = $('#published').checked;
  a.status = a.published ? 'published' : 'draft';
  a.publishedAt = iso($('#publishedAt').value) || (a.published ? a.publishedAt || now : a.publishedAt || null);
  a.updatedAt = now;
  if (!a.createdAt) a.createdAt = now;
  if (!wasPublished && a.published && !a.publishedAt) a.publishedAt = now;
}

function fill(id) {
  const a = state.data.articles.find(x => String(x.id) === String(id));
  if (!a) return;
  state.selectedId = a.id;
  $('#articleId').value = a.id || '';
  $('#title').value = a.title ?? a.name ?? '';
  $('#subtitle').value = a.subtitle || '';
  $('#slug').value = a.slug || '';
  $('#topic').value = a.topic || '';
  $('#era').value = a.era || '';
  $('#region').value = a.region || '';
  $('#tags').value = Array.isArray(a.tags) ? a.tags.join(', ') : '';
  $('#description').value = a.description || '';
  $('#body').value = a.body ?? a.content ?? '';
  $('#image').value = a.image || a.imagePath || '';
  $('#imageAlt').value = a.imageAlt || '';
  $('#references').value = a.references || '';
  $('#published').checked = published(a);
  $('#publishedAt').value = toLocal(a.publishedAt);
  $('#deleteBtn').disabled = false;
}

function clearEditor() {
  $('#editor').reset();
  $('#articleId').value = '';
  $('#deleteBtn').disabled = true;
}

function renderList() {
  const q = $('#adminSearch').value.trim().toLowerCase();
  const list = state.data.articles
    .filter(a => !q || [title(a), a.slug, a.topic, a.era].some(v => String(v||'').toLowerCase().includes(q)))
    .sort((a,b)=>title(a).localeCompare(title(b),'ja'));

  $('#list').innerHTML = list.map(a=>`
    <div class="admin-item ${String(a.id)===String(state.selectedId)?'active':''}">
      <button class="admin-item-main" data-id="${esc(a.id||'')}">
        <strong>${esc(title(a))}</strong>
        <span>${published(a)?'公開':'下書き'}${a.topic?' · '+esc(a.topic):''}${a.slug?' · /'+esc(a.slug):''}</span>
      </button>
      ${published(a)?'':`<button class="admin-item-del" data-del-idx="${state.data.articles.indexOf(a)}" title="この下書きを削除します">削除</button>`}
    </div>
  `).join('') || '<p class="muted">記事はまだありません。</p>';

  document.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>{sync();state.selectedId=b.dataset.id;fill(state.selectedId);renderList();}));
  document.querySelectorAll('[data-del-idx]').forEach(b=>b.addEventListener('click',()=>removeDraft(Number(b.dataset.delIdx))));
  refreshLinkTargets();
}

// 下書き専用の削除（一覧から直接）。公開済み記事にはボタン自体を出さない。
// 実際の削除は「保存する」を押した時点で確定する（従来の編集画面の削除と同じ）。
function removeDraft(idx) {
  const a = state.data.articles[idx];
  if (!a || published(a)) return;
  if (!confirm(`下書き「${title(a)}」を削除しますか？\n「保存する」を押すと削除が確定します。`)) return;
  const wasSelected = String(state.selectedId) === String(a.id);
  state.data.articles.splice(idx, 1);
  if (wasSelected) {
    state.selectedId = state.data.articles[0]?.id || null;
    state.selectedId ? fill(state.selectedId) : clearEditor();
  }
  renderList(); renderMeta(); setDirty(true);
  message('下書きを削除しました。「保存する」を押すと確定します。');
}

function renderMeta() {
  $('#revision').textContent = String(state.revision);
  $('#articleCount').textContent = String(state.data.articles.length);
  $('#publicCount').textContent = String(state.data.articles.filter(published).length);
}

function addArticle() {
  sync();
  const now = new Date().toISOString();
  const a = {
    id: uid(), title:'', subtitle:'', slug:'', topic:'', era:'', region:'',
    tags:[], description:'', body:'', image:'', imageAlt:'', references:'',
    published:false, status:'draft', publishedAt:null, createdAt:now, updatedAt:now
  };
  state.data.articles.push(a);
  state.selectedId = a.id;
  fill(a.id);
  renderList();
  renderMeta();
  setDirty(true);
}

// ---- 公開合図（trigger-deploy）の扱い ----
// 応答の中身を見る: status が明示され、それが 'started' でなければ開始していない。
// status 欄の無い応答（旧関数）は従来どおり開始とみなす（後方互換）。
function deployCooldownSeconds(err) {
  const d = err?.detail || {};
  if (d?.status === 'cooldown') {
    const n = Number(d.retryAfterSeconds);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 60) : 30;
  }
  if (err?.status === 429) return 30;
  return 0;
}

async function callDeploy() {
  const res = await store.request('/functions/v1/trigger-deploy', { method: 'POST', auth: true, body: {} });
  if (res && typeof res === 'object' && 'status' in res && res.status !== 'started') {
    const err = new Error('公開は開始されませんでした（' + res.status + '）');
    err.detail = res;
    throw err;
  }
  return res;
}

async function deployWithRetry(successMessage) {
  try {
    await callDeploy();
    message(successMessage);
    return true;
  } catch (e) {
    const wait = deployCooldownSeconds(e);
    if (!wait) throw e;
    message(`公開の合図が短時間に重なったため、${wait}秒後に自動で再試行します。`);
    setTimeout(async () => {
      if (state.dirty || state.saving) return;
      try { await callDeploy(); message('公開サイトの更新を開始しました。'); }
      catch { message('公開はまだ始まっていません。「公開サイトを更新」ボタンで再試行できます。', true); }
    }, wait * 1000);
    return false;
  }
}

async function deployAfterSave() {
  try {
    await deployWithRetry('保存しました。公開サイトの更新を開始しました。');
  } catch (e) {
    message('記事は保存済みです。自動公開の開始に失敗しました: ' + e.message + ' 「公開サイトを更新」ボタンで再試行できます。', true);
  }
}

async function manualDeploy() {
  message('公開サイトの更新を依頼しています…');
  try {
    await deployWithRetry('公開サイトの更新を開始しました。数分後に反映されます。');
  } catch (e) {
    message('公開の開始に失敗しました: ' + e.message, true);
  }
}

async function save() {
  if (state.saving) return;
  sync();
  const snapshot = normalizeDocument(state.data);
  try { validatePublished(snapshot, state.publishedSlugs); }
  catch (e) { message(e.message, true); return; }
  message('保存中…');
  state.saving = true;
  $('#saveBtn').disabled = true;
  const editVersion = state.editVersion;
  try {
    const res = await store.save(snapshot, state.revision);
    state.revision = Number(res?.revision ?? res?.new_revision ?? state.revision + 1);
    state.publishedSlugs = publishedSlugMap(snapshot);
    if (state.editVersion === editVersion) state.dirty = false;
    if (state.dirty) {
      message('保存中に新しい編集がありました。もう一度保存してください。');
    } else {
      await deployAfterSave();
    }
    // 描画の失敗が公開の合図を巻き込まないよう、描画は隔離して最後に行う。
    try { renderMeta(); renderList(); } catch {}





  } catch(e) {
    message(e.message, true);
  } finally {
    state.saving = false;
    $('#saveBtn').disabled = !state.dirty;
  }
}

function publishedSlugMap(data) {
  return new Map(data.articles.filter(published).map(a => [String(a.id), a.slug]));
}

async function reload() {
  if (state.dirty && !confirm('未保存の変更があります。オンラインの最新内容を読み直しますか？')) return;
  message('読み込み中…');
  try {
    const res = await store.read(true);
    state.revision = Number(res?.revision || 0);
    state.data = normalize(res);
    state.publishedSlugs = publishedSlugMap(state.data);
    setDirty(false);
    if (state.selectedId && state.data.articles.some(a=>String(a.id)===String(state.selectedId))) fill(state.selectedId);
    else { state.selectedId = state.data.articles[0]?.id || null; state.selectedId ? fill(state.selectedId) : clearEditor(); }
    renderList(); renderMeta(); message('最新内容を読み直しました。');
  } catch(e) { message(e.message,true); }
}

function remove() {
  const id = $('#articleId').value;
  const target = state.data.articles.find(x => String(x.id) === String(id));
  if (!id) return;
  if (target && published(target)) { message('公開済み記事は削除できません（公開URLを守るため）。', true); return; }
  if (!confirm(`「${target ? title(target) : 'この記事'}」を削除しますか？`)) return;
  state.data.articles = state.data.articles.filter(a=>String(a.id)!==String(id));
  state.selectedId = state.data.articles[0]?.id || null;
  state.selectedId ? fill(state.selectedId) : clearEditor();
  renderList(); renderMeta(); setDirty(true);
}

function exportBackup() {
  sync();
  const blob = new Blob([JSON.stringify({revision:state.revision,data:state.data},null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=`the-mens-archive-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const data = parsed?.data || parsed;
    if (!data || !Array.isArray(data.articles)) throw Error('バックアップ形式が正しくありません。');
    if (!confirm('現在の編集内容をバックアップ内容で置き換えますか？')) return;
    state.data = normalize({data});
    state.selectedId = state.data.articles[0]?.id || null;
    state.selectedId ? fill(state.selectedId) : clearEditor();
    renderList(); renderMeta(); setDirty(true); message('バックアップを読み込みました。保存ボタンを押してください。');
  } catch(e) { message('読み込めません：'+e.message,true); }
}

async function uploadImage(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    message('画像アップロード中…');
    try {
      const path = await store.upload(reader.result);
      $('#image').value = path;
      sync(); setDirty(true); message('画像をアップロードしました。保存ボタンを押してください。');
    } catch(e) { message(e.message,true); }
  };
  reader.readAsDataURL(file);
}

async function uploadBodyImage(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    message('画像アップロード中…');
    try {
      const path = await store.upload(reader.result);
      $('#bodyImagePath').value = path;
      message('画像をアップロードしました。出典とライセンスを入力して「本文のカーソル位置に画像を挿入」を押してください。');
    } catch(e) { message(e.message,true); }
  };
  reader.readAsDataURL(file);
}

function insertBodyImage() {
  const path = $('#bodyImagePath').value.trim();
  const alt = $('#bodyImageAlt').value.trim();
  const source = $('#bodyImageSource').value.trim();
  const license = $('#bodyImageLicense').value.trim();
  if (!path) { message('先に画像をアップロードするか、画像パスを入力してください。', true); return; }
  if (!alt) { message('代替テキスト（alt）を入力してください。', true); return; }
  if (!source || !license) { message('出典URLとライセンスを入力してください（未記録の画像は公開できません）。', true); return; }
  const escAttr = v => v.replace(/"/g, '&quot;');
  let token = `[[img src="${escAttr(path)}" alt="${escAttr(alt)}"`;
  const cap = $('#bodyImageCaption').value.trim();
  if (cap) token += ` caption="${escAttr(cap)}"`;
  const credit = $('#bodyImageCredit').value.trim();
  if (credit) token += ` credit="${escAttr(credit)}"`;
  token += ` source="${escAttr(source)}" license="${escAttr(license)}"]]`;
  const ta = $('#body');
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  const insert = (before && !before.endsWith('\n') ? '\n' : '') + token + '\n';
  ta.value = before + insert + after;
  ta.focus();
  ta.selectionStart = ta.selectionEnd = (before + insert).length;
  sync(); setDirty(true);
  message('本文に画像を挿入しました。保存ボタンを押してください。');
}

function refreshLinkTargets() {
  const sel = $('#linkTarget');
  if (!sel) return;
  const current = sel.value;
  const items = (state.data?.articles || []).filter(a => (a.published || a.status === 'published') && a.slug);
  sel.replaceChildren(...items.map(a => {
    const o = document.createElement('option');
    o.value = a.slug;
    o.textContent = a.title || a.slug;
    return o;
  }));
  if (!items.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '公開済み記事がありません';
    sel.replaceChildren(o);
    return;
  }
  if (items.some(a => a.slug === current)) sel.value = current;
}

function insertAtCursor(text, ownLine) {
  const ta = $('#body');
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  const insert = ownLine ? (before && !before.endsWith('\n') ? '\n' : '') + text + '\n' : text;
  ta.value = before + insert + after;
  ta.focus();
  ta.selectionStart = ta.selectionEnd = (before + insert).length;
  sync(); setDirty(true);
}

function insertLink() {
  const slug = $('#linkTarget').value;
  if (!slug) { message('リンク先の記事がありません。', true); return; }
  const escAttr = v => v.replace(/"/g, '&quot;');
  const text = $('#linkText').value.trim();
  const token = text ? `[[link slug="${escAttr(slug)}" text="${escAttr(text)}"]]` : `[[link slug="${escAttr(slug)}"]]`;
  insertAtCursor(token, false);
  message('本文にリンクを挿入しました。保存ボタンを押してください。');
}

function insertTimeline() {
  insertAtCursor('[[timeline]]\n年代 | 出来事を書きます\n[[/timeline]]', true);
  message('本文に年表の枠を挿入しました。「年代 | 出来事」の形で書き換えてください。');
}

async function login(e) {
  e.preventDefault();
  message('ログイン中…');
  try {
    const res = await store.login($('#email').value.trim(), $('#password').value);
    state.revision = Number(res?.revision || 0);
    state.data = normalize(res);
    state.publishedSlugs = publishedSlugMap(state.data);
    $('#login').hidden = true;
    $('#workspace').hidden = false;
    state.selectedId = state.data.articles[0]?.id || null;
    state.selectedId ? fill(state.selectedId) : clearEditor();
    renderList(); renderMeta(); setDirty(false); message('');
  } catch(e2) { message(e2.message,true); }
}

async function logout() {
  if (state.dirty && !confirm('未保存の変更があります。ログアウトしますか？')) return;
  await store.logout().catch(()=>{});
  location.reload();
}

function bind() {
  $('#loginForm').addEventListener('submit', login);
  $('#newBtn').addEventListener('click', addArticle);
  $('#saveBtn').addEventListener('click', save);
  $('#deployBtn').addEventListener('click', manualDeploy);
  $('#reloadBtn').addEventListener('click', reload);
  $('#deleteBtn').addEventListener('click', remove);
  $('#logoutBtn').addEventListener('click', logout);
  $('#adminSearch').addEventListener('input', renderList);
  $('#exportBtn').addEventListener('click', exportBackup);
  $('#importFile').addEventListener('change', e=>importBackup(e.target.files?.[0]));
  $('#imageFile').addEventListener('change', e=>uploadImage(e.target.files?.[0]));
  $('#bodyImageFile').addEventListener('change', e=>uploadBodyImage(e.target.files?.[0]));
  $('#insertImageBtn').addEventListener('click', insertBodyImage);
  $('#insertLinkBtn').addEventListener('click', insertLink);
  $('#insertTimelineBtn').addEventListener('click', insertTimeline);
  $('#editor').addEventListener('input', ()=>{sync();setDirty(true);});
  window.addEventListener('beforeunload', e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});
}

async function boot() {
  bind();
  if (!store.configured) { message('Supabaseの接続設定が未完了です。',true); return; }

  if (store.session?.access_token) {
    try {
      const res = await store.read(true);
      state.revision = Number(res?.revision || 0);
      state.data = normalize(res);
      state.publishedSlugs = publishedSlugMap(state.data);
      $('#login').hidden = true;
      $('#workspace').hidden = false;
      state.selectedId = state.data.articles[0]?.id || null;
      state.selectedId ? fill(state.selectedId) : clearEditor();
      renderList(); renderMeta(); setDirty(false);
      return;
    } catch { await store.logout().catch(()=>{}); }
  }
  $('#login').hidden = false;
  $('#workspace').hidden = true;
}
boot();
