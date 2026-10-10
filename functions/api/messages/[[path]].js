import {sessionAccount} from '../../lib/session-account.js';
import {PARTNER_MONTHLY_QUOTA, usedThisMonth} from '../../lib/contact-quota.js';

const json = (data,status=200) => new Response(JSON.stringify(data), {
  status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}
});
const bad = (error,status=400,extra={}) => json({ok:false,error,...extra},status);
const positiveId = value => {const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:0;};

async function target(env,gameId) {
  return env.DB.prepare(`SELECT g.id,g.claimed_by,g.t_en,g.t_zh,g.t_ko
    FROM games g JOIN accounts a ON a.id=g.claimed_by
    WHERE g.id=? AND g.status='approved' AND g.visible=1 AND a.role='developer' AND a.status!='suspended'`)
    .bind(gameId).first();
}
async function sender(env,account) {
  if (account.role!=='partner') return null;
  if (account.status!=='verified') return null;
  const profile=await env.DB.prepare('SELECT name_en,name_zh,name_ko,kinds,contact_email FROM partner_profiles WHERE account_id=?').bind(account.id).first();
  let kinds=[];try{kinds=JSON.parse(profile?.kinds||'[]');}catch{}
  if (!Array.isArray(kinds)||!kinds.some(k=>['publishing','investment'].includes(k))) return null;
  return profile;
}
async function eligible(env,account,gameId) {
  const profile=await sender(env,account);
  if (!profile) return {error:'verified_partner_only',status:403};
  const used=await usedThisMonth(env,account.id),quota=PARTNER_MONTHLY_QUOTA;
  const game=await target(env,gameId);
  const reason=!game?'developer_unavailable':used<quota?'quota_not_exhausted':null;
  return {game,profile,used,quota,can_send:!reason,reason};
}
async function handleSend(env,account,request) {
  const b=await request.json().catch(()=>null);
  const gameId=positiveId(b?.game_id),subject=typeof b?.subject==='string'?b.subject.trim():'',body=typeof b?.body==='string'?b.body.trim():'';
  const key=typeof b?.request_key==='string'?b.request_key.toLowerCase():'';
  if (!gameId) return bad('invalid_game');
  if (!subject||subject.length>120||!body||body.length>2000) return bad('invalid_message');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key)) return bad('invalid_request_key');
  const permission=await eligible(env,account,gameId);
  if (permission.error) return bad(permission.error,permission.status);
  if (!permission.can_send) return bad(permission.reason,403,{used:permission.used,quota:permission.quota});
  const prior=await env.DB.prepare('SELECT id,game_id,subject,body,expires_at FROM developer_messages WHERE sender_id=? AND request_key=?').bind(account.id,key).first();
  if (prior) {
    if(prior.game_id!==gameId||prior.subject!==subject||prior.body!==body)return bad('request_key_conflict',409);
    return json({ok:true,id:prior.id,expires_at:prior.expires_at,already:true});
  }
  const {game,profile}=permission;
  const inserted=await env.DB.prepare(`INSERT INTO developer_messages
    (sender_id,recipient_id,game_id,game_title,game_title_zh,game_title_ko,sender_name,sender_name_zh,sender_name_ko,sender_email,subject,body,request_key)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE
      (SELECT COUNT(*) FROM developer_messages WHERE sender_id=? AND created_at>datetime('now','-24 hours'))<20
      AND NOT EXISTS(SELECT 1 FROM developer_messages WHERE sender_id=? AND recipient_id=? AND created_at>datetime('now','-24 hours'))
    ON CONFLICT(sender_id,request_key) DO NOTHING`).bind(account.id,game.claimed_by,game.id,
      game.t_en||game.t_zh||game.t_ko||'',game.t_zh||'',game.t_ko||'',
      profile.name_en||profile.name_zh||profile.name_ko||account.email,profile.name_zh||'',profile.name_ko||'',
      profile.contact_email||account.email,subject,body,key,account.id,account.id,game.claimed_by).run();
  const row=await env.DB.prepare('SELECT id,game_id,subject,body,expires_at FROM developer_messages WHERE sender_id=? AND request_key=?').bind(account.id,key).first();
  if (!row) return bad('message_rate_limit',429);
  if(row.game_id!==gameId||row.subject!==subject||row.body!==body)return bad('request_key_conflict',409);
  return json({ok:true,id:row.id,expires_at:row.expires_at,already:!inserted.meta.changes});
}

export async function onRequest({env,request,params}) {
  try {
    if(!env.DB||!env.SESSION_SECRET)return bad('env_missing',500);
    const account=await sessionAccount(env,request);
    if(!account)return bad('not_logged_in',401);
    if(account.status==='suspended')return bad('account_suspended',403);
    const path=(params.path||[]).join('/'),url=new URL(request.url);
    if(request.method==='POST'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return bad('invalid_origin',403);
    // Expired content is never returned; storage cleanup runs on messaging requests.
    await env.DB.prepare("DELETE FROM developer_messages WHERE expires_at<=datetime('now')").run();
    if(request.method==='GET'&&path==='eligible') {
      const gameId=positiveId(url.searchParams.get('game_id'));if(!gameId)return bad('invalid_game');
      const result=await eligible(env,account,gameId);
      if(result.error)return bad(result.error,result.status);
      return json({ok:true,can_send:result.can_send,reason:result.reason,used:result.used,quota:result.quota,retention_days:30,
        sender_email:result.profile.contact_email||account.email});
    }
    if(request.method==='POST'&&path==='send')return await handleSend(env,account,request);
    if(account.role!=='developer')return bad('developer_only',403);
    if(request.method==='GET'&&path==='mine') {
      const raw=url.searchParams.get('before'),before=raw===null?Number.MAX_SAFE_INTEGER:positiveId(raw);
      if(!before)return bad('invalid_cursor');
      const [list,count]=await env.DB.batch([
        env.DB.prepare(`SELECT id,game_id,game_title,game_title_zh,game_title_ko,sender_name,sender_name_zh,sender_name_ko,subject,
          substr(body,1,160) AS preview,created_at,expires_at,read_at FROM developer_messages
          WHERE recipient_id=? AND expires_at>datetime('now') AND id<? ORDER BY id DESC LIMIT 51`).bind(account.id,before),
        env.DB.prepare("SELECT COUNT(*) AS c FROM developer_messages WHERE recipient_id=? AND read_at IS NULL AND expires_at>datetime('now')").bind(account.id)
      ]);
      const rows=list.results||[],more=rows.length>50;return json({ok:true,rows:rows.slice(0,50),unread:count.results?.[0]?.c||0,next_cursor:more?rows[49].id:null,retention_days:30});
    }
    if(request.method==='POST'&&path==='read') {
      const b=await request.json().catch(()=>({})),id=positiveId(b.id);if(!id)return bad('invalid_id');
      const [update,detail]=await env.DB.batch([
        env.DB.prepare("UPDATE developer_messages SET read_at=COALESCE(read_at,datetime('now')) WHERE id=? AND recipient_id=? AND expires_at>datetime('now')").bind(id,account.id),
        env.DB.prepare("SELECT id,game_id,game_title,game_title_zh,game_title_ko,sender_name,sender_name_zh,sender_name_ko,sender_email,subject,body,created_at,expires_at,read_at FROM developer_messages WHERE id=? AND recipient_id=? AND expires_at>datetime('now')").bind(id,account.id)
      ]);
      const row=detail.results?.[0];if(!row)return bad('message_not_found',404);
      return json({ok:true,row});
    }
    return bad('not_found',404);
  } catch {return bad('server_error',500);}
}
