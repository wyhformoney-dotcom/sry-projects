const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let game={id:1,t_en:'Original Brand',t_zh:'',t_ko:'',d_en:'An English-only marketing sentence.',full_en:'An English-only overview.',studio_en:'An English-only studio introduction.',developer:'Official Studio',status:'approved',visible:1,stage:'Demo',region:'Global',genres:['Adventure'],needs:['Seeking Publisher'],platforms:['PC'],screenshots:[],cover:'/images/studiologo.png'},saved,release;
  const gate=new Promise(resolve=>release=resolve);
  await page.route('https://fonts.**',r=>r.abort());
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let data={ok:true};
   if(path==='/api/games')data=[game];
   else if(path==='/api/auth/me')data={loggedIn:true,role:'developer',status:'verified',email:'test@example.com'};
   else if(path==='/api/admin/partners')data={ok:true,rows:[],counts:{}};
   else if(path==='/api/admin/games')data={ok:true,rows:[{id:game.id,t_en:game.t_en,status:game.status}],counts:{approved:1}};
   else if(path==='/api/admin/game')data={ok:true,row:game};
   else if(path==='/api/admin/game-translate'){
    const input=route.request().postDataJSON().content;assert.equal(input.d_zh,game.d_en);assert.equal(input.studio_en,game.studio_en);
    await gate;data={ok:true,content:{...input,d_zh:'中文卡片简介。',d_ko:'한국어 카드 소개입니다.',studio_zh:'中文团队介绍。',studio_ko:'생성된 팀 소개입니다.'},translated_fields:['d_zh','d_ko','studio_zh','studio_ko']};
   }else if(path==='/api/admin/game-update'){saved=route.request().postDataJSON();game={...game,...saved.changes};data={ok:true,id:1,updated:saved.changes};}
   await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:8811/index.html');await page.locator('.card').waitFor();
  for(const locale of ['zh','ko']){
   await page.locator(`#lang [data-l="${locale}"]`).click();assert.equal(await page.locator('.card-desc').textContent(),'');assert.equal(await page.locator('.card-title').textContent(),'Original Brand');
  }
  await page.goto('http://127.0.0.1:8811/game.html?id=original-brand');await page.locator('.ptitle').waitFor();
  for(const locale of ['zh','ko']){
   await page.locator(`#lang [data-l="${locale}"]`).click();assert.equal(await page.locator('.ptitle').textContent(),'Original Brand');
   assert.equal(await page.locator('.tagline,.overview').count(),0);assert.equal(await page.locator('.studio-desc').textContent(),'');
   assert.doesNotMatch(await page.locator('#app').textContent(),/English-only/);
  }
  game={...game,d_zh:game.d_en,d_ko:game.d_en,full_zh:'中文概览。',full_ko:'한국어 개요입니다.'};
  await page.goto('http://127.0.0.1:8811/admin.html');await page.locator('[data-m="games"]').click();await page.locator('.row[data-id="1"] .rhead').click();
  const translate=page.getByRole('button',{name:'补全三语并修复语言不符的内容',exact:true});await translate.click();
  await page.locator('#sko-1').fill('요청 중 직접 작성한 팀 소개입니다.');release();
  await page.waitForFunction(()=>document.querySelector('#dzh-1').value==='中文卡片简介。');
  assert.equal(await page.locator('#dko-1').inputValue(),'한국어 카드 소개입니다.');assert.equal(await page.locator('#szh-1').inputValue(),'中文团队介绍。');
  assert.equal(await page.locator('#sko-1').inputValue(),'요청 중 직접 작성한 팀 소개입니다.');assert.equal(await page.locator('#fen-1').inputValue(),game.full_en);
  await page.getByRole('button',{name:'保存三语内容',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#load-status').textContent.includes('三语内容已保存'));
  assert.deepEqual(Object.keys(saved.changes).sort(),['d_zh','d_ko','studio_zh','studio_ko'].sort());assert.equal(saved.expected.d_zh,'An English-only marketing sentence.');
  assert.deepEqual(errors,[]);console.log('PASS: prose never falls back to another language, official titles remain usable, wrong filled pitches and team text are repaired, newer typing survives and changed fields save');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
