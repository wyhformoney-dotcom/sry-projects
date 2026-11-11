const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let parses=0,submissions=0,payload;
  const steam={ok:true,t_en:'Steam Title',t_zh:'Steam 游戏',t_ko:'Steam 게임',d_en:'Steam pitch',d_zh:'Steam 中文简介',d_ko:'Steam 소개',full_en:'Legacy player marketing copy',full_zh:'旧版 Steam 长文',full_ko:'이전 Steam 상세 소개',stage:'Demo',genres:['Adventure'],platforms:['PC'],studio_name:'Steam Studio',cover:'/images/studiologo.png',screenshots:['/images/studiologo.png'],steam_url:'https://store.steampowered.com/app/123/'};
  await page.route('https://fonts.**',route=>route.abort());
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let data={ok:true};
   if(path==='/api/auth/me')data={loggedIn:true,needsRole:false,role:'developer',status:'verified',email:'developer@example.com'};
   else if(path==='/api/profile/me')data={ok:true,profile:{studio_name:'Test Studio'}};
   else if(path==='/api/games-submit/steam-fetch'){parses++;data=steam;}
   else if(path==='/api/games-submit/create'){submissions++;payload=route.request().postDataJSON();data={ok:true,translation_status:'complete'};}
   await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:8811/submit-game.html');
  for(const [language,pattern] of [['en',/Publishers.*Investors/],['zh',/发行商.*投资者/],['ko',/퍼블리셔.*투자자/]]){
   await page.locator(`#lang [data-l="${language}"]`).click();
   assert.match(await page.locator('#g3').textContent(),pattern);
   assert.match(await page.locator('#g3n').textContent(),/500/);assert.equal(await page.locator('#overview-tips li').count(),3);
   assert.equal(await page.locator('#full-en').getAttribute('maxlength'),'500');
  }
  await page.locator('#lang [data-l="zh"]').click();await page.locator('#content-language').selectOption('zh');
  await page.locator('#steam').fill(steam.steam_url);await page.locator('#steambtn').click();
  await page.waitForFunction(()=>document.querySelector('#steammsg').classList.contains('ok'));
  assert.equal(parses,1);assert.equal(await page.locator('#full-en').inputValue(),'');assert.equal(await page.locator('#full-cnt').textContent(),'0');
  assert.equal(await page.locator('#content-language').inputValue(),'zh');assert.equal(await page.locator('#d-en').inputValue(),steam.d_zh);
  assert.equal(await page.locator('#t-en').inputValue(),steam.t_en);assert.equal(await page.locator('#t-ko').inputValue(),steam.t_ko);
  assert.equal(await page.locator('#coverbox img').count(),1);
  await page.locator('#submit').click();assert.match(await page.locator('#msg').textContent(),/自行填写.*项目概览/);assert.equal(submissions,0);
  const overview='一款面向策略玩家的卡牌冒险，核心特点是可改变关卡规则的牌组。\n\n- 已有可玩 Demo，下一步完善关卡内容。\n- 寻找发行伙伴，支持本地化与市场推广。';
  await page.locator('#full-en').fill(overview);await page.locator('#description-preview-toggle').click();
  assert.equal(await page.locator('#description-preview li').count(),2);
  await page.locator('#steambtn').click();await page.waitForFunction(()=>!document.querySelector('#steambtn').disabled);
  assert.equal(parses,2);assert.equal(await page.locator('#full-en').inputValue(),overview);
  assert.equal(await page.locator('#full-cnt').textContent(),String(overview.length));
  await page.setViewportSize({width:375,height:820});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#full-en').fill('字'.repeat(500));assert.equal(await page.locator('#full-cnt').textContent(),'500');
  // The API must also be protected when a programmatic edit bypasses native maxlength.
  await page.evaluate(()=>{const area=document.querySelector('#full-en');area.value='字'.repeat(501);area.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#submit').click();assert.match(await page.locator('#msg').textContent(),/500/);assert.equal(submissions,0);
  await page.locator('#full-en').fill(overview);
  await page.evaluate(()=>{selMarket=['Global'];selNeeds=['Seeking Publisher'];});
  await page.locator('#terms-agree').check();await page.locator('#submit').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  assert.equal(submissions,1);assert.equal(payload.full_source,overview);assert.equal(payload.source_language,'zh');
  for(const language of ['en','zh','ko'])assert.equal('full_'+language in payload,false);
  assert.equal(payload.d_source,steam.d_zh);assert.equal(payload.d_en,steam.d_en);assert.equal(payload.d_ko,steam.d_ko);
  steam.d_en='';steam.d_zh='';steam.d_ko='';
  await page.goto('http://127.0.0.1:8811/submit-game.html');await page.locator('#steam').fill(steam.steam_url);await page.locator('#steambtn').click();
  await page.waitForFunction(()=>!document.querySelector('#steambtn').disabled);
  await page.locator('#full-en').fill(overview);await page.evaluate(()=>{selMarket=['Global'];selNeeds=['Seeking Publisher'];});
  await page.locator('#terms-agree').check();await page.locator('#submit').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  assert.equal(submissions,2);assert.equal(payload.d_source,'');assert.equal(payload.full_source,overview);
  assert.deepEqual(errors,[]);
  console.log('PASS: three-language B2B guidance, manual Steam overview, source-language preservation, retained drafts, preview, mobile layout and 500-character submission limit');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
