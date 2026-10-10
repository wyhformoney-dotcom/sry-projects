const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let pendingCalls=0,detailCalls=0,deleted=false,failNext=false,releaseDelete;
  const deleteGate=new Promise(resolve=>releaseDelete=resolve);
  const row=id=>({id,t_en:'Game '+id,status:'pending',feature_state:'pending',stage:'Demo',cover:'/images/studiologo.png',genres:['Adventure'],platforms:['PC'],screenshots:['/images/studiologo.png'],full_en:'Detailed text',created_at:'2026-10-10'});
  await page.route('**/api/admin/**',async route=>{
   const u=new URL(route.request().url());let data={ok:true};let wait=0;
   if(u.pathname.endsWith('/partners')){data={ok:true,rows:[],counts:{}};wait=50;}
   if(u.pathname.endsWith('/accounts')){data={ok:true,rows:[{id:901,email:'test@example.com',role:'developer',status:'verified',studio_name:'Test studio',games_cnt:1}],counts:{developer:1,partner:0}};wait=100;}
   if(u.pathname.endsWith('/games')){
    assert.equal(u.searchParams.get('summary'),'1');const state=u.searchParams.get('status');
    if(state==='pending'){
     pendingCalls++;if(failNext){failNext=false;await route.fulfill({status:500,json:{ok:false,error:'temporary'}});return;}
     data={ok:true,rows:Array.from({length:100},(_,i)=>row(i+1)).filter(r=>!deleted||r.id!==1).map(({full_en,screenshots,genres,platforms,...r})=>r),counts:{pending:deleted?99:100}};wait=500;
    }else{data={ok:true,rows:[{...row(state==='approved'?201:301),status:state,t_en:state}],counts:{}};wait=state==='approved'?700:100;}
   }
   if(u.pathname.endsWith('/game')){detailCalls++;data={ok:true,row:row(Number(u.searchParams.get('id')))};wait=500;}
   if(u.pathname.endsWith('/game-delete')){assert.equal(route.request().postDataJSON().id,1);await deleteGate;deleted=true;}
   await delay(wait);try{await route.fulfill({json:data});}catch{ /* a superseded request may already be aborted */ }
  });
  await page.goto('http://127.0.0.1:8811/admin.html');
  await page.locator('[data-m="games"]').click();assert.match(await page.locator('#load-status').textContent(),/加载/);
  await page.waitForFunction(()=>document.querySelectorAll('#list .row').length===100);
  assert.equal(detailCalls,0);assert.equal(await page.locator('#list textarea').count(),0);assert.equal(await page.locator('#list .detail img').count(),0);
  const head=page.locator('.row[data-id="1"] .rhead');await head.click();assert.match(await page.locator('.row[data-id="1"] .detail').textContent(),/正在加载/);
  await head.click();await head.click();assert.equal(detailCalls,1);
  await page.locator('#fen-1').waitFor();await page.locator('#fen-1').fill('Unsaved draft');await head.click();await head.click();assert.equal(await page.locator('#fen-1').inputValue(),'Unsaved draft');assert.equal(detailCalls,1);
  await page.locator('.row[data-id="1"] button[onclick^="toggleFeatReject"]').click();assert.equal(await page.locator('#frejnote-1').isVisible(),true);
  await page.locator('[data-s="verified"]').click();await page.locator('[data-s="rejected"]').click();
  await page.locator('.row[data-id="301"]').waitFor();await delay(800);assert.equal(await page.locator('.row[data-id="201"]').count(),0);
  await page.locator('[data-s="pending"]').click();assert.equal(await page.locator('#list .row').count(),100);assert.equal(pendingCalls,1);
  await page.locator('.row[data-id="1"] .rhead').click();await page.locator('#fen-1').waitFor();assert.equal(detailCalls,1);
  page.once('dialog',d=>d.accept());const del=page.locator('.row[data-id="1"] button[onclick^="deleteGame"]');await del.click();assert.match(await del.textContent(),/删除中/);assert.equal(await del.isDisabled(),true);releaseDelete();
  await page.waitForFunction(()=>document.querySelectorAll('#list .row').length===99);assert.equal(pendingCalls,2);assert.equal(await page.locator('.row[data-id="1"]').count(),0);
  failNext=true;await page.getByRole('button',{name:'刷新数据',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#load-status').textContent.includes('失败'));
  assert.equal(await page.locator('#main').isVisible(),true);assert.equal(await page.locator('#locked').isVisible(),false);
  await page.getByRole('button',{name:'刷新数据',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#list .row').length===99);
  await page.locator('[data-m="accounts"]').click();await page.locator('.row[data-id="901"]').waitFor();assert.equal(await page.locator('#ar-dev').textContent(),'开发者(1)');
  assert.deepEqual(errors,[]);console.log('PASS: 100 lightweight rows, deferred/cached details, draft preservation, slow-network feedback, stale-request cancellation, mutation cache invalidation and network retry');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
