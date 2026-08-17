const $ = s => document.querySelector(s);
const isLocalPreview = location.protocol === 'file:';
let key = localStorage.getItem('family_dashboard_key') || '';
let socket = null;
let reconnectTimer = null;

const incoming = new URL(location.href).searchParams.get('key');
if (incoming) {
  key = incoming;
  localStorage.setItem('family_dashboard_key', incoming);
  history.replaceState({}, '', location.pathname);
}

function tick() {
  $('#clock').textContent = new Intl.DateTimeFormat('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date());
}
tick(); setInterval(tick, 1000);

function esc(s='') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function dueText(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('zh-TW', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(ts));
}
function age(ts) {
  const sec = Math.max(0, Math.floor((Date.now()-ts)/1000));
  if (sec < 60) return '剛剛';
  if (sec < 3600) return `${Math.floor(sec/60)} 分鐘前`;
  if (sec < 86400) return `${Math.floor(sec/3600)} 小時前`;
  return new Intl.DateTimeFormat('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(ts));
}
function card(t) {
  const badge = t.category === 'pickup' ? '🚸 接送' : t.category === 'before_home' ? '🏠 到家前' : t.priority ? '❗重要' : '家庭提醒';
  return `<article class="card ${t.priority ? 'important' : ''}">
    <div class="meta"><span><span class="badge">${badge}</span>${esc(t.sender_name)}</span><span>${t.due_at ? `⏰ ${dueText(t.due_at)}` : age(t.created_at)}</span></div>
    <div class="message">${esc(t.message)}</div>
  </article>`;
}
function renderSection(section, list, count) {
  const el = $(`#${section}Section`);
  const tasks = $(`#${section}Tasks`);
  el.classList.toggle('hidden', list.length === 0);
  tasks.innerHTML = list.map(card).join('');
  $(`#${section}Count`).textContent = list.length ? `${list.length} 件` : '';
}
function render(tasks=[]) {
  $('#hero').classList.toggle('hidden', tasks.length > 0);
  renderSection('pickup', tasks.filter(t => t.category === 'pickup'));
  renderSection('home', tasks.filter(t => t.category === 'before_home'));
  renderSection('general', tasks.filter(t => !['pickup','before_home'].includes(t.category)));
}

async function refresh() {
  if (!key || isLocalPreview) return;
  try {
    const r = await fetch('/api/tasks', { headers:{Authorization:`Bearer ${key}`}, cache:'no-store' });
    if (r.status === 401) { $('#setup').classList.remove('hidden'); return; }
    if (!r.ok) throw new Error('sync');
    const d = await r.json();
    $('#setup').classList.add('hidden');
    render(d.tasks || []);
  } catch { $('#offline').classList.remove('hidden'); }
}

function setConnection(text, online) {
  $('#connection').textContent = text;
  $('#connection').classList.toggle('online', !!online);
  $('#offline').classList.toggle('hidden', !!online);
}
function connect() {
  if (!key || isLocalPreview) return;
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${proto}//${location.host}/ws?key=${encodeURIComponent(key)}`);
  socket.onopen = () => { setConnection('即時連線', true); refresh(); };
  socket.onmessage = e => { if (e.data !== 'pong') refresh(); };
  socket.onerror = () => setConnection('重新連線中', false);
  socket.onclose = () => {
    setConnection('重新連線中', false);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2500);
  };
}

if (isLocalPreview) {
  $('#preview').classList.remove('hidden');
  setConnection('本機預覽', true);
  render([
    {id:1,sender_name:'媽媽',message:'17:30 接妹妹下課',priority:1,category:'pickup',created_at:Date.now()-30000,due_at:Date.now()+3600000},
    {id:2,sender_name:'媽媽',message:'買尿布',priority:0,category:'before_home',created_at:Date.now()-120000},
    {id:3,sender_name:'家人',message:'回家幫我買牛奶 🥛',priority:0,category:'general',created_at:Date.now()-180000}
  ]);
} else {
  if (!key) $('#setup').classList.remove('hidden');
  refresh(); connect();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); connect(); } });
}

if ('serviceWorker' in navigator && !isLocalPreview) navigator.serviceWorker.register('./sw.js').catch(()=>{});
