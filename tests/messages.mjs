import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHmac,randomUUID} from 'node:crypto';
import {onRequest as contacts} from '../functions/api/contacts/[[path]].js';
import {onRequest as messages} from '../functions/api/messages/[[path]].js';
import {onRequestGet as publicGames} from '../functions/api/games.js';
const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const migration=await readFile(new URL('../migrations/20261010_developer_messages.sql',import.meta.url),'utf8');
const secret='local-message-test-only',month=new Date().toISOString().slice(0,7);
function cookie(id){const body=Buffer.from(JSON.stringify({aid:id,exp:Date.now()+60000})).toString('base64url');return 'sry_session='+body+'.'+createHmac('sha256',secret).update(body).digest('hex');}
async function fixture(){
 const mf=new Miniflare(convertV4MiniflareOptions({name:'message-tests',modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:{DB:randomUUID()},compatibilityDate:'2026-10-08'}));
 const DB=await mf.getD1Database('DB');await DB.exec(await readFile(new URL('./fixtures/schema.sql',import.meta.url),'utf8'));await DB.exec(migration.replace(/\n/g,' '));
 await DB.exec("INSERT INTO accounts(id,email,role,status) VALUES(1,'partner@example.com','partner','verified'),(2,'race@example.com','partner','verified'),(3,'pending@example.com','partner','pending'),(4,'suspended@example.com','partner','suspended'); INSERT INTO partner_profiles(account_id,name_en,kinds,contact_email) VALUES(1,'Publisher','[\"publishing\"]','business@example.com'),(2,'Investor','[\"investment\"]','investor@example.com'),(3,'Pending','[\"publishing\"]','pending@example.com');");
 await DB.batch(Array.from({length:16},(_,i)=>DB.prepare("INSERT INTO accounts(id,email,role,status) VALUES(?,?, 'developer','verified')").bind(i+10,'dev'+i+'@example.com')));
 await DB.batch(Array.from({length:16},(_,i)=>DB.prepare('INSERT INTO developer_profiles(account_id,studio_name,contact_email) VALUES(?,?,?)').bind(i+10,'Studio '+i,'dev'+i+'@example.com')));
 await DB.batch(Array.from({length:16},(_,i)=>DB.prepare("INSERT INTO games(id,slug,t_en,t_zh,claimed_by,contact,status,visible) VALUES(?,?,?,?,?,?,'approved',1)").bind(110+i,'game-'+i,'Game '+i,'游戏 '+i,10+i,'dev'+i+'@example.com')));
 const env={DB,SESSION_SECRET:secret};
 async function call(handler,id,path,body,origin){const [p,query='']=path.split('?');return handler({env,params:{path:[p]},request:new Request('https://test.example/api/'+p+(query?'?'+query:''),{method:body?'POST':'GET',headers:{...(id?{cookie:cookie(id)}:{}),...(body?{'content-type':'application/json'}:{}),...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined})});}
 async function unlocks(sender,count=10){await DB.batch(Array.from({length:count},(_,i)=>DB.prepare("INSERT INTO contact_views(viewer_id,target_type,target_id,ym) VALUES(?,'developer',?,?)").bind(sender,10+i,month)));}
 return {mf,DB,env,call,unlocks};
}
test('partners get 10 distinct contacts, repeated developers stay free and simultaneous requests cannot exceed quota',async()=>{
 const f=await fixture();try{
  await f.unlocks(1,9);const tenth=await f.call(contacts,1,'reveal',{type:'developer',game_id:119});assert.equal(tenth.status,200);assert.equal((await tenth.json()).used,10);
  const over=await f.call(contacts,1,'reveal',{type:'developer',game_id:120});assert.equal(over.status,429);assert.equal((await over.json()).quota,10);
  const repeat=await f.call(contacts,1,'reveal',{type:'developer',game_id:110});assert.equal((await repeat.json()).already,true);
  await f.DB.prepare("INSERT INTO games(id,t_en,claimed_by,status,visible) VALUES(200,'Another game',10,'approved',1)").run();assert.equal((await(await f.call(contacts,1,'reveal',{type:'developer',game_id:200})).json()).used,10);
  await f.unlocks(2,9);const race=await Promise.all([119,120].map(game_id=>f.call(contacts,2,'reveal',{type:'developer',game_id})));assert.deepEqual(race.map(r=>r.status).sort(),[200,429]);
  assert.equal((await f.DB.prepare('SELECT count(*) AS c FROM contact_views WHERE viewer_id=2').first()).c,10);
  assert.equal((await(await f.call(contacts,10,'mine')).json()).quota,5);
  assert.equal((await f.call(contacts,4,'mine')).status,403);
  await f.DB.prepare("UPDATE contact_views SET ym='2000-01' WHERE viewer_id=1").run();assert.equal((await(await f.call(contacts,1,'mine')).json()).used,0);
 }finally{await f.mf.dispose();}
});
test('messaging requires exhausted current-month quota and a verified partner with a visible owned game',async()=>{
 const f=await fixture();try{
  const body={game_id:110,subject:'A publishing offer',body:'Hello developer',request_key:randomUUID()};
  await f.unlocks(1,9);assert.equal((await(await f.call(messages,1,'eligible?game_id=110')).json()).can_send,false);
  assert.equal((await f.call(messages,1,'send',body)).status,403);
  await f.DB.prepare("INSERT INTO contact_views(viewer_id,target_type,target_id,ym) VALUES(1,'developer',19,?)").bind(month).run();
  assert.equal((await(await f.call(messages,1,'eligible?game_id=110')).json()).can_send,true);
  for(const id of [3,4,10])assert.equal((await f.call(messages,id,'send',body)).status,403);
  assert.equal((await f.call(messages,0,'send',body)).status,401);assert.equal((await f.call(messages,1,'send',body,'https://untrusted.example')).status,403);
  assert.equal((await f.call(messages,1,'send',{...body,body:'x'.repeat(2001)})).status,400);
  assert.equal((await f.call(messages,1,'send',{...body,request_key:'bad'})).status,400);
  await f.DB.prepare('UPDATE games SET visible=0 WHERE id=110').run();assert.equal((await(await f.call(messages,1,'eligible?game_id=110')).json()).reason,'developer_unavailable');
  await f.DB.prepare('UPDATE games SET visible=1,claimed_by=NULL WHERE id=110').run();assert.equal((await f.call(messages,1,'send',body)).status,403);
  await f.DB.prepare('UPDATE games SET claimed_by=10 WHERE id=110').run();await f.DB.prepare("UPDATE contact_views SET ym='2000-01'").run();assert.equal((await f.call(messages,1,'send',body)).status,403);
 }finally{await f.mf.dispose();}
});
test('messages are idempotent, private to their developer, readable once, and removed after 30 days',async()=>{
 const f=await fixture();try{
  await f.unlocks(1);const body={game_id:110,subject:'Offer <img src=x>',body:'Hello\n<script>alert(1)</script>',request_key:randomUUID()};
  const sent=await(await f.call(messages,1,'send',body)).json();assert.equal(sent.ok,true);
  assert.equal((await(await f.call(messages,1,'send',body)).json()).already,true);
  assert.equal((await f.call(messages,1,'send',{...body,body:'Changed'})).status,409);
  assert.equal((await f.call(messages,1,'send',{...body,request_key:randomUUID()})).status,429);
  const mine=await(await f.call(messages,10,'mine')).json();assert.equal(mine.unread,1);assert.equal(mine.rows[0].subject,body.subject);assert.equal('body' in mine.rows[0],false);assert.equal('sender_email' in mine.rows[0],false);
  assert.equal((await f.call(messages,11,'read',{id:sent.id})).status,404);assert.equal((await f.call(messages,1,'mine')).status,403);
  assert.equal((await(await f.call(messages,10,'mine')).json()).unread,1);
  const read=await(await f.call(messages,10,'read',{id:sent.id})).json();assert.equal(read.row.body,body.body);assert.equal(read.row.sender_email,'business@example.com');assert.ok(read.row.read_at);
  assert.equal((await(await f.call(messages,10,'mine')).json()).unread,0);
  const stamp=await f.DB.prepare('SELECT julianday(expires_at)-julianday(created_at) AS days FROM developer_messages WHERE id=?').bind(sent.id).first();assert.equal(stamp.days,30);
  await f.DB.prepare('DELETE FROM games WHERE id=110').run();const preserved=await(await f.call(messages,10,'read',{id:sent.id})).json();assert.equal(preserved.row.game_id,null);assert.equal(preserved.row.game_title,'Game 0');
  await f.DB.prepare("UPDATE developer_messages SET expires_at=datetime('now','-1 second') WHERE id=?").bind(sent.id).run();assert.equal((await f.call(messages,10,'read',{id:sent.id})).status,404);
  assert.equal(await f.DB.prepare('SELECT id FROM developer_messages WHERE id=?').bind(sent.id).first(),null);
 }finally{await f.mf.dispose();}
});
test('inbox pagination, concurrent send protection and private interests stay outside contact unlocks',async()=>{
 const f=await fixture();try{
  await f.unlocks(1);const payload={game_id:110,subject:'Offer',body:'Hello'};
  const race=await Promise.all([randomUUID(),randomUUID()].map(request_key=>f.call(messages,1,'send',{...payload,request_key})));assert.deepEqual(race.map(r=>r.status).sort(),[200,429]);
  await f.DB.batch(Array.from({length:55},(_,i)=>f.DB.prepare('INSERT INTO developer_messages(sender_id,recipient_id,game_id,game_title,sender_name,sender_email,subject,body,request_key) VALUES(1,11,111,?,?,?,?,?,?)').bind('Game 1','Publisher','sender@example.com','Offer '+i,'Hello',randomUUID())));
  const first=await(await f.call(messages,11,'mine')).json();assert.equal(first.rows.length,50);assert.equal(first.unread,55);assert.ok(first.next_cursor);
  const second=await(await f.call(messages,11,'mine?before='+first.next_cursor)).json();assert.equal(second.rows.length,5);assert.equal(second.next_cursor,null);
  await f.DB.prepare("UPDATE partner_profiles SET name_en='Private',contact_email='secret@example.com',contact_public=0 WHERE account_id=3").run();await f.DB.prepare("INSERT INTO contact_views(viewer_id,target_type,target_id,ym) VALUES(10,'partner',3,'interest')").run();
  const own=await(await f.call(contacts,10,'mine')).json();assert.equal(own.rows.length,0);assert.equal(own.used,0);
  const pub=await publicGames({env:f.env});const data=await pub.json();assert.equal('contact' in data[0],false);assert.ok(!JSON.stringify(data).includes('dev0@example.com'));
 }finally{await f.mf.dispose();}
});
