const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleLineWebhook(request, env);
    }

    if (url.pathname === '/api/tasks' && request.method === 'GET') {
      if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
      return listTasks(env);
    }

    if (url.pathname.match(/^\/api\/tasks\/\d+\/complete$/) && request.method === 'POST') {
      if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
      const id = Number(url.pathname.split('/')[3]);
      await env.DB.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?')
        .bind('done', Date.now(), id).run();
      return json({ ok: true });
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, time: Date.now() });
    }

    return env.ASSETS.fetch(request);
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
    const parsed = parseCommand(event.message.text);
    if (!parsed) continue;

    const senderName = await resolveSenderName(event, env).catch(() => '家人');
    const sourceId = event.source?.groupId || event.source?.roomId || event.source?.userId || '';

    await env.DB.prepare(`
      INSERT INTO tasks (source_type, source_id, sender_user_id, sender_name, message, priority, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
    `).bind(
      event.source?.type || 'line',
      sourceId,
      event.source?.userId || '',
      senderName,
      parsed.message,
      parsed.priority,
      Date.now()
    ).run();

    if (event.replyToken) {
      await replyLine(event.replyToken, `🚗 已送到家庭車機\n${parsed.priority ? '❗重要：' : ''}${parsed.message}`, env);
    }
  }

  return new Response('OK');
}

function parseCommand(text = '') {
  const t = text.trim();
  const patterns = [
    { re: /^車車！\s*(.+)$/s, priority: 1 },
    { re: /^車車!\s*(.+)$/s, priority: 1 },
    { re: /^重要\s+(.+)$/s, priority: 1 },
    { re: /^車車\s+(.+)$/s, priority: 0 },
    { re: /^提醒\s+(.+)$/s, priority: 0 },
    { re: /^到家前\s+(.+)$/s, priority: 0 }
  ];
  for (const p of patterns) {
    const m = t.match(p.re);
    if (m?.[1]?.trim()) return { message: m[1].trim().slice(0, 300), priority: p.priority };
  }
  return null;
}

async function verifyLineSignature(body, signature, secret) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = bytesToBase64(new Uint8Array(mac));
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function resolveSenderName(event, env) {
  const uid = event.source?.userId;
  if (!uid || !env.LINE_CHANNEL_ACCESS_TOKEN) return '家人';
  let endpoint;
  if (event.source?.type === 'group' && event.source.groupId) {
    endpoint = `https://api.line.me/v2/bot/group/${encodeURIComponent(event.source.groupId)}/member/${encodeURIComponent(uid)}`;
  } else if (event.source?.type === 'room' && event.source.roomId) {
    endpoint = `https://api.line.me/v2/bot/room/${encodeURIComponent(event.source.roomId)}/member/${encodeURIComponent(uid)}`;
  } else {
    endpoint = `https://api.line.me/v2/bot/profile/${encodeURIComponent(uid)}`;
  }
  const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } });
  if (!r.ok) return '家人';
  const data = await r.json();
  return (data.displayName || '家人').slice(0, 40);
}

async function replyLine(replyToken, text, env) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return;
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
  });
}

async function listTasks(env) {
  const result = await env.DB.prepare(`
    SELECT id, sender_name, message, priority, status, created_at
    FROM tasks
    WHERE status = 'open'
    ORDER BY priority DESC, created_at DESC
    LIMIT 20
  `).all();
  return json({ tasks: result.results || [], serverTime: Date.now() });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
