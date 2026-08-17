const tasksEl = document.querySelector('#tasks');
const previewEl = document.querySelector('#preview');
const membersEl = document.querySelector('#members');
const isLocalPreview = location.protocol === 'file:';
let key = localStorage.getItem('family_dashboard_key') || '';
let socket;

const incoming = new URL(location.href).searchParams.get('key');
if (incoming) {
  key = incoming;
  localStorage.setItem('family_dashboard_key', incoming);
  history.replaceState({}, '', location.pathname);
}

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDue = ts => ts ? new Intl.DateTimeFormat('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ts)) : '';
const cat = t => t.category === 'pickup' ? '🚸 接送' : t.category === 'before_home' ? '🏠 到家前' : t.priority ? '❗重要' : '🔔 提醒';

function render(tasks, preview=false) {
  tasksEl.innerHTML = (tasks || []).map(t => `
    <article class="card ${t.priority ? 'important' : ''}">
      <div>
        <div class="meta"><span>${cat(t)} · ${esc(t.sender_name)}</span><span>${t.due_at ? `⏰ ${fmtDue(t.due_at)}` : `#${t.id}`}</span></div>
        <div class="message">${esc(t.message)}</div>
      </div>
      <button class="complete" data-id="${t.id}" ${preview ? 'disabled' : ''}>✓ 完成</button>
    </article>
  `).join('') || '<div class="empty-manage">✅ 目前沒有未完成事項</div>';
}

async function load() {
  if (isLocalPreview) {
    previewEl.classList.remove('hidden');
    membersEl.innerHTML = '<span>👤 媽媽</span><span>👤 爸爸</span>';
    render([
      {id:1,sender_name:'媽媽',message:'17:30 接妹妹下課',priority:1,category:'pickup',due_at:Date.now()+3600000},
      {id:2,sender_name:'媽媽',message:'買尿布',priority:0,category:'before_home'}
    ], true);
    return;
  }
  if (!key) { tasksEl.innerHTML = '<p>尚未設定 DASHBOARD_KEY，請先回首頁完成第一次設定。</p>'; return; }

  try {
    const [tr, mr] = await Promise.all([
      fetch('/api/tasks',{headers:{Authorization:`Bearer ${key}`},cache:'no-store'}),
      fetch('/api/members',{headers:{Authorization:`Bearer ${key}`},cache:'no-store'})
    ]);
    if (!tr.ok) throw new Error('tasks');
    const td = await tr.json();
    render(td.tasks || []);
    if (mr.ok) {
      const md = await mr.json();
      membersEl.innerHTML = (md.members || []).map(m => `<span>👤 ${esc(m.display_name)}</span>`).join('');
    }
    bindButtons();
  } catch {
    tasksEl.innerHTML = '<p>目前無法連線，請稍後再試。</p>';
  }
}

function bindButtons() {
  document.querySelectorAll('.complete').forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      const r = await fetch(`/api/tasks/${b.dataset.id}/complete`, { method:'POST', headers:{Authorization:`Bearer ${key}`} });
      if (!r.ok) b.disabled = false;
      await load();
    };
  });
}

function connect() {
  if (!key || isLocalPreview) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${proto}//${location.host}/ws?key=${encodeURIComponent(key)}`);
  socket.onmessage = e => { if (e.data !== 'pong') load(); };
  socket.onclose = () => setTimeout(connect, 2500);
}

load(); connect();
if ('serviceWorker' in navigator && !isLocalPreview) navigator.serviceWorker.register('./sw.js').catch(()=>{});
