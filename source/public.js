// Progressive enhancement only. Published article content already exists in static HTML.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function normalize(v='') { return String(v).toLowerCase().normalize('NFKC'); }

function filterCards() {
  const q = normalize($('#search')?.value || '');
  const topic = $('#topicFilter')?.value || '';
  const era = $('#eraFilter')?.value || '';
  let shown = 0;
  $$('.story[data-search]').forEach(card => {
    const okQ = !q || normalize(card.dataset.search).includes(q);
    const okTopic = !topic || card.dataset.topic === topic;
    const okEra = !era || card.dataset.era === era;
    const show = okQ && okTopic && okEra;
    card.hidden = !show;
    if (show) shown++;
  });
  const count = $('#resultCount');
  if (count) count.textContent = `${shown} ARTICLES`;
  const empty = $('#filterEmpty');
  if (empty) empty.hidden = shown !== 0;
}

$('#search')?.addEventListener('input', filterCards);
$('#topicFilter')?.addEventListener('change', filterCards);
$('#eraFilter')?.addEventListener('change', filterCards);
$$('[data-topic-jump]').forEach(btn => btn.addEventListener('click', () => {
  const select = $('#topicFilter');
  if (select) select.value = btn.dataset.topicJump;
  filterCards();
  $('#archive')?.scrollIntoView({behavior:'smooth'});
}));

const year = $('#year');
if (year) year.textContent = new Date().getFullYear();
