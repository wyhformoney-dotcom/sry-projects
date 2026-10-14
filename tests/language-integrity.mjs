import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {matchesContentLanguage,translationTargets} from '../functions/lib/content-language.js';
import {completeLanguages} from '../functions/lib/translate.js';
import {onRequest as admin} from '../functions/api/admin/[[path]].js';
import {onRequest as submit} from '../functions/api/games-submit/[[path]].js';
import {onRequestGet as games} from '../functions/api/games.js';
const {Miniflare,convertV4MiniflareOptions}=createRequire(import.meta.url)('miniflare');

test('wrong nonempty short pitches and optional studio introductions are translation targets',async()=>{
 const original={t_en:'Teleport Master',t_zh:'传送大师',t_ko:'텔레포트 마스터',developer:'Fluffy Games',d_en:'Create portals and explore a science fiction world.',d_zh:'Create portals and explore a science fiction world.',d_ko:'Create portals and explore a science fiction world.',full_en:'Seeking a publishing partner.',full_zh:'寻找发行合作伙伴。',full_ko:'퍼블리싱 파트너를 찾습니다.',studio_en:'An independent game studio.'};
 const expected=['d_zh','d_ko','studio_zh','studio_ko'];
 assert.deepEqual(translationTargets(original),expected);
 assert.equal(matchesContentLanguage('Teleport Master 与 Fluffy Games 寻找发行伙伴。','zh',['Teleport Master','Fluffy Games']),true);
 assert.equal(matchesContentLanguage('KISI: The Deja Vu (기시: 더 데자뷰) is a horror adventure game.','en',['KISI: The Deja Vu','기시: 더 데자뷰']),true);
 assert.equal(matchesContentLanguage('Это русское описание игры.','en'),false);
 const realFetch=globalThis.fetch;
 try{
  let wrong=false;
  globalThis.fetch=async(_url,options)=>{
   const body=JSON.parse(options.body);assert.deepEqual(JSON.parse(body.messages[1].content).missing,expected);
   return Response.json({choices:[{message:{content:JSON.stringify({d_zh:wrong?original.d_zh:'创建传送门，探索科幻世界。',d_ko:'포털을 만들고 공상과학 세계를 탐험하세요.',studio_zh:'独立游戏开发工作室。',studio_ko:'독립 게임 개발 스튜디오입니다.'})}}]});
  };
  const env={TRANSLATION_API_KEY:'test-only',TRANSLATION_PROVIDER:'deepseek'};
  const translated=await completeLanguages(env,original);
  assert.equal(translated.status,'complete');assert.deepEqual(translated.translated_fields,expected);
  assert.equal(translated.content.d_en,original.d_en);assert.equal(translated.content.full_zh,original.full_zh);
  wrong=true;assert.deepEqual(await completeLanguages(env,original),{content:original,status:'failed'});
 }finally{globalThis.fetch=realFetch;}
});

test('Steam fallback is rejected, admin drafts repair filled fields and approval checks translations',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'language-test',modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:{DB:'language-integrity'},compatibilityDate:'2026-10-08'}));
 const realFetch=globalThis.fetch;
 try{
  const DB=await mf.getD1Database('DB');await DB.exec(await readFile(new URL('./fixtures/schema.sql',import.meta.url),'utf8'));
  await DB.exec("INSERT INTO accounts(id,email,role,status) VALUES(1,'admin@example.com','developer','verified'); INSERT INTO games(id,slug,t_en,t_zh,t_ko,d_en,d_zh,d_ko,full_en,full_zh,full_ko,claimed_by,status,visible) VALUES(1,'game','Brand','品牌','브랜드','Explore a unique world.','Explore a unique world.','Explore a unique world.','Seeking publishing.','寻找发行合作。','퍼블리싱 협력을 찾습니다.',1,'pending',0);");
  const secret='local-language-test-only',body=Buffer.from(JSON.stringify({aid:1,email:'admin@example.com',exp:Date.now()+60000})).toString('base64url');
  const cookie='sry_session='+body+'.'+createHmac('sha256',secret).update(body).digest('hex');
  const env={DB,SESSION_SECRET:secret,ADMIN_EMAILS:'admin@example.com',R2:{},TRANSLATION_API_KEY:'test-only'};
  const call=(handler,path,payload,bindings=env)=>handler({env:bindings,params:{path:[path]},request:new Request('https://test.example/api/'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(payload)})});
  globalThis.fetch=async url=>{
   const appid=new URL(url).searchParams.get('appids');
   return Response.json({[appid]:{success:true,data:{name:'Brand',short_description:'Explore a unique world.',about_the_game:'Explore a unique world.'}}});
  };
  for(const handler of [submit,admin]){
   const response=await call(handler,'steam-fetch',{url:'https://store.steampowered.com/app/123/'});assert.equal(response.status,200);
   const imported=await response.json();assert.equal(imported.d_en,'Explore a unique world.');assert.equal(imported.d_zh,'');assert.equal(imported.d_ko,'');
   if(handler===admin){assert.equal(imported.full_zh,'');assert.equal(imported.full_ko,'');}
  }
  const blocked=await call(admin,'review-game',{id:1,action:'approve'});assert.equal((await blocked.json()).error,'translations_required');
  assert.equal((await DB.prepare('SELECT status FROM games WHERE id=1').first()).status,'pending');
  globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({d_zh:'探索独特的世界。',d_ko:'독특한 세계를 탐험하세요.'})}}]});
  const draft=await (await call(admin,'game-translate',{id:1})).json();
  assert.deepEqual(draft.translated_fields,['d_zh','d_ko']);assert.equal(draft.content.d_zh,'探索独特的世界。');
  assert.equal((await DB.prepare('SELECT d_zh FROM games WHERE id=1').first()).d_zh,'Explore a unique world.');
  const update=await call(admin,'game-update',{id:1,changes:{d_zh:draft.content.d_zh,d_ko:draft.content.d_ko},expected:{d_zh:'Explore a unique world.',d_ko:'Explore a unique world.'}});assert.equal(update.status,200);
  assert.equal((await call(admin,'review-game',{id:1,action:'approve'})).status,200);
  const invalid=await call(admin,'game-update',{id:1,changes:{d_zh:'This is still English.'},expected:{d_zh:draft.content.d_zh}});assert.equal((await invalid.json()).error,'wrong_content_language');
  await DB.prepare('UPDATE games SET d_ko=? WHERE id=1').bind('Legacy untranslated English.').run();
  const published=await (await games({env})).json();assert.equal(published[0].d_ko,'');assert.equal(published[0].d_zh,'探索独特的世界。');
  // Admin-created Steam imports are localized before publishing as well.
  globalThis.fetch=async(_url,options)=>{
   const missing=JSON.parse(JSON.parse(options.body).messages[1].content).missing;
   return Response.json({choices:[{message:{content:JSON.stringify(Object.fromEntries(missing.map(key=>[key,key.endsWith('_zh')?'中文简介。':key.endsWith('_ko')?'한국어 소개입니다.':'English pitch.'])))}}]});
  };
  const created=await call(admin,'game-create',{t_en:'Other',t_zh:'另一个',t_ko:'다른 게임',d_en:'A different adventure.',d_zh:'A different adventure.',d_ko:'A different adventure.'});assert.equal(created.status,200);
  const newGame=await DB.prepare('SELECT d_zh,d_ko,status FROM games ORDER BY id DESC LIMIT 1').first();assert.equal(newGame.d_zh,'中文简介。');assert.equal(newGame.d_ko,'한국어 소개입니다.');assert.equal(newGame.status,'approved');
  globalThis.fetch=async(_url,options)=>{
   const source=JSON.parse(JSON.parse(options.body).messages[1].content);
   assert.equal(source.source.full_zh,'卡牌解谜游戏，已有试玩版，寻找发行合作。');
   assert.ok(source.missing.includes('d_en')&&source.missing.includes('d_zh')&&source.missing.includes('d_ko'));
   return Response.json({choices:[{message:{content:JSON.stringify(Object.fromEntries(source.missing.map(key=>[key,key.startsWith('t_')?'Card Project':key.endsWith('_zh')?'卡牌解谜游戏，已有试玩版。':key.endsWith('_ko')?'체험판이 있는 카드 퍼즐 게임입니다.':'A card puzzle game with a demo.'])))}}]});
  };
  const derived=await call(submit,'create',{t_en:'Card Project',t_zh:'卡牌项目',t_ko:'카드 프로젝트',source_language:'zh',full_source:'卡牌解谜游戏，已有试玩版，寻找发行合作。',studio_name:'Studio',stage:'Demo',genres:['Puzzle'],platforms:['PC'],needs:['Seeking Publisher'],region:'Global',cover:'https://example.com/cover.png',screenshots:['https://example.com/shot.png']});
  assert.equal(derived.status,200);assert.equal((await derived.json()).translation_status,'complete');
  const derivedRow=await DB.prepare('SELECT d_en,d_zh,d_ko,status FROM games ORDER BY id DESC LIMIT 1').first();
  assert.equal(derivedRow.d_en,'A card puzzle game with a demo.');assert.equal(derivedRow.d_zh,'卡牌解谜游戏，已有试玩版。');assert.equal(derivedRow.d_ko,'체험판이 있는 카드 퍼즐 게임입니다.');assert.equal(derivedRow.status,'pending');
 }finally{globalThis.fetch=realFetch;await mf.dispose();}
});
