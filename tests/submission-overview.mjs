import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {onRequest as submit} from '../functions/api/games-submit/[[path]].js';
import {completeLanguages} from '../functions/lib/translate.js';
const {Miniflare,convertV4MiniflareOptions}=createRequire(import.meta.url)('miniflare');

test('Steam imports only basic details and new submissions enforce a 500-character authored overview',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'overview-test',modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:{DB:'submission-overview'},compatibilityDate:'2026-10-08'}));
 const realFetch=globalThis.fetch;
 try{
  const DB=await mf.getD1Database('DB');
  await DB.exec(await readFile(new URL('./fixtures/schema.sql',import.meta.url),'utf8'));
  await DB.exec("INSERT INTO accounts(id,email,role,status) VALUES(1,'developer@example.com','developer','verified');");
  const secret='local-overview-test-only',body=Buffer.from(JSON.stringify({aid:1,email:'developer@example.com',exp:Date.now()+60000})).toString('base64url');
  const cookie='sry_session='+body+'.'+createHmac('sha256',secret).update(body).digest('hex');
  const images=[];
  const env={DB,SESSION_SECRET:secret,R2:{async put(key){images.push(key);}}};
  const call=(path,data,bindings=env)=>submit({env:bindings,params:{path:[path]},request:new Request('https://test.example/api/games-submit/'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data)})});
  globalThis.fetch=async url=>{
   const u=new URL(url);
   if(u.pathname.endsWith('/appdetails')){
    const locale=u.searchParams.get('l');
    return Response.json({'123':{success:true,data:{name:'Title '+locale,short_description:'<p>Pitch '+locale+'</p>',about_the_game:'Player marketing copy '.repeat(150),detailed_description:'More player marketing',header_image:'https://example.com/cover.png',screenshots:[{path_full:'https://example.com/shot.png'}],developers:['Steam Studio'],genres:[{description:'Adventure'}],release_date:{coming_soon:true}}}});
   }
   return new Response('test-image',{headers:{'content-type':'image/png'}});
  };
  const imported=await call('steam-fetch',{url:'https://store.steampowered.com/app/123/'});
  assert.equal(imported.status,200);
  const data=await imported.json();
  for(const [lang,locale] of [['en','english'],['zh','schinese'],['ko','koreana']]){
   assert.equal(data['t_'+lang],'Title '+locale);assert.equal(data['d_'+lang],'Pitch '+locale);
   assert.equal('full_'+lang in data,false);
  }
  assert.equal(data.studio_name,'Steam Studio');assert.equal(data.stage,'In Development');
  assert.equal(data.screenshots.length,1);assert.equal(images.length,2);
  assert.ok(data.cover.startsWith('https://assets.srygamehub.com/'));
  const payload={t_zh:'项目',source_language:'zh',d_source:'一句话简介',full_source:'特色玩法与发行需求。',studio_name:'Studio',stage:'Demo',genres:['Adventure'],platforms:['PC'],region:'Global',needs:['Seeking Publisher'],cover:data.cover,screenshots:data.screenshots};
  const count=async()=>Number((await DB.prepare('SELECT COUNT(*) AS n FROM games').first()).n);
  for(const extra of [{full_source:'字'.repeat(501)},{full_en:'x'.repeat(501)},{full_ko:'가'.repeat(501)}]){
   const response=await call('create',{...payload,...extra});
   assert.equal(response.status,400);assert.equal((await response.json()).error,'desc_too_long');assert.equal(await count(),0);
  }
  const accepted=await call('create',{...payload,full_source:'字'.repeat(500)});
  assert.equal(accepted.status,200);assert.equal((await accepted.json()).translation_status,'unconfigured');
  const stored=await DB.prepare('SELECT full_zh,full_en,status,visible FROM games').first();
  assert.deepEqual(stored,{full_zh:'字'.repeat(500),full_en:'',status:'pending',visible:0});
  globalThis.fetch=async(_url,options)=>{
   const request=JSON.parse(options.body);
   assert.match(request.messages[0].content,/over 500 characters/);
   const missing=JSON.parse(request.messages[1].content).missing;
   return Response.json({choices:[{message:{content:JSON.stringify(Object.fromEntries(missing.map(key=>[key,key.startsWith('full_')?'x'.repeat(501):'Translation'])))}}]});
  };
  const failedTranslation=await call('create',payload,{...env,TRANSLATION_API_KEY:'test-only'});
  assert.equal(failedTranslation.status,200);assert.equal((await failedTranslation.json()).translation_status,'failed');
  const recoverable=await DB.prepare('SELECT full_en,full_zh,status FROM games ORDER BY id DESC LIMIT 1').first();
  assert.deepEqual(recoverable,{full_en:'',full_zh:payload.full_source,status:'pending'});
 }finally{globalThis.fetch=realFetch;await mf.dispose();}
});

test('translation drafts stay within 500 characters and preserve existing longer authored admin text',async()=>{
 const original={t_en:'Brand',t_zh:'品牌',t_ko:'브랜드',d_en:'Pitch',d_zh:'简介',d_ko:'소개',full_zh:'独特玩法。\n\n- 已有可玩版本\n- 寻找发行合作',source_language:'zh'};
 const realFetch=globalThis.fetch;
 try{
  let length=500;
  globalThis.fetch=async(_url,options)=>{
   const request=JSON.parse(options.body),missing=JSON.parse(request.messages[1].content).missing;
   assert.match(request.messages[0].content,/B2B project overviews for publishers and investors/);
   if(length===500)assert.match(request.messages[0].content,/350-character target/);
   return Response.json({choices:[{message:{content:JSON.stringify(Object.fromEntries(missing.map(key=>[key,'x'.repeat(length)])))}}]});
  };
  const env={TRANSLATION_API_KEY:'test-only',TRANSLATION_PROVIDER:'deepseek'};
  const translated=await completeLanguages(env,original,{fullLimit:500});
  assert.equal(translated.status,'complete');assert.equal(translated.content.full_zh,original.full_zh);
  assert.equal(translated.content.full_en.length,500);assert.equal(translated.content.full_ko.length,500);
  length=501;assert.deepEqual(await completeLanguages(env,original,{fullLimit:500}),{content:original,status:'failed'});
  assert.deepEqual(await completeLanguages(env,original),{content:original,status:'failed'});
  length=500;
  const longerOriginal={...original,full_zh:'原'.repeat(900)};
  const adminDraft=await completeLanguages(env,longerOriginal);
  assert.equal(adminDraft.status,'complete');assert.equal(adminDraft.content.full_zh,longerOriginal.full_zh);
  assert.equal(adminDraft.content.full_en.length,500);assert.equal(adminDraft.content.full_ko.length,500);
 }finally{globalThis.fetch=realFetch;}
});
