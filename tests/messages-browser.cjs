const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:8812';
const future=new Date(Date.now()+86400000).toISOString().slice(0,19).replace('T',' '),now=new Date().toISOString().slice(0,19).replace('T',' ');
const cover='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><rect width="460" height="215" fill="#345675"/><rect x="2" y="2" width="456" height="211" fill="none" stroke="white" stroke-width="4"/></svg>');
const games=Array.from({length:37},(_,i)=>({id:i+1,t_en:'Game '+(i+1),t_zh:'游戏 '+(i+1),t_ko:'게임 '+(i+1),d_en:'A game',full_en:'## Features\n\n- Explore',cover,stage:'Demo',genres:['Adventure'],needs:['Seeking Publisher'],platforms:['PC'],region:'Global',screenshots:[],developer:'Studio',has_owner:true}));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let role='partner',canSend=true,sends=0,reads=0,read=false,posted;
  const message={id:12,game_id:1,game_title:'Game 1',game_title_zh:'游戏 1',sender_name:'Publisher <img src=x>',subject:'Offer <script>alert(1)</script>',preview:'Hello <img src=x onerror=alert(1)>',body:'Hello\n<script>alert(1)</script>',sender_email:'sender@example.com',created_at:now,expires_at:future,read_at:null};
  await page.route('**/fonts.*',r=>r.abort());
  await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url()),path=u.pathname;let status=200,data={ok:true};
   if(path==='/api/games')data=games;
   else if(path==='/api/auth/me')data={loggedIn:true,role,status:'verified',email:'test@example.com'};
   else if(path==='/api/profile/me')data={ok:true,role,status:'verified',email:'test@example.com',profile:{studio_name:'Studio',name_en:'Publisher',contact_email:'test@example.com'}};
   else if(path==='/api/games-submit/mine')data={ok:true,rows:[{...games[0],status:'approved'}]};
   else if(path==='/api/contacts/mine')data={ok:true,rows:[],used:role==='partner'?10:0,quota:role==='partner'?10:5};
   else if(path==='/api/contacts/reveal'){status=429;data={ok:false,error:'quota_exceeded',used:10,quota:10};}
   else if(path==='/api/messages/eligible')data={ok:true,can_send:canSend,reason:canSend?null:'quota_not_exhausted',used:canSend?10:9,quota:10,sender_email:'partner@example.com'};
   else if(path==='/api/messages/send'){sends++;posted=route.request().postDataJSON();await new Promise(resolve=>setTimeout(resolve,200));data={ok:true,id:12,expires_at:future};}
   else if(path==='/api/messages/mine')data={ok:true,rows:[{...message,read_at:read?now:null},{...message,id:13,subject:'Expired',expires_at:'2000-01-01 00:00:00'}],unread:read?0:1,next_cursor:null};
   else if(path==='/api/messages/read'){reads++;read=true;data={ok:true,row:{...message,read_at:now}};}
   else if(path==='/api/favorites/ids')data={ok:true,ids:[]};
   else if(path==='/api/favorites/mine')data={ok:true,rows:[]};
   await route.fulfill({status,json:data});
  });
  await page.goto(base+'/index.html');await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length===18);
  const style=await page.locator('.cover img').first().evaluate(img=>({fit:getComputedStyle(img).objectFit,position:getComputedStyle(img).objectPosition,ratio:img.parentElement.clientWidth/img.parentElement.clientHeight}));assert.equal(style.fit,'cover');assert.equal(style.position,'50% 50%');assert.ok(Math.abs(style.ratio-460/215)<.02);
  await page.locator('.cover img').first().hover();assert.equal(await page.locator('.cover img').first().evaluate(img=>getComputedStyle(img).transform),'none');
  await page.locator('[data-pg="3"]').first().click();assert.equal(await page.locator('#grid .card').count(),1);
  await page.setViewportSize({width:375,height:820});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1200,height:900});
  await page.goto(base+'/game.html?id=game-1');await page.locator('.deal-cta a').click();await page.locator('#cm-message').waitFor();
  await page.locator('#cm-message').click();await page.locator('#sry-subject').fill('Publishing offer');await page.locator('#sry-body').fill('Hello developer');
  const send=page.locator('#sry-compose-form button[type="submit"]');await send.click();assert.equal(await send.isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('.sry-msg-status').textContent.includes('Message sent'));assert.equal(sends,1);assert.equal(posted.game_id,1);assert.equal(posted.body,'Hello developer');assert.match(posted.request_key,/^[a-f0-9-]{36}$/);
  await page.locator('.sry-msg-mask [data-close]').click();
  canSend=false;await page.locator('.deal-cta a').click();await page.locator('#cm-message').click();await page.waitForFunction(()=>document.querySelector('.sry-msg-status').textContent.includes('after all 10'));assert.equal(await page.locator('#sry-compose-form').count(),0);assert.equal(sends,1);await page.locator('.sry-msg-mask [data-close]').click();
  role='developer';await page.goto(base+'/account.html');await page.locator('.sry-message-row[data-id="12"]').waitFor();assert.equal(reads,0);assert.equal(await page.locator('.sry-unread-count').textContent(),'1');assert.equal(await page.locator('.sry-message-row[data-id="13"]').count(),0);assert.equal(await page.locator('#developer-inbox img').count(),0);
  await page.locator('.sry-message-row[data-id="12"]').click();await page.locator('.sry-msg-body').waitFor();assert.equal(await page.locator('.sry-msg-body').textContent(),message.body);assert.equal(await page.locator('.sry-msg-body script').count(),0);assert.equal(await page.locator('.sry-unread-count').count(),0);assert.equal(reads,1);
  await page.locator('.sry-msg-mask [data-close]').click();await page.locator('#lang [data-l="zh"]').click();assert.match(await page.locator('#developer-inbox h2').textContent(),/留言箱/);
  await page.locator('#lang [data-l="ko"]').click();assert.match(await page.locator('#developer-inbox h2').textContent(),/메시지함/);
  await page.setViewportSize({width:375,height:820});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  role='partner';await page.goto(base+'/account.html');await page.locator('#main').waitFor({state:'visible'});assert.equal(await page.locator('#developer-inbox').isVisible(),false);assert.match(await page.locator('#contacts-quota').textContent(),/10\/10/);
  assert.deepEqual(errors,[]);console.log('PASS: 18-card pagination, centered filled covers, quota-gated composer, sending feedback, private safe inbox, unread updates and mobile/three-language integration');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
