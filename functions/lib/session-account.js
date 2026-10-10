export async function sessionAccount(env, request) {
  try {
    const cookie = (request.headers.get('cookie') || '').match(/(?:^|;\s*)sry_session=([^;]+)/);
    if (!cookie) return null;
    const [body, signature] = cookie[1].split('.');
    if (!body || !signature) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET),
      {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
    const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const expected = [...new Uint8Array(signed)].map(b=>b.toString(16).padStart(2,'0')).join('');
    if (expected !== signature) return null;
    const text = Uint8Array.from(atob(body.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
    const session = JSON.parse(new TextDecoder().decode(text));
    if (!session.aid || !session.exp || Date.now() > session.exp) return null;
    return await env.DB.prepare('SELECT id,email,role,status FROM accounts WHERE id=?').bind(session.aid).first();
  } catch { return null; }
}
