import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHmac} from 'node:crypto';
import vm from 'node:vm';
import {onRequest as submissions} from '../functions/api/games-submit/[[path]].js';
import {onRequest as profile} from '../functions/api/profile/[[path]].js';
import {TERMS_VERSION} from '../functions/lib/terms.js';
const {Miniflare,convertV4MiniflareOptions}=createRequire(import.meta.url)('miniflare');

test('browser and server agreement versions match and every agreement is complete in three languages',async()=>{
 const browser={};
 vm.runInNewContext(await readFile(new URL('../assets/terms.js',import.meta.url),'utf8'),{globalThis:browser});
 const terms=browser.SryTerms;
 assert.deepEqual({...terms.version},TERMS_VERSION);
 for(const doc of ['developer','partner']){
  const clauseCount=terms.agreements[doc].en.clauses.length;
  for(const lang of ['en','zh','ko']){
   const text=terms.agreements[doc][lang];
   assert.ok(text.title&&text.intro&&text.audience);
   assert.equal(text.clauses.length,clauseCount);
   assert.ok(text.clauses.every(([heading,body])=>heading&&body));
   assert.ok(terms.errors(doc,lang).terms_required.includes(text.title));
  }
 }
 for(const lang of ['en','zh','ko'])assert.equal(terms.guidelines[lang].items.length,terms.guidelines.en.items.length);
 // The developer agreement covers free listings only and states the editing and contact permissions.
 const developer=terms.agreements.developer.zh.clauses.map(clause=>clause[1]).join('');
 for(const word of ['翻译','编辑','发行商和投资者查看'])assert.ok(developer.includes(word));
 assert.ok(!/费用|收费|付费/.test(developer));
 assert.ok(terms.agreements.partner.zh.clauses.map(clause=>clause[1]).join('').includes('开发者查看'));
});

test('submissions and partner profiles are saved only with consent to the current agreement, which is recorded once per version',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'terms-test',modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:{DB:'terms'},compatibilityDate:'2026-10-08'}));
 try{
  const DB=await mf.getD1Database('DB');await DB.exec(await readFile(new URL('./fixtures/schema.sql',import.meta.url),'utf8'));
  await DB.exec("INSERT INTO accounts(id,email,role,status) VALUES(1,'dev@example.com','developer','verified'),(2,'partner@example.com','partner','pending');");
  const secret='local-terms-test-only',env={DB,R2:{},SESSION_SECRET:secret};
  const emails={1:'dev@example.com',2:'partner@example.com'};
  const cookie=aid=>{const body=Buffer.from(JSON.stringify({aid,email:emails[aid],exp:Date.now()+60000})).toString('base64url');return 'sry_session='+body+'.'+createHmac('sha256',secret).update(body).digest('hex');};
  const call=(handler,path,payload,aid)=>handler({env,params:{path:[path]},request:new Request('https://test.example/api/'+path,{method:'POST',headers:{cookie:cookie(aid),'content-type':'application/json'},body:JSON.stringify(payload)})});
  const count=async table=>(await DB.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
  const accepted=async()=>(await DB.prepare('SELECT account_id,doc,version FROM terms_acceptances ORDER BY id').all()).results;

  const game={t_en:'Consent Game',source_language:'en',full_source:'Seeking a publisher for a puzzle adventure.',studio_name:'Studio',stage:'Demo',genres:['Puzzle'],platforms:['PC'],region:'Global',needs:['Seeking Publisher'],cover:'https://example.com/cover.png',screenshots:['https://example.com/shot.png']};
  const missing=await call(submissions,'create',game,1);
  assert.equal(missing.status,400);assert.equal((await missing.json()).error,'terms_required');
  const outdated=await call(submissions,'create',{...game,terms_version:'2020-01-01'},1);
  assert.equal(outdated.status,400);assert.equal((await outdated.json()).error,'terms_outdated');
  assert.equal(await count('games'),0);assert.equal(await count('terms_acceptances'),0);

  const consent={...game,terms_version:TERMS_VERSION.developer};
  assert.equal((await call(submissions,'create',consent,1)).status,200);
  assert.equal((await call(submissions,'create',{...consent,t_en:'Second Consent Game'},1)).status,200);
  assert.equal(await count('games'),2);
  assert.deepEqual(await accepted(),[{account_id:1,doc:'developer',version:TERMS_VERSION.developer}]);

  // Studio info carries no separate agreement; partner profiles do.
  assert.equal((await call(profile,'save',{studio_name:'Studio',contact_email:'dev@example.com'},1)).status,200);
  const partner={name_en:'Publisher',logo:'https://example.com/logo.png',kinds:['publishing'],region:'KR',intro:'We publish puzzle games.',markets:['Global'],contact_email:'bd@example.com',proof_type:'steamworks',proof_image:'https://example.com/proof.png'};
  const refused=await call(profile,'save',partner,2);
  assert.equal(refused.status,400);assert.equal((await refused.json()).error,'terms_required');
  assert.equal((await call(profile,'save',{...partner,terms_version:'2020-01-01'},2)).status,400);
  assert.equal(await count('partner_profiles'),0);
  assert.equal((await call(profile,'save',{...partner,terms_version:TERMS_VERSION.partner},2)).status,200);
  assert.equal((await call(profile,'save',{...partner,intro:'Updated.',terms_version:TERMS_VERSION.partner},2)).status,200);
  assert.equal((await DB.prepare('SELECT intro FROM partner_profiles WHERE account_id=2').first()).intro,'Updated.');
  assert.deepEqual(await accepted(),[{account_id:1,doc:'developer',version:TERMS_VERSION.developer},{account_id:2,doc:'partner',version:TERMS_VERSION.partner}]);
 }finally{await mf.dispose();}
});
