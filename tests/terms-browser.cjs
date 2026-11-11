const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.TERMS_BASE_URL||'http://127.0.0.1:8811';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1200,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let role='developer',creates=0,saves=0,payload,createReply={ok:true,translation_status:'complete'};
  await context.route('https://fonts.**',route=>route.abort());
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let data={ok:true};
   if(path==='/api/auth/me')data={loggedIn:true,needsRole:false,role,status:'verified',email:role+'@example.com'};
   else if(path==='/api/profile/me')data={ok:true,role,status:'pending',profile:role==='developer'?{studio_name:'Test Studio'}:{name_en:'Publisher',contact_email:'bd@example.com'}};
   else if(path==='/api/games-submit/create'){creates++;payload=route.request().postDataJSON();data=createReply;}
   else if(path==='/api/profile/save'){saves++;payload=route.request().postDataJSON();}
   await route.fulfill({json:data});
  });
  const noOverflow=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

  // Submit page: short guidelines above the form, consent required right before submitting.
  await page.goto(base+'/submit-game.html');await page.locator('#form').waitFor({state:'visible'});
  for(const [language,audience,agreement] of [['en',/publishers and investors, not players/,'Game Submission Agreement'],['zh',/读者是发行商和投资者/,'游戏提交协议'],['ko',/퍼블리셔와 투자자/,'게임 제출 약관']]){
   await page.locator(`#lang [data-l="${language}"]`).click();
   assert.equal(await page.locator('#guidelines li').count(),3);
   assert.match(await page.locator('#guidelines li').first().textContent(),/B2B/);
   assert.match(await page.locator('#guidelines li').first().textContent(),audience);
   assert.equal(await page.locator('#terms-label a').textContent(),agreement);
   assert.equal(await page.locator('#terms-label a').getAttribute('href'),'/terms.html#developer');
  }
  assert.ok(await page.evaluate(()=>document.querySelector('#guidelines').compareDocumentPosition(document.querySelector('.steambox'))&Node.DOCUMENT_POSITION_FOLLOWING));
  await page.locator('#lang [data-l="zh"]').click();
  await page.locator('#t-en').fill('Consent Game');await page.locator('#full-en').fill('寻找发行合作的解谜冒险游戏。');
  await page.evaluate(()=>{selStage=['Demo'];selGenres=['Puzzle'];selPlatforms=['PC'];selMarket=['Global'];selNeeds=['Seeking Publisher'];coverUrl='/images/studiologo.png';shotUrls=['/images/studiologo.png'];});
  await page.locator('#submit').click();
  assert.match(await page.locator('#msg').textContent(),/同意《游戏提交协议》/);assert.equal(creates,0);
  createReply={ok:false,error:'terms_outdated'};
  await page.locator('#terms-agree').check();await page.locator('#submit').click();
  await page.waitForFunction(()=>/刷新页面/.test(document.querySelector('#msg').textContent));
  assert.equal(creates,1);assert.equal(await page.locator('#terms-agree').isChecked(),true);
  createReply={ok:true,translation_status:'complete'};
  await page.locator('#submit').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  const version=await page.evaluate(()=>SryTerms.version);
  assert.equal(creates,2);assert.equal(payload.terms_version,version.developer);
  assert.equal(await page.locator('#terms-agree').isChecked(),false);
  await page.setViewportSize({width:375,height:820});assert.ok(await noOverflow());await page.setViewportSize({width:1200,height:900});

  // Partner profile: the agreement is accepted when the profile is submitted for review.
  role='partner';await page.goto(base+'/profile.html');await page.locator('#f-par').waitFor({state:'visible'});
  for(const [language,agreement] of [['en','Partner Agreement'],['ko','파트너 약관'],['zh','合作方协议']]){
   await page.locator(`#lang [data-l="${language}"]`).click();
   assert.equal(await page.locator('#par-terms-label a').textContent(),agreement);
   assert.equal(await page.locator('#par-terms-label a').getAttribute('href'),'/terms.html#partner');
  }
  await page.locator('#par-save').click();
  assert.match(await page.locator('#par-msg').textContent(),/同意《合作方协议》/);assert.equal(saves,0);
  await page.locator('#par-terms').check();await page.locator('#par-save').click();
  await page.waitForFunction(()=>document.querySelector('#par-msg').classList.contains('ok'));
  assert.equal(saves,1);assert.equal(payload.terms_version,version.partner);
  // Studio info has no agreement of its own.
  role='developer';await page.goto(base+'/profile.html');await page.locator('#f-dev').waitFor({state:'visible'});
  await page.locator('#dev-email').fill('developer@example.com');await page.locator('#dev-save').click();
  await page.waitForFunction(()=>document.querySelector('#dev-msg').classList.contains('ok'));
  assert.equal(saves,2);assert.equal('terms_version' in payload,false);

  // Agreement page: both documents, three languages, linked tabs and a phone layout.
  await page.goto(base+'/terms.html#developer');
  for(const [language,developer,partner,permission,contact] of [
   ['en','Game Submission Agreement','Partner Agreement',/translate, edit/,/developers with an approved game/],
   ['zh','游戏提交协议','合作方协议',/翻译、编辑/,/开发者查看该邮箱并与你联系/],
   ['ko','게임 제출 약관','파트너 약관',/번역, 편집/,/개발자가 이를 확인하고/]]){
   await page.locator(`#lang [data-l="${language}"]`).click();
   await page.locator('#tabs [data-doc="developer"]').click();
   await page.waitForFunction(title=>document.querySelector('#title').textContent===title,developer);
   assert.equal(await page.locator('#guidelines').isVisible(),true);assert.equal(await page.locator('#guidelines li').count(),3);
   assert.equal(await page.locator('#clauses li').count(),7);
   assert.match(await page.locator('#clauses').textContent(),permission);
   assert.match(await page.locator('#meta').textContent(),new RegExp(version.developer));
   await page.locator('#tabs [data-doc="partner"]').click();
   await page.waitForFunction(title=>document.querySelector('#title').textContent===title,partner);
   assert.equal(await page.locator('#guidelines').isVisible(),false);
   assert.equal(await page.locator('#clauses li').count(),7);
   assert.match(await page.locator('#clauses').textContent(),contact);
  }
  assert.equal(new URL(page.url()).hash,'#partner');
  await page.setViewportSize({width:375,height:820});assert.ok(await noOverflow());
  assert.deepEqual(errors,[]);
  console.log('PASS: three-language submission guidelines, required developer and partner consent with the current version, outdated-version notice, and both agreements on desktop and phone');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
