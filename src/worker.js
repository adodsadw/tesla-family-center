const encoder = new TextEncoder();
const TZ = 'Asia/Taipei';

export class RealtimeHub {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/connect') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const body = await request.text();
      for (const ws of this.state.getWebSockets()) {
        try { ws.send(body); } catch {}
      }
      return new Response('OK');
    }
    return new Response('Not found', { status: 404 });
  }
  webSocketMessage(ws, message) {
    if (message === 'ping') ws.send('pong');
  }
  webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/webhook' && request.method === 'POST') {
      const response = await handleLineWebhook(request, env);
      return response;
    }
    if (url.pathname === '/webhook' && request.method === 'GET') {
      return json({ ok: true, service: 'LINE × Tesla Family Center', webhook: 'online' });
    }
    if (url.pathname === '/ws') {
      const key = url.searchParams.get('key') || '';
      if (!env.DASHBOARD_KEY || key !== env.DASHBOARD_KEY) return new Response('Unauthorized', { status: 401 });
      const id = env.REALTIME.idFromName('family');
      return env.REALTIME.get(id).fetch(new Request('https://realtime/connect', { headers: request.headers }));
    }
    if (url.pathname === '/api/tasks' && request.method === 'GET') {
      if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
      return listTasks(env);
    }
    if (url.pathname === '/api/members' && request.method === 'GET') {
      if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
      return listMembers(env);
    }
    if (url.pathname.match(/^\/api\/tasks\/\d+\/complete$/) && request.method === 'POST') {
      if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
      const id = Number(url.pathname.split('/')[3]);
      const task = await getTask(env, id);
      if (!task) return json({ error: 'not_found' }, 404);
      await completeTask(env, task, 'Tesla 停車操作');
      await broadcast(env, { type: 'refresh', reason: 'completed', id });
      return json({ ok: true });
    }
    if (url.pathname === '/api/health') {
      return json({ ok: true, version: '2.0.0', time: Date.now(), realtime: !!env.REALTIME, db: !!env.DB });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDueReminders(env));
  }
};

function authorized(request, env) {
  const auth = request.headers.get('authorization') || '';
  return env.DASHBOARD_KEY && auth === `Bearer ${env.DASHBOARD_KEY}`;
}

async function handleLineWebhook(request, env) {
  const body = await request.text();
  const signature = request.headers.get('x-line-signature') || '';
  const valid = await verifyLineSignature(body, signature, env.LINE_CHANNEL_SECRET || '');
  if (!valid) return new Response('Invalid signature', { status: 401 });

  let payload;
  try { payload = JSON.parse(body); }
  catch { return new Response('Bad JSON', { status: 400 }); }

  for (const event of payload.events || []) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    await handleTextEvent(event, env).catch(err => console.error('handleTextEvent', err));
  }
  return new Response('OK');
}

async function handleTextEvent(event, env) {
  const text = (event.message?.text || '').trim();
  const senderName = await resolveSenderName(event, env).catch(() => '家人');
  const sourceId = event.source?.groupId || event.source?.roomId || event.source?.userId || '';
  const uid = event.source?.userId || '';

  const aliasMatch = text.match(/^我是\s+(.{1,20})$/u);
  if (aliasMatch && uid) {
    const alias = aliasMatch[1].trim();
    await env.DB.prepare(`INSERT INTO members (user_id, display_name, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, updated_at=excluded.updated_at`)
      .bind(uid, alias, Date.now()).run();
    await replyText(event.replyToken, `👤 已記住你的家庭名稱：${alias}`, env);
    await broadcast(env, { type: 'refresh', reason: 'member' });
    return;
  }

  const effectiveName = uid ? await memberName(env, uid, senderName) : senderName;

  const completeMatch = text.match(/^完成\s+(.+)$/u);
  if (completeMatch) {
    const query = completeMatch[1].trim();
    const task = /^\d+$/.test(query)
      ? await getTask(env, Number(query))
      : await env.DB.prepare(`SELECT * FROM tasks WHERE status='open' AND message LIKE ? ORDER BY created_at DESC LIMIT 1`).bind(`%${query}%`).first();
    if (!task) {
      await replyText(event.replyToken, `找不到尚未完成的提醒：${query}`, env);
      return;
    }
    await env.DB.prepare(`UPDATE tasks SET status='done', completed_at=?, completed_by=? WHERE id=?`).bind(Date.now(), effectiveName, task.id).run();
    await sendCompletionReport(env, task, effectiveName);
    await replyFlex(event.replyToken, completedFlex(task, effectiveName), env);
    await broadcast(env, { type: 'refresh', reason: 'completed', id: task.id });
    return;
  }

  const parsed = parseCommand(text);
  if (!parsed) return;

  const now = Date.now();
  const dueAt = parseTaiwanDue(parsed.message, now);
  const cleanMessage = stripDatePrefix(parsed.message);
  const result = await env.DB.prepare(`
    INSERT INTO tasks (source_type, source_id, sender_user_id, sender_name, message, priority, status, created_at, due_at, category, notified_at, completed_by)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL, NULL)
  `).bind(
    event.source?.type || 'line', sourceId, uid, effectiveName, cleanMessage,
    parsed.priority, now, dueAt, parsed.category
  ).run();

  const id = Number(result.meta?.last_row_id || 0);
  const task = { id, sender_name: effectiveName, message: cleanMessage, priority: parsed.priority, created_at: now, due_at: dueAt, category: parsed.category };
  await replyFlex(event.replyToken, createdFlex(task), env);
  await broadcast(env, { type: 'refresh', reason: 'created', id });
}

function parseCommand(text = '') {
  const t = text.trim();
  const patterns = [
    { re: /^車車！\s*(.+)$/su, priority: 1, category: 'general' },
    { re: /^車車!\s*(.+)$/su, priority: 1, category: 'general' },
    { re: /^重要\s+(.+)$/su, priority: 1, category: 'general' },
    { re: /^接送\s+(.+)$/su, priority: 1, category: 'pickup' },
    { re: /^到家前\s+(.+)$/su, priority: 0, category: 'before_home' },
    { re: /^提醒\s+(.+)$/su, priority: 0, category: 'general' },
    { re: /^車車\s+(.+)$/su, priority: 0, category: 'general' }
  ];
  for (const p of patterns) {
    const m = t.match(p.re);
    if (m?.[1]?.trim()) return { message: m[1].trim().slice(0, 300), priority: p.priority, category: p.category };
  }
  return null;
}

function taipeiParts(ts) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(new Date(ts));
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

function taipeiEpoch(y, m, d, hh, mm) {
  return Date.UTC(Number(y), Number(m)-1, Number(d), Number(hh)-8, Number(mm), 0, 0);
}

function parseTaiwanDue(message, now) {
  const p = taipeiParts(now);
  let y = Number(p.year), m = Number(p.month), d = Number(p.day);
  const time = message.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/u);
  if (!time) return null;
  if (/明天/u.test(message)) {
    const base = new Date(taipeiEpoch(y,m,d,12,0) + 86400000);
    const np = taipeiParts(base.getTime()); y=+np.year; m=+np.month; d=+np.day;
  } else {
    const date = message.match(/(?:(\d{1,2})[\/月](\d{1,2})日?)/u);
    if (date) { m = +date[1]; d = +date[2]; }
  }
  let epoch = taipeiEpoch(y,m,d,+time[1],+time[2]);
  if (!/明天/u.test(message) && !/(\d{1,2})[\/月](\d{1,2})日?/u.test(message) && epoch < now - 60000) epoch += 86400000;
  return epoch;
}

function stripDatePrefix(message) {
  return message
    .replace(/^明天\s*/u, '')
    .replace(/^\d{1,2}[\/月]\d{1,2}日?\s*/u, '')
    .trim();
}

async function memberName(env, uid, fallback) {
  const row = await env.DB.prepare('SELECT display_name FROM members WHERE user_id=?').bind(uid).first();
  return row?.display_name || fallback || '家人';
}

async function getTask(env, id) {
  return env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first();
}

async function completeTask(env, task, completedBy) {
  if (task.status !== 'open') return;
  await env.DB.prepare(`UPDATE tasks SET status='done', completed_at=?, completed_by=? WHERE id=?`).bind(Date.now(), completedBy, task.id).run();
  await sendCompletionReport(env, task, completedBy);
}

async function sendCompletionReport(env, task, completedBy) {
  if (!task.source_id) return;
  const done = { ...task, status: 'done', completed_by: completedBy };
  await pushFlex(task.source_id, completedFlex(done, completedBy), env);
}

async function sendDueReminders(env) {
  const now = Date.now();
  const result = await env.DB.prepare(`
    SELECT * FROM tasks
    WHERE status='open' AND due_at IS NOT NULL AND due_at <= ? AND notified_at IS NULL
    ORDER BY due_at ASC LIMIT 50
  `).bind(now).all();
  for (const task of result.results || []) {
    if (task.source_id) await pushFlex(task.source_id, dueFlex(task), env).catch(console.error);
    await env.DB.prepare('UPDATE tasks SET notified_at=? WHERE id=?').bind(now, task.id).run();
  }
  if ((result.results || []).length) await broadcast(env, { type: 'refresh', reason: 'due' });
}

async function listTasks(env) {
  const result = await env.DB.prepare(`
    SELECT id, sender_name, message, priority, status, created_at, due_at, category, notified_at, completed_by
    FROM tasks WHERE status='open'
    ORDER BY CASE category WHEN 'pickup' THEN 0 WHEN 'before_home' THEN 1 ELSE 2 END, priority DESC, COALESCE(due_at, 9223372036854775807), created_at DESC
    LIMIT 50
  `).all();
  return json({ tasks: result.results || [], serverTime: Date.now() });
}

async function listMembers(env) {
  const result = await env.DB.prepare('SELECT user_id, display_name, updated_at FROM members ORDER BY updated_at DESC').all();
  return json({ members: result.results || [] });
}

async function broadcast(env, payload) {
  if (!env.REALTIME) return;
  const id = env.REALTIME.idFromName('family');
  await env.REALTIME.get(id).fetch('https://realtime/broadcast', { method:'POST', body:JSON.stringify(payload) });
}

async function verifyLineSignature(body, signature, secret) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return timingSafeEqual(bytesToBase64(new Uint8Array(mac)), signature);
}

function timingSafeEqual(a,b) {
  if (a.length !== b.length) return false;
  let out=0; for (let i=0;i<a.length;i++) out |= a.charCodeAt(i)^b.charCodeAt(i); return out===0;
}
function bytesToBase64(bytes) { let s=''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }

async function resolveSenderName(event, env) {
  const uid = event.source?.userId;
  if (!uid || !env.LINE_CHANNEL_ACCESS_TOKEN) return '家人';
  let endpoint;
  if (event.source?.type === 'group' && event.source.groupId) endpoint = `https://api.line.me/v2/bot/group/${encodeURIComponent(event.source.groupId)}/member/${encodeURIComponent(uid)}`;
  else if (event.source?.type === 'room' && event.source.roomId) endpoint = `https://api.line.me/v2/bot/room/${encodeURIComponent(event.source.roomId)}/member/${encodeURIComponent(uid)}`;
  else endpoint = `https://api.line.me/v2/bot/profile/${encodeURIComponent(uid)}`;
  const r = await fetch(endpoint, { headers:{ Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } });
  if (!r.ok) return '家人';
  const data = await r.json();
  return (data.displayName || '家人').slice(0,40);
}

function fmtDue(ts) {
  if (!ts) return '無指定時間';
  return new Intl.DateTimeFormat('zh-TW', { timeZone:TZ, month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(ts));
}

function createdFlex(task) {
  const category = task.category === 'pickup' ? '🚸 接送行程' : task.category === 'before_home' ? '🏠 到家前' : task.priority ? '❗重要提醒' : '🚗 家庭提醒';
  return flex(`已送到家庭車機`, category, task.message, `#${task.id}${task.due_at ? ` · ${fmtDue(task.due_at)}` : ''}`, false);
}
function completedFlex(task, by) { return flex('✅ 已完成', '家庭車機', task.message, `#${task.id} · ${by}`, true); }
function dueFlex(task) { return flex('⏰ 時間到了', task.category === 'pickup' ? '🚸 今日接送' : '家庭提醒', task.message, `#${task.id} · ${fmtDue(task.due_at)}`, false); }
function flex(title, label, message, footer, done) {
  return {
    type:'flex', altText:`${title}｜${message}`.slice(0,400),
    contents:{ type:'bubble', size:'kilo', body:{ type:'box', layout:'vertical', spacing:'md', contents:[
      { type:'text', text:title, weight:'bold', size:'lg', color:done ? '#7A7A7A' : '#111111' },
      { type:'text', text:label, size:'sm', color:'#7A7A7A' },
      { type:'text', text:message, wrap:true, weight:'bold', size:'xl', color:done ? '#999999' : '#111111' },
      { type:'separator', margin:'md' },
      { type:'text', text:footer, size:'xs', color:'#999999', margin:'md' }
    ]}}
  };
}

async function replyText(replyToken, text, env) {
  if (!replyToken || !env.LINE_CHANNEL_ACCESS_TOKEN) return;
  await linePost('/v2/bot/message/reply', { replyToken, messages:[{type:'text', text}] }, env);
}
async function replyFlex(replyToken, message, env) {
  if (!replyToken || !env.LINE_CHANNEL_ACCESS_TOKEN) return;
  await linePost('/v2/bot/message/reply', { replyToken, messages:[message] }, env);
}
async function pushFlex(to, message, env) {
  if (!to || !env.LINE_CHANNEL_ACCESS_TOKEN) return;
  await linePost('/v2/bot/message/push', { to, messages:[message] }, env);
}
async function linePost(path, body, env) {
  const r = await fetch(`https://api.line.me${path}`, { method:'POST', headers:{ 'content-type':'application/json', Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` }, body:JSON.stringify(body) });
  if (!r.ok) console.error('LINE API', r.status, await r.text());
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' } });
}
