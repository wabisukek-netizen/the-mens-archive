import { CloudStore } from './store.js';

const $ = s => document.querySelector(s);
const store = new CloudStore(window.ARCHIVE_CONFIG || {});
const state = { revision: 0, data: null, selectedId: null, dirty: false };

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
  const d = res?.data || res || {};
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
  $('#saveBtn').disabled = !v;
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
  a.content = $('#body').value;
  a.image = $('#image').value.trim();
  a.imageAlt = $('#imageAlt').value.trim();
  a.references = $('#references').value.trim();
  a.published = $('#published').checked;
  a.status = a.published ? 'published' : 'draft';
  a.publishedAt = iso($('#publishedAt').value || (a.published ? a.publishedAt || now : '')) || '';

  a.updatedAt = now;
  if (!a.createdAt) a.createdAt = now;
  if (!wasPublished && a.published && !a.publishedAt) a.publishedAt = now;
}

function fill(id) {
  const a = state.data.articles.find(x => String(x.id) === String(id));
  if (!a) return;
  state.selectedId = a.id;
  $('#articleId').value = a.id || '';
  $('#title').value = title(a);
  $('#subtitle').value = a.subtitle || '';
  $('#slug').value = a.slug || '';
  $('#topic').value = a.topic || '';
  $('#era').value = a.era || '';
  $('#region').value = a.region || '';
  $('#tags').value = Array.isArray(a.tags) ? a.tags.join(', ') : '';
  $('#description').value = a.description || '';
  $('#body').value = a.body || a.content || '';
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
    <button class="admin-item ${String(a.id)===String(state.selectedId)?'active':''}" data-id="${esc(a.id||'')}">
      <strong>${esc(title(a))}</strong>
      <span>${published(a)?'公開':'下書き'}${a.topic?' · '+esc(a.topic):''}${a.slug?' · /'+esc(a.slug):''}</span>
    </button>
  `).join('') || '<p class="muted">記事はまだありません。</p>';

  document.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>{sync();state.selectedId=b.dataset.id;fill(state.selectedId);renderList();}));
}

function renderMeta() {
  $('#revision').textContent = String(state.revision);
  $('#articleCount').textContent = String(state.data.articles.length);
  $('#publicCount').textContent = String(state.data.articles.filter(published).length);
}

async function addArticle() {
sync();
const now = new Date().toISOString();

const a = {
id: uid(),
title: '新しい記事',
subtitle: '',
slug: '',
topic: '',
era: '',
region: '',
tags: [],
description: '',
body: '',
content: '',
image: '',
imageAlt: '',
references: '',
published: false,
status: 'draft',
publishedAt: null,
createdAt: now,
updatedAt: now
};

state.data.articles.push(a);
state.selectedId = a.id;
fill(a.id);
renderList();
renderMeta();
setDirty(true);

try {
const res = await store.save(state.data, state.revision);
state.revision = Number(
res?.revision ?? res?.new_revision ?? state.revision + 1
);
setDirty(false);
renderMeta();
renderList();
message('新しい下書きを保存しました。');
} catch (e) {
message(e.message, true);
}
}





async function save() {
  sync();
  message('保存中…');
  try {
    const res = await store.save(state.data, state.revision);
    state.revision = Number(res?.revision ?? res?.new_revision ?? state.revision + 1);
    setDirty(false);
    renderMeta();
    renderList();
    message('保存しました。');
    try {
const session = store.session;
if (session?.access_token) {
await fetch('https://vgyefpswvnkzhciudium.supabase.co/functions/v1/trigger-deploy', {
method: 'POST',
headers: {
Authorization: `Bearer ${session.access_token}`,
apikey: window.ARCHIVE_CONFIG?.anonKey || '',
'Content-Type': 'application/json',
},
body: JSON.stringify({ source: 'admin-save' }),
});
}
} catch (deployError) {
console.warn('Deploy trigger failed:', deployError);
}




  } catch(e) {
    message(e.message, true);
  }
}

async function reload() {
  if (state.dirty && !confirm('未保存の変更があります。オンラインの最新内容を読み直しますか？')) return;
  message('読み込み中…');
  try {
    const res = await store.read(true);
    state.revision = Number(res?.revision || 0);
    state.data = normalize(res);
    setDirty(false);
    if (state.selectedId && state.data.articles.some(a=>String(a.id)===String(state.selectedId))) fill(state.selectedId);
    else { state.selectedId = state.data.articles[0]?.id || null; state.selectedId ? fill(state.selectedId) : clearEditor(); }
    renderList(); renderMeta(); message('最新内容を読み直しました。');
  } catch(e) { message(e.message,true); }
}

function remove() {
  const id = $('#articleId').value;
  if (!id || !confirm('この記事を削除しますか？')) return;
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

async function login(e) {
  e.preventDefault();
  message('ログイン中…');
  try {
    const res = await store.login($('#email').value.trim(), $('#password').value);
    state.revision = Number(res?.revision || 0);
    state.data = normalize(res);
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
  $('#reloadBtn').addEventListener('click', reload);
  $('#deleteBtn').addEventListener('click', remove);
  $('#logoutBtn').addEventListener('click', logout);
  $('#adminSearch').addEventListener('input', renderList);
  $('#exportBtn').addEventListener('click', exportBackup);
  $('#importFile').addEventListener('change', e=>importBackup(e.target.files?.[0]));
  $('#imageFile').addEventListener('change', e=>uploadImage(e.target.files?.[0]));
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
