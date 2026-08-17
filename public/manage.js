const tasksEl = document.querySelector('#tasks');
const previewEl = document.querySelector('#preview');
const isLocalPreview = location.protocol === 'file:';
let key = localStorage.getItem('family_dashboard_key') || '';

const incoming = new URL(location.href).searchParams.get('key');
if (incoming) {
  key = incoming;
  localStorage.setItem('family_dashboard_key', incoming);
  history.replaceState({}, '', location.pathname);
}

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function render(tasks, preview = false) {
  tasksEl.innerHTML = (tasks || []).map(t => `
    <article class="card ${t.priority ? 'important' : ''}">
      <div>
        <div class="meta"><span>${esc(t.sender_name)}</span></div>
        <div class="message">${esc(t.message)}</div>
      </div>
      <button class="complete" data-id="${t.id}" ${preview ? 'disabled' : ''}>完成</button>
    </article>
  `).join('') || '<p>目前沒有待辦。</p>';
}

async function load() {
  if (isLocalPreview) {
    previewEl.classList.remove('hidden');
    render([
      { id: 1, sender_name: '家人', message: '17:30 記得接小孩下課', priority: 1 },
      { id: 2, sender_name: '家人', message: '回家幫我買牛奶 🥛', priority: 0 }
    ], true);
    return;
  }

  if (!key) {
    tasksEl.innerHTML = '<p>尚未設定 DASHBOARD_KEY，請先回首頁完成第一次設定。</p>';
    return;
  }

  try {
    const r = await fetch('/api/tasks', {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store'
    });
    if (!r.ok) {
      tasksEl.innerHTML = '<p>無法讀取提醒。</p>';
      return;
    }
    const d = await r.json();
    render(d.tasks || []);
    document.querySelectorAll('.complete').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        await fetch(`/api/tasks/${b.dataset.id}/complete`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` }
        });
        load();
      };
    });
  } catch {
    tasksEl.innerHTML = '<p>目前無法連線，請稍後再試。</p>';
  }
}

load();
