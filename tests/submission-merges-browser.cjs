const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:8811';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const directory=process.env.SCREENSHOT_DIR;if(directory)require('node:fs').mkdirSync(directory,{recursive:true});
  const keep={id:10,t_en:'Same "Game"',t_zh:'同名游戏',t_ko:'같은 게임',status:'approved',visible:1,claimed_by:2,cover:'/images/studiologo.png',stage:'Demo',genres:['Adventure'],platforms:['PC'],needs:['Seeking Publisher'],screenshots:[],full_en:'Retained content'};
  let rows=[keep,{...keep,id:11,status:'pending',visible:0,full_en:'New application content'}],duplicate=true,creates=0,posted,failCreate=true,mergeCalls=0,release;
  const mergeGate=new Promise(resolve=>release=resolve);
  await page.route('https://fonts.**',r=>r.abort());
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname;let data={ok:true},status=200;
   if(path==='/api/auth/me')data={loggedIn:true,needsRole:false,role:'developer',status:'verified',email:'test@example.com',isAdmin:true};
   else if(path==='/api/profile/me')data={ok:true,role:'developer',status:'verified',email:'test@example.com',profile:{studio_name:'Studio'}};
   else if(path==='/api/games-submit/duplicates')data={ok:true,duplicates:duplicate?[keep]:[]};
   else if(path==='/api/games-submit/create'){
    creates++;const next=route.request().postDataJSON();assert.equal(next.allow_duplicate,true);assert.match(next.submission_key,/^[a-f0-9-]{36}$/);
    if(posted)assert.equal(next.submission_key,posted.submission_key);posted=next;
    if(failCreate){failCreate=false;status=500;data={ok:false,error:'temporary'};}else data={ok:true,id:12,translation_status:'complete'};
   }else if(path==='/api/admin/partners')data={ok:true,rows:[],counts:{}};
   else if(path==='/api/admin/games'){
    const filter=url.searchParams.get('status');data={ok:true,rows:rows.filter(row=>filter==='all'||row.status===filter).map(({full_en,screenshots,...row})=>row),counts:{pending:rows.filter(r=>r.status==='pending').length,approved:1,merged:rows.filter(r=>r.status==='merged').length}};
   }else if(path==='/api/admin/game')data={ok:true,row:rows.find(r=>r.id===Number(url.searchParams.get('id')))};
   else if(path==='/api/admin/game-merge-candidates')data={ok:true,source:rows[1],candidates:[{...keep,same_game:true,can_keep:true}]};
   else if(path==='/api/admin/game-merge'){
    mergeCalls++;const request=route.request().postDataJSON();assert.equal(request.source_id,11);assert.equal(request.target_id,10);await mergeGate;
    rows[1]={...rows[1],status:'merged',visible:0,merged_into:10,merge_target:keep,merged_at:'2026-10-26 10:00:00'};data={ok:true,source_id:11,target_id:10};
   }else if(path==='/api/games-submit/mine')data={ok:true,rows};
   else if(path==='/api/contacts/mine')data={ok:true,rows:[],used:0,quota:5};
   else if(path==='/api/messages/mine')data={ok:true,rows:[],unread:0};
   await route.fulfill({status,json:data});
  });
  await page.goto(base+'/submit-game.html');await page.locator('#t-en').fill(keep.t_en);await page.locator('#duplicate-warning').waitFor({state:'visible'});
  assert.match(await page.locator('#duplicate-list').textContent(),/Same "Game"/);
  for(const [locale,word] of [['zh','已上架'],['ko','등록됨'],['en','Live']]){await page.locator(`#lang [data-l="${locale}"]`).click();assert.match(await page.locator('#duplicate-list').textContent(),new RegExp(word));}
  if(directory){await page.locator('#lang [data-l="zh"]').click();await page.locator('#duplicate-warning').screenshot({path:directory+'/duplicate-warning.png'});}
  await page.locator('#full-en').fill('A project seeking publishing support.');await page.evaluate(()=>{selStage=['Demo'];selGenres=['Adventure'];selPlatforms=['PC'];selMarket=['Global'];selNeeds=['Seeking Publisher'];coverUrl='https://example.com/cover.png';shotUrls=['https://example.com/shot.png'];});
  await page.locator('#submit').click();assert.equal(creates,0);
  await page.locator('#duplicate-confirm').check();await page.locator('#submit').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('err'));assert.equal(creates,1);
  await page.locator('#submit').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));assert.equal(creates,2);
  duplicate=false;await page.locator('#t-en').fill('Different title');await page.waitForFunction(()=>document.querySelector('#duplicate-warning').hidden);
  await page.goto(base+'/admin.html');await page.locator('[data-m="games"]').click();await page.locator('.row[data-id="11"] .rhead').click();
  await page.getByRole('button',{name:'合并到其他申请…',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#merge-save').disabled);
  assert.match(await page.locator('#merge-source').textContent(),/#11/);assert.equal(await page.locator('#merge-target').inputValue(),'10');
  await page.setViewportSize({width:375,height:820});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(directory)await page.screenshot({path:directory+'/merge-dialog-mobile.png'});
  await page.locator('#merge-save').click();assert.equal(await page.locator('#merge-save').isDisabled(),true);assert.equal(await page.locator('#merge-cancel').isDisabled(),true);release();
  await page.waitForFunction(()=>document.querySelector('#load-status').textContent.includes('已合并至'));assert.equal(mergeCalls,1);assert.equal(await page.locator('.row[data-id="11"]').count(),0);
  await page.locator('[data-s="merged"]').click();await page.locator('.row[data-id="11"] .rhead').click();await page.getByText('此申请已合并，原始资料保留供查阅。',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'通过并上架',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'编辑游戏资料',exact:true}).count(),0);assert.match(await page.locator('.row[data-id="11"] .detail').textContent(),/New application content/);
  await page.goto(base+'/account.html');await page.locator('#game-11').waitFor();assert.equal(await page.locator('#game-10').count(),1);assert.equal(await page.locator('#game-11').count(),1);
  for(const [locale,word] of [['en','MERGED'],['zh','已合并'],['ko','병합됨']]){await page.locator(`#lang [data-l="${locale}"]`).click();assert.equal(await page.locator('#game-11 .gpill').textContent(),word);}
  assert.equal(await page.locator('#game-11 .delbtn').count(),0);assert.equal(await page.locator('#game-11 .gmerge a').getAttribute('href'),'/game.html?id=10');
  if(directory){await page.locator('#lang [data-l="zh"]').click();await page.locator('#gamegrid').screenshot({path:directory+'/merged-developer-cards.png'});}
  assert.deepEqual(errors,[]);console.log('PASS: localized duplicate warning with explicit continuation, stable retry keys, merge confirmation, archived admin record, retained developer cards and merged status in three languages');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
