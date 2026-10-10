import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { completeLanguages } from '../functions/lib/translate.js';
import { steamDescription } from '../functions/lib/steam-description.js';
import { onRequest as submit } from '../functions/api/games-submit/[[path]].js';
import { onRequest as admin } from '../functions/api/admin/[[path]].js';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const description = {};
vm.runInNewContext(await readFile(new URL('../assets/description.js', import.meta.url), 'utf8'), {globalThis:description, URL});
const render = description.SryDescription.render;

test('description renders paragraphs, lists, headings and safe media', () => {
 const html=render('## Features\n\nFirst paragraph.\n\n- One\n- **Two**\n\n1. First\n2. Second\n\n> Quote\n\n![Shot](https://example.com/a.png)');
 assert.match(html, /<h2>Features<\/h2>/);assert.match(html, /<ul><li>One<\/li><li><strong>Two/);
 assert.match(html, /<ol>/);assert.match(html, /<blockquote>Quote/);assert.match(html, /alt="Shot"/);
 assert.equal((html.match(/<p>/g)||[]).length,1);
 assert.doesNotMatch(render('<script>alert(1)</script>\n![x](javascript:alert)\n[bad](javascript:alert)'),/<script|src="javascript:|href="javascript:/);
 assert.match(render('![x](https://example.com/"onerror="x)'),/&quot;/);
});

test('Steam descriptions keep headings and bullet structure',()=>{
 assert.equal(steamDescription('<h2>Features</h2><p>Play &amp; explore</p><ul><li>One</li><li>Two</li></ul>'), '## Features\n\nPlay & explore\n\n- One\n\n- Two');
});

test('translations fill gaps, preserve manual text and recover from provider failures', async()=>{
 const original={t_en:'Brand',t_zh:'品牌',t_ko:'브랜드',d_en:'Pitch',full_en:'## Features\n\n- Original'};
 const realFetch=globalThis.fetch;
 try{
  globalThis.fetch=async(_url,options)=>{
   const request=JSON.parse(options.body);const schema=request.response_format.json_schema.schema;
   assert.equal(request.model,'gpt-4.1-mini');assert.ok(!schema.required.includes('full_en'));
   return Response.json({choices:[{message:{content:JSON.stringify(Object.fromEntries(schema.required.map(key=>[key,key.endsWith('zh')?'译文':'번역'])))}}]});
  };
  const r=await completeLanguages({TRANSLATION_API_KEY:'test-only'},original);
  assert.equal(r.status,'complete');assert.equal(r.content.full_en,original.full_en);assert.equal(r.content.d_zh,'译文');
  globalThis.fetch=async()=>new Response('',{status:429});
  assert.deepEqual(await completeLanguages({TRANSLATION_API_KEY:'test-only'},original),{content:original,status:'failed'});
  assert.equal((await completeLanguages({},original)).status,'unconfigured');
  globalThis.fetch=async()=>Response.json({choices:[{message:{content:'{}'}}]});
  assert.equal((await completeLanguages({TRANSLATION_API_KEY:'test-only'},original)).status,'failed');
 }finally{globalThis.fetch=realFetch;}
});

test('DeepSeek and Kimi use JSON mode, fixed endpoints and preserve original prose', async()=>{
 const original={t_en:'Brand',t_zh:'品牌',t_ko:'브랜드',d_en:'Pitch',full_en:'## Features\n\n- Original'};
 const translated={d_zh:'简介',d_ko:'소개',full_zh:'## 玩法\n\n- 探索',full_ko:'## 게임\n\n- 탐험'};
 const realFetch=globalThis.fetch;
 try {
  for(const [provider,url,model] of [
   ['deepseek','https://api.deepseek.com/chat/completions','deepseek-chat'],
   ['kimi','https://api.moonshot.cn/v1/chat/completions','moonshot-v1-32k']
  ]) {
   globalThis.fetch=async(endpoint,options)=>{
    const body=JSON.parse(options.body);
    assert.equal(endpoint,url);assert.equal(body.model,model);
    assert.deepEqual(body.response_format,{type:'json_object'});
    assert.match(body.messages[0].content,/JSON object/);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(translated)}}]});
   };
   const result=await completeLanguages({TRANSLATION_PROVIDER:provider,TRANSLATION_API_KEY:'test-only'},original);
   assert.equal(result.status,'complete');assert.equal(result.content.full_en,original.full_en);assert.equal(result.content.full_ko,translated.full_ko);
  }
  let called=false;
  globalThis.fetch=async()=>{called=true;return Response.json({choices:[{finish_reason:'length',message:{content:JSON.stringify(translated)}}]});};
  assert.equal((await completeLanguages({TRANSLATION_PROVIDER:'deepseek',TRANSLATION_API_KEY:'test-only'},original)).status,'failed');
  assert.equal(called,true);called=false;
  assert.equal((await completeLanguages({TRANSLATION_PROVIDER:'https://untrusted.example',TRANSLATION_API_KEY:'test-only'},original)).status,'failed');
  assert.equal(called,false);
 } finally {globalThis.fetch=realFetch;}
});

test('submission and deletion work against real local D1, preserving the other game',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'test',modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:{DB:'regression'},compatibilityDate:'2026-10-08'}));
 try{
  const DB=await mf.getD1Database('DB');
  await DB.exec("CREATE TABLE accounts(id INTEGER PRIMARY KEY, email TEXT, role TEXT, status TEXT); CREATE TABLE developer_profiles(account_id INTEGER PRIMARY KEY,studio_name TEXT,logo TEXT,contact_email TEXT,updated_at TEXT); CREATE TABLE games(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,t_en TEXT,t_zh TEXT,t_ko TEXT,d_en TEXT,d_zh TEXT,d_ko TEXT,full_en TEXT,full_zh TEXT,full_ko TEXT,developer TEXT,studio_logo TEXT,stage TEXT,genres TEXT,needs TEXT,platforms TEXT,region TEXT,cover TEXT,screenshots TEXT,video TEXT,steam_url TEXT,claimed_by INTEGER,deep_coop INTEGER,visible INTEGER,status TEXT,created_at TEXT); CREATE TABLE favorites(id INTEGER PRIMARY KEY,game_id INTEGER); CREATE TABLE game_claims(id INTEGER PRIMARY KEY,game_id INTEGER REFERENCES games(id) ON DELETE CASCADE); INSERT INTO accounts VALUES(1,'test@example.com','developer','verified');");
  const secret='test-session-only',body=Buffer.from(JSON.stringify({aid:1,email:'test@example.com',exp:Date.now()+60000})).toString('base64url');
  const cookie='sry_session='+body+'.'+createHmac('sha256',secret).update(body).digest('hex');
  const env={DB,R2:{},SESSION_SECRET:secret,ADMIN_EMAILS:'test@example.com'};
  const request=(path,data)=>new Request('https://test.example/'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data)});
  const payload={t_zh:'测试游戏',source_language:'zh',d_source:'中文简介',full_source:'## 玩法\n\n- 探索',studio_name:'Studio',stage:'Demo',genres:['Action'],platforms:['PC'],region:'Global',needs:['Seeking Publisher'],cover:'https://example.com/cover.png',screenshots:['https://example.com/shot.png']};
  const res=await submit({env,request:request('create',payload),params:{path:['create']}});
  assert.equal(res.status,200);assert.equal((await res.json()).translation_status,'unconfigured');
  const game=await DB.prepare('SELECT * FROM games').first();assert.equal(game.full_zh,payload.full_source);assert.equal(game.full_en,'');assert.equal(game.status,'pending');
  await DB.exec("INSERT INTO games(id,slug,t_en,status) VALUES(2,'keep','Keep','approved'); INSERT INTO favorites VALUES(1,1); INSERT INTO favorites VALUES(2,2); INSERT INTO game_claims VALUES(1,1);");
  const realFetch=globalThis.fetch;
  try {
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({t_en:'Translated title',t_ko:'번역 제목',d_en:'Translated pitch',d_ko:'번역 소개',full_en:'## Gameplay\n\n- Explore',full_ko:'## 게임\n\n- 탐험'})}}]});
    const translatedResponse=await submit({env:{...env,TRANSLATION_API_KEY:'test-only'},request:request('create',{...payload,t_zh:'第二个游戏'}),params:{path:['create']}});
    assert.equal(translatedResponse.status,200);assert.equal((await translatedResponse.json()).translation_status,'complete');
    const translated=await DB.prepare("SELECT * FROM games WHERE t_zh='第二个游戏'").first();assert.equal(translated.full_zh,payload.full_source);assert.equal(translated.full_en,'## Gameplay\n\n- Explore');assert.equal(translated.t_en,'Translated title');
    const draftResponse=await admin({env:{...env,TRANSLATION_API_KEY:'test-only'},request:request('game-translate',{id:2,content:{t_en:'Keep',d_en:'Pitch',full_en:'Source'}}),params:{path:['game-translate']}});
    // This provider fixture lacks the expected missing t_zh and rejects the draft.
    assert.equal(draftResponse.status,503);assert.equal((await DB.prepare('SELECT t_en FROM games WHERE id=2').first()).t_en,'Keep');
  }finally{globalThis.fetch=realFetch;}
  const invalid=await admin({env,request:request('game-delete',{id:'1x'}),params:{path:['game-delete']}});assert.equal(invalid.status,400);
  const unauthorized=await admin({env:{...env,ADMIN_EMAILS:'other@example.com'},request:request('game-delete',{id:1}),params:{path:['game-delete']}});assert.equal(unauthorized.status,403);
  const del=await admin({env,request:request('game-delete',{id:1}),params:{path:['game-delete']}});assert.equal(del.status,200);
  assert.equal(await DB.prepare('SELECT id FROM games WHERE id=1').first(),null);assert.ok(await DB.prepare('SELECT id FROM games WHERE id=2').first());
  assert.equal(await DB.prepare('SELECT id FROM favorites WHERE game_id=1').first(),null);assert.ok(await DB.prepare('SELECT id FROM favorites WHERE game_id=2').first());
  assert.equal(await DB.prepare('SELECT id FROM game_claims WHERE game_id=1').first(),null);
  const missing=await admin({env,request:request('game-delete',{id:1}),params:{path:['game-delete']}});assert.equal(missing.status,404);
 }finally{await mf.dispose();}
});

test('admin summary omits heavy fields and authenticated detail returns only the selected game',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'test',modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:{DB:'summary-regression'},compatibilityDate:'2026-10-08'}));
 try {
  const DB=await mf.getD1Database('DB');await DB.exec(await readFile(new URL('./fixtures/schema.sql',import.meta.url),'utf8'));
  await DB.exec("INSERT INTO accounts(id,email,role,status) VALUES(1,'admin@example.com','developer','verified'); INSERT INTO developer_profiles(account_id,studio_name) VALUES(1,'Studio'); INSERT INTO games(id,slug,t_en,full_en,screenshots,genres,claimed_by,status,feature_state) VALUES(1,'first','First','A detailed description','[\"https://example.com/a.jpg\"]','[\"Adventure\"]',1,'approved','pending'); INSERT INTO games(id,slug,t_en,status) VALUES(2,'second','Second','pending');");
  const secret='test-only',body=Buffer.from(JSON.stringify({aid:1,email:'admin@example.com',exp:Date.now()+60000})).toString('base64url');
  const cookie='sry_session='+body+'.'+createHmac('sha256',secret).update(body).digest('hex');
  const env={DB,SESSION_SECRET:secret,ADMIN_EMAILS:'admin@example.com'};
  const call=(path,query,authenticated=true)=>admin({env,params:{path:[path]},request:new Request('https://test.example/'+path+query,{headers:authenticated?{cookie}:{}})});
  const response=await call('games','?summary=1&status=approved');assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.rows.length,1);assert.equal(data.rows[0].id,1);assert.equal(data.rows[0].studio_name,'Studio');
  assert.equal('full_en' in data.rows[0],false);assert.equal('screenshots' in data.rows[0],false);assert.equal(data.counts.pending,1);assert.equal(data.counts.approved,1);assert.equal(data.counts.feature,1);
  const detail=await call('game','?id=1');assert.equal(detail.status,200);const full=await detail.json();assert.equal(full.row.id,1);assert.equal(full.row.full_en,'A detailed description');assert.deepEqual(full.row.screenshots,['https://example.com/a.jpg']);
  assert.equal((await call('game','?id=1',false)).status,401);assert.equal((await call('game','?id=100')).status,404);assert.equal((await call('game','?id=1x')).status,400);
  const legacy=await call('games','?status=approved');assert.equal((await legacy.json()).rows[0].full_en,'A detailed description');
 }finally{await mf.dispose();}
});
