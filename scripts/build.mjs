import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = path.join(root, 'source');
const out = path.join(root, 'site');
const args = process.argv.slice(2);
const fixtureIndex = args.indexOf('--fixture');
const fixture = fixtureIndex >= 0 ? args[fixtureIndex + 1] : null;

const SITE_URL = (process.env.SITE_URL || 'https://the-mens-archive.pages.dev').replace(/\/$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vgyefpswvnkzhciudium.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_u8lrye0It1b3CuutwEPN8w_uigAGHnD';
const PAGE_SIZE = 24;

const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attr = esc;
const slugify = (v='') => String(v).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').replace(/-+/g,'-') || 'archive';
const jsonScript = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026')}</script>`;
const abs = p => /^https?:\/\//i.test(p||'') ? p : p ? `${SUPABASE_URL}/storage/v1/object/public/archive-media/${encodeURIComponent(p).replace(/%2F/g,'/')}` : '';
const iso = v => { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };
const dateLabel = v => { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ja-JP',{dateStyle:'long',timeZone:'Asia/Tokyo'}).format(d); };
const isPublished = a => a?.published === true || a?.status === 'published';
const articleTitle = a => a?.title || a?.name || '無題';
const articleBody = a => a?.body || a?.content || '';
const desc = a => (a?.description || a?.excerpt || articleBody(a).replace(/[#*_>`\n]/g,' ').replace(/\s+/g,' ').trim()).slice(0,180);

function renderTextBody(text='') {
  const lines = String(text).replace(/\r/g,'').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(esc).join('<br>')}</p>`); para=[]; } };
  for (const line of lines) {
    if (!line.trim()) { flush(); continue; }
    if (/^###\s+/.test(line)) { flush(); out.push(`<h3>${esc(line.replace(/^###\s+/,''))}</h3>`); continue; }
    if (/^##\s+/.test(line)) { flush(); out.push(`<h2>${esc(line.replace(/^##\s+/,''))}</h2>`); continue; }
    if (/^>\s+/.test(line)) { flush(); out.push(`<blockquote>${esc(line.replace(/^>\s+/,''))}</blockquote>`); continue; }
    para.push(line);
  }
  flush();
  return out.join('\n');
}

async function readText(name) { return fs.readFile(path.join(source,name),'utf8'); }
async function write(rel, content) { const p=path.join(out,rel); await fs.mkdir(path.dirname(p),{recursive:true}); await fs.writeFile(p,content); }
function replaceAll(t, vars) { for (const [k,v] of Object.entries(vars)) t=t.split(`{{${k}}}`).join(String(v ?? '')); return t; }

async function fetchData() {
  if (fixture) return JSON.parse(await fs.readFile(path.resolve(root, fixture),'utf8'));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/archive_read_public`, {
    method:'POST',
    headers:{apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
    body:'{}'
  });
  if (!res.ok) throw new Error(`archive_read_public failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function card(a) {
  const url = `/articles/${a.slug}/`;
  const image = abs(a.image || a.imagePath || '');
  const search = [articleTitle(a),a.subtitle,a.description,articleBody(a),a.topic,a.era,(a.tags||[]).join(' ')].join(' ');
  return `<article class="story" data-search="${attr(search)}" data-topic="${attr(a.topic||'')}" data-era="${attr(a.era||'')}"><a class="stretched" href="${url}"><div class="story-image ${image?'':'placeholder'}">${image?`<img src="${attr(image)}" alt="${attr(a.imageAlt||articleTitle(a))}" loading="lazy">`:'<span>THE MEN’S ARCHIVE</span>'}</div><div class="story-copy"><div class="eyebrow">${esc(a.topic||'')}${a.topic&&a.era?' / ':''}${esc(a.era||'')}</div><h3>${esc(articleTitle(a))}</h3>${a.subtitle?`<p class="story-sub">${esc(a.subtitle)}</p>`:''}<p>${esc(desc(a))}</p><div class="story-foot"><span>${esc(dateLabel(a.publishedAt||a.updatedAt))}</span><span>READ ↗</span></div></div></a></article>`;
}

function collectionJsonLd({title,description,url,items}) {
  return jsonScript({
    '@context':'https://schema.org','@graph':[
      {'@type':'CollectionPage','@id':url+'#page',url,name:title,description,inLanguage:'ja',isPartOf:{'@id':SITE_URL+'/#website'}},
      {'@type':'ItemList',itemListElement:items.map((a,i)=>({'@type':'ListItem',position:i+1,url:`${SITE_URL}/articles/${a.slug}/`,name:articleTitle(a)}))}
    ]
  });
}

async function buildCollection({rel,title,heading,description,intro,eyebrow,items,breadcrumb}) {
  const template = await readText('collection.template.html');
  const pageCount = Math.max(1, Math.ceil(items.length/PAGE_SIZE));
  for (let page=1; page<=pageCount; page++) {
    const slice = items.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
    const pageRel = page===1 ? rel : path.join(rel,'page',String(page));
    const url = `${SITE_URL}/${pageRel.replace(/\\/g,'/').replace(/^\/+|\/+$/g,'')}/`;
    const pageTitle = page===1 ? title : `${title} | ${page}ページ目`;
    const pagination = pageCount>1 ? `<nav class="pagination" aria-label="ページ送り">${Array.from({length:pageCount},(_,i)=>{const n=i+1;const href=n===1?`/${rel}/`:`/${rel}/page/${n}/`;return n===page?`<strong>${n}</strong>`:`<a href="${href}">${n}</a>`;}).join('')}</nav>` : '';
    const html = replaceAll(template,{
      TITLE:esc(pageTitle),DESCRIPTION:attr(description),CANONICAL:attr(url),JSONLD:collectionJsonLd({title:pageTitle,description,url,items:slice}),
      BREADCRUMB:breadcrumb,EYEBROW:esc(eyebrow),HEADING:esc(heading),INTRO:esc(intro),ARTICLE_CARDS:slice.map(card).join('')||'<p class="empty">公開記事はまだありません。</p>',PAGINATION:pagination
    });
    await write(path.join(pageRel,'index.html'),html);
  }
}

async function main() {
  const raw = await fetchData();
  const data = raw?.data || raw || {};
  const published = (Array.isArray(data.articles)?data.articles:[]).filter(isPublished);
  const seen = new Set();
  for (const a of published) {
    if (!a.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug)) throw new Error(`Published article has invalid slug: ${articleTitle(a)} -> ${a.slug||'(empty)'}`);
    if (seen.has(a.slug)) throw new Error(`Duplicate slug: ${a.slug}`);
    seen.add(a.slug);
  }
  published.sort((a,b)=>String(b.publishedAt||b.updatedAt||'').localeCompare(String(a.publishedAt||a.updatedAt||'')));

  await fs.rm(out,{recursive:true,force:true}); await fs.mkdir(out,{recursive:true});
  for (const name of ['style.css','public.js','admin.html','admin.js','config.js','store.js','favicon.svg']) await fs.copyFile(path.join(source,name),path.join(out,name));

  const topics = Array.isArray(data.topics)&&data.topics.length ? data.topics : [...new Set(published.map(a=>a.topic).filter(Boolean))];
  const eras = Array.isArray(data.eras)&&data.eras.length ? data.eras : [...new Set(published.map(a=>a.era).filter(Boolean))];
  const homeTemplate = await readText('index.template.html');
  const homeTitle = 'THE MEN’S ARCHIVE | 服を読む。時代を知る。';
  const homeDescription = '王室からストリートまで。服飾史、音楽、文化、デザインを横断するメンズファッション・アーカイブ。';
  const homeGraph = {'@context':'https://schema.org','@graph':[
    {'@type':'Organization','@id':SITE_URL+'/#organization',name:'THE MEN’S ARCHIVE',url:SITE_URL+'/'},
    {'@type':'WebSite','@id':SITE_URL+'/#website',url:SITE_URL+'/',name:'THE MEN’S ARCHIVE',inLanguage:'ja',publisher:{'@id':SITE_URL+'/#organization'}},
    {'@type':'CollectionPage','@id':SITE_URL+'/#webpage',url:SITE_URL+'/',name:homeTitle,description:homeDescription,isPartOf:{'@id':SITE_URL+'/#website'},inLanguage:'ja'},
    {'@type':'ItemList',itemListElement:published.slice(0,12).map((a,i)=>({'@type':'ListItem',position:i+1,url:`${SITE_URL}/articles/${a.slug}/`,name:articleTitle(a)}))}
  ]};
  const topicCards = topics.map((t,i)=>{const n=published.filter(a=>a.topic===t).length;return `<button class="topic-card" data-topic-jump="${attr(t)}"><span class="topic-no">${String(i+1).padStart(2,'0')}</span><strong>${esc(t)}</strong><span>${n} ARTICLES</span></button>`;}).join('');
  const nav = topics.slice(0,7).map(t=>`<a href="/topics/${slugify(t)}/">${esc(t)}<span>${published.filter(a=>a.topic===t).length} articles</span></a>`).join('');
  const home = replaceAll(homeTemplate,{
    HOME_TITLE:esc(homeTitle),HOME_DESCRIPTION:attr(homeDescription),HOME_CANONICAL:SITE_URL+'/',HOME_JSONLD:jsonScript(homeGraph),CATEGORY_NAV:nav,
    HERO_TITLE:esc(data.hero?.title||'服を読む。時代を知る。').replace(/\n/g,'<br>'),HERO_TEXT:esc(data.hero?.text||'王室からストリートまで。メンズファッションを通じて、歴史・文化・音楽・デザインのつながりを読み解く。'),
    TOPIC_CARDS:topicCards,ARTICLE_COUNT:published.length,TOPIC_OPTIONS:'<option value="">ALL TOPICS</option>'+topics.map(t=>`<option value="${attr(t)}">${esc(t)}</option>`).join(''),ERA_OPTIONS:'<option value="">ALL ERAS</option>'+eras.map(e=>`<option value="${attr(e)}">${esc(e)}</option>`).join(''),ARTICLE_CARDS:published.slice(0,12).map(card).join('')||'<p class="empty">公開記事はまだありません。</p>'
  });
  await write('index.html',home);

  const articleTemplate = await readText('article.template.html');
  for (const a of published) {
    const canonical = `${SITE_URL}/articles/${a.slug}/`;
    const image = abs(a.image||a.imagePath||'');
    const publishedAt = iso(a.publishedAt||a.createdAt||a.updatedAt) || new Date().toISOString();
    const updatedAt = iso(a.updatedAt||a.publishedAt||a.createdAt) || publishedAt;
    const titleFull = `${articleTitle(a)} | THE MEN’S ARCHIVE`;
    const description = desc(a);
    const author = a.author ? {'@type':'Person',name:a.author,...(a.authorUrl?{url:a.authorUrl}:{})} : {'@type':'Organization','@id':SITE_URL+'/#organization',name:'THE MEN’S ARCHIVE'};
    const blog = {'@type':'BlogPosting','@id':canonical+'#article',headline:articleTitle(a),description,url:canonical,mainEntityOfPage:{'@id':canonical+'#webpage'},datePublished:publishedAt,dateModified:updatedAt,author,publisher:{'@id':SITE_URL+'/#organization'},inLanguage:'ja',articleSection:a.topic||undefined,keywords:Array.isArray(a.tags)?a.tags.join(', '):undefined,image:image?[image]:undefined};
    const crumbs = {'@type':'BreadcrumbList',itemListElement:[
      {'@type':'ListItem',position:1,name:'HOME',item:SITE_URL+'/'},
      {'@type':'ListItem',position:2,name:'ARCHIVE',item:SITE_URL+'/archive/'},
      ...(a.topic?[{'@type':'ListItem',position:3,name:a.topic,item:`${SITE_URL}/topics/${slugify(a.topic)}/`}]:[]),
      {'@type':'ListItem',position:a.topic?4:3,name:articleTitle(a),item:canonical}
    ]};
    const graph={'@context':'https://schema.org','@graph':[
      {'@type':'Organization','@id':SITE_URL+'/#organization',name:'THE MEN’S ARCHIVE',url:SITE_URL+'/'},
      {'@type':'WebSite','@id':SITE_URL+'/#website',url:SITE_URL+'/',name:'THE MEN’S ARCHIVE',inLanguage:'ja',publisher:{'@id':SITE_URL+'/#organization'}},
      {'@type':'WebPage','@id':canonical+'#webpage',url:canonical,name:titleFull,description,isPartOf:{'@id':SITE_URL+'/#website'},breadcrumb:{'@id':canonical+'#breadcrumb'},inLanguage:'ja',datePublished:publishedAt,dateModified:updatedAt,mainEntity:{'@id':canonical+'#article'}},
      {...blog}, {...crumbs,'@id':canonical+'#breadcrumb'}
    ]};
    const html=replaceAll(articleTemplate,{
      TITLE:esc(titleFull),DESCRIPTION:attr(description),CANONICAL:attr(canonical),OG_TITLE:attr(articleTitle(a)),OG_IMAGE:image?`<meta property="og:image" content="${attr(image)}"><meta property="og:image:alt" content="${attr(a.imageAlt||articleTitle(a))}">`:'',PUBLISHED_AT:attr(publishedAt),UPDATED_AT:attr(updatedAt),TWITTER_CARD:image?'summary_large_image':'summary',TWITTER_IMAGE:image?`<meta name="twitter:image" content="${attr(image)}">`:'',JSONLD:jsonScript(graph),TITLE_SHORT:esc(articleTitle(a)),BREAD_TOPIC:a.topic?`<span>›</span><a href="/topics/${slugify(a.topic)}/">${esc(a.topic)}</a>`:'',ARTICLE_META:esc([a.topic,a.era,a.region].filter(Boolean).join(' / ')),SUBTITLE:a.subtitle?`<p class="article-subtitle">${esc(a.subtitle)}</p>`:'',HERO_IMAGE:image?`<figure class="article-figure"><img src="${attr(image)}" alt="${attr(a.imageAlt||articleTitle(a))}" fetchpriority="high">${a.imageAlt?`<figcaption>${esc(a.imageAlt)}</figcaption>`:''}</figure>`:'',ARTICLE_BODY:renderTextBody(articleBody(a)),REFERENCES:a.references?`<section class="article-references"><h2>参考文献・出典</h2><pre>${esc(a.references)}</pre></section>`:'',PUBLISHED_LABEL:esc(dateLabel(publishedAt)),UPDATED_LABEL:esc(dateLabel(updatedAt))
    });
    await write(path.join('articles',a.slug,'index.html'),html);
  }

  await buildCollection({rel:'archive',title:'全記事 | THE MEN’S ARCHIVE',heading:'記事を探す。',description:'THE MEN’S ARCHIVEの公開記事一覧。メンズファッションの歴史・文化・音楽・技術を横断して探せます。',intro:'公開中の記事を新しい順に掲載しています。',eyebrow:'ALL STORIES',items:published,breadcrumb:'<span aria-current="page">ARCHIVE</span>'});
  for (const t of topics) {
    const items=published.filter(a=>a.topic===t); const rel=`topics/${slugify(t)}`;
    await buildCollection({rel,title:`${t} | THE MEN’S ARCHIVE`,heading:t,description:`THE MEN’S ARCHIVEの「${t}」関連記事一覧。`,intro:`${t}に関する公開記事をまとめています。`,eyebrow:'TOPIC',items,breadcrumb:`<a href="/archive/">ARCHIVE</a><span>›</span><span aria-current="page">${esc(t)}</span>`});
  }
  for (const e of eras) {
    const items=published.filter(a=>a.era===e); const rel=`eras/${slugify(e)}`;
    await buildCollection({rel,title:`${e} | THE MEN’S ARCHIVE`,heading:e,description:`THE MEN’S ARCHIVEの${e}関連記事一覧。`,intro:`${e}のメンズファッションと文化に関する公開記事をまとめています。`,eyebrow:'ERA',items,breadcrumb:`<a href="/archive/">ARCHIVE</a><span>›</span><span aria-current="page">${esc(e)}</span>`});
  }

  const urls=[
    {loc:SITE_URL+'/',lastmod:''},{loc:SITE_URL+'/archive/',lastmod:''},
    ...topics.map(t=>({loc:`${SITE_URL}/topics/${slugify(t)}/`,lastmod:''})),
    ...eras.map(e=>({loc:`${SITE_URL}/eras/${slugify(e)}/`,lastmod:''})),
    ...published.map(a=>({loc:`${SITE_URL}/articles/${a.slug}/`,lastmod:iso(a.updatedAt||a.publishedAt)}))
  ];
  const sitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u=>`  <url><loc>${esc(u.loc)}</loc>${u.lastmod?`<lastmod>${esc(u.lastmod)}</lastmod>`:''}</url>`).join('\n')}\n</urlset>\n`;
  await write('sitemap.xml',sitemap);

  const robots=`User-agent: *\nAllow: /\nDisallow: /admin.html\n\nUser-agent: OAI-SearchBot\nAllow: /\nDisallow: /admin.html\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  await write('robots.txt',robots);

  const rss=`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>THE MEN’S ARCHIVE</title><link>${SITE_URL}/</link><description>${esc(homeDescription)}</description><language>ja</language>${published.slice(0,50).map(a=>`<item><title>${esc(articleTitle(a))}</title><link>${SITE_URL}/articles/${a.slug}/</link><guid>${SITE_URL}/articles/${a.slug}/</guid><pubDate>${new Date(a.publishedAt||a.updatedAt).toUTCString()}</pubDate><description>${esc(desc(a))}</description></item>`).join('')}</channel></rss>`;
  await write('rss.xml',rss);
  const feed={version:'https://jsonfeed.org/version/1.1',title:'THE MEN’S ARCHIVE',home_page_url:SITE_URL+'/',feed_url:SITE_URL+'/feed.json',language:'ja',items:published.slice(0,100).map(a=>({id:`${SITE_URL}/articles/${a.slug}/`,url:`${SITE_URL}/articles/${a.slug}/`,title:articleTitle(a),summary:desc(a),date_published:iso(a.publishedAt||a.updatedAt),date_modified:iso(a.updatedAt||a.publishedAt),tags:Array.isArray(a.tags)?a.tags:[]}))};
  await write('feed.json',JSON.stringify(feed,null,2));
  const llms=`# THE MEN’S ARCHIVE\n\nIndependent Japanese editorial archive about men's fashion, history, music, culture, design, craft and vintage.\n\n## Primary resources\n- Home: ${SITE_URL}/\n- Archive: ${SITE_URL}/archive/\n- Sitemap: ${SITE_URL}/sitemap.xml\n- RSS: ${SITE_URL}/rss.xml\n- JSON Feed: ${SITE_URL}/feed.json\n\n## Published articles\n${published.map(a=>`- [${articleTitle(a)}](${SITE_URL}/articles/${a.slug}/): ${desc(a)}`).join('\n')}\n`;
  await write('llms.txt',llms);
  await write('404.html','<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>404 | THE MEN’S ARCHIVE</title><style>body{font-family:system-ui;padding:10vw;background:#f4f2ec;color:#151515}a{color:inherit}</style><h1>404</h1><p>ページが見つかりません。</p><p><a href="/">THE MEN’S ARCHIVEへ戻る</a></p>');
  await write('_headers',`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data: https://*.supabase.co; connect-src 'self' https://*.supabase.co; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'\n\n/admin.html\n  X-Robots-Tag: noindex, nofollow, noarchive\n`);
  console.log(`Built ${published.length} published articles into ${out}`);
}

main().catch(err=>{console.error(err);process.exit(1);});
