const $ = s => document.querySelector(s);
const tasksEl = $('#tasks');
const heroEl = $('#hero');
const setupEl = $('#setup');
const offlineEl = $('#offline');
const previewEl = $('#preview');
const isLocalPreview = location.protocol === 'file:';

let key = localStorage.getItem('family_dashboard_key') || '';
const incoming = new URL(location.href).searchParams.get('key');
if (incoming) {
  key = incoming;
  localStorage.setItem('family_dashboard_key', incoming);
  history.replaceState({}, '', location.pathname);
}

function tick() {
  $('#clock').textContent = new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
}
tick();
setInterval(tick, 1000);

function age(ts) {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return '剛剛';
  if (sec < 3600) return `${Math.floor(sec / 60)} 分鐘前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小時前`;
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(ts));
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function render(tasks = []) {
  heroEl.classList.toggle('hidden', tasks.length > 0);
  tasksEl.innerHTML = tasks.map(t => `
    <article class="card ${t.priority ? 'important' : ''}">
      <div class="meta">
        <span><span class="badge">${t.priority ? '❗重要' : '家庭提醒'}</span>${esc(t.sender_name)}</span>
        <span>${age(t.created_at)}</span>
      </div>
      <div class="message">${esc(t.message)}</div>
    </article>
  `).join('');
}

if (isLocalPreview) {
  previewEl.classList.remove('hidden');
  setupEl.classList.add('hidden');
  offlineEl.classList.add('hidden');
  render([
    { sender_name: '家人', message: '17:30 記得接小孩下課', priority: 1, created_at: Date.now() - 30000 },
    { sender_name: '家人', message: '回家幫我買牛奶 🥛', priority: 0, created_at: Date.now() - 180000 }
  ]);
} else {
  if (!key) setupEl.classList.remove('hidden');

  async function refresh() {
    if (!key) return;
    try {
      const r = await fetch('/api/tasks', {
        headers: { Authorization: `Bearer ${key}` },
        cache: 'no-store'
      });
      if (r.status === 401) {
        setupEl.classList.remove('hidden');
        return;
      }
      if (!r.ok) throw new Error('sync');
      const { tasks = [] } = await r.json();
      offlineEl.classList.add('hidden');
      setupEl.classList.add('hidden');
      render(tasks);
    } catch {
      offlineEl.classList.remove('hidden');
    }
  }

  refresh();
  setInterval(refresh, 4000);
}
