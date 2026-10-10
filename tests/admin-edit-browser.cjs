const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:8811';
const original={id:1,slug:'original-abcdef',feishu_id:'legacy-record',status:'approved',visible:1,featured:1,t_en:'Original',t_zh:'原名',t_ko:'원래 이름',d_en:'Original pitch',full_en:'Original overview',full_zh:'原概览',full_ko:'원래 개요',developer:'Official Steam Studio',studio_logo:'preset:team',studio_en:'Original studio introduction',studio_zh:'原团队介绍',studio_ko:'원래 소개',cover:'https://example.com/original.png',screenshots:['https://example.com/shot.png'],stage:'Demo',region:'Global',genres:['Adventure','Legacy Genre'],platforms:['PC'],needs:['Seeking Publisher'],steam_url:'https://store.steampowered.com/app/123/',video:'',login_email:'owner@example.com',dev_contact:'owner@example.com',studio_name:'Account Studio'};

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let game={...original},updates=0,creates=0,lastUpdate,failNext=false,conflictNext=false;
  await page.route('https://fonts.**',route=>route.abort());
  await page.route('https://example.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><rect width="460" height="215" fill="#345675"/></svg>'}));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname;let status=200,data={ok:true};
   if(path==='/api/admin/partners')data={ok:true,rows:[],counts:{}};
   else if(path==='/api/admin/games')data={ok:true,rows:['approved','all'].includes(url.searchParams.get('status'))?[{id:game.id,t_en:game.t_en,t_zh:game.t_zh,status:game.status,visible:game.visible,stage:game.stage,featured:game.featured,cover:game.cover,feishu_id:game.feishu_id}]:[],counts:{approved:1,pending:0}};
   else if(path==='/api/admin/game')data={ok:true,row:game};
   else if(path==='/api/admin/game-update'){
    updates++;lastUpdate=route.request().postDataJSON();
    await new Promise(resolve=>setTimeout(resolve,150));
    if(conflictNext){conflictNext=false;status=409;data={ok:false,error:'edit_conflict'};}
    else if(failNext){failNext=false;status=500;data={ok:false,error:'temporary'};}
    else{game={...game,...lastUpdate.changes};data={ok:true,id:game.id,updated:lastUpdate.changes};}
   }else if(path==='/api/admin/game-create'){creates++;data={ok:true,id:4,ownerCreated:false};}
   else if(path==='/api/games')data=[game];
   else if(path==='/api/auth/me')data={loggedIn:true,role:'developer',status:'verified',isAdmin:true,email:'admin@example.com'};
   await route.fulfill({status,json:data});
  });
  await page.goto(base+'/admin.html');await page.locator('[data-m="games"]').click();await page.locator('[data-s="verified"]').click();
  assert.match(await page.locator('#tab-verified').textContent(),/已上架/);
  const openEditor=async()=>{
   await page.locator('.row[data-id="1"] .rhead').click();
   await page.getByRole('button',{name:'编辑游戏资料',exact:true}).click();
   await page.locator('#ngmask').waitFor({state:'visible'});
  };
  await openEditor();
  assert.equal(await page.locator('#ng-title').textContent(),'编辑游戏资料');
  assert.equal(await page.locator('#ng-dev').inputValue(),original.developer);
  assert.equal(await page.locator('#ng-logo').inputValue(),original.studio_logo);
  assert.equal(await page.locator('#ng-szh').inputValue(),original.studio_zh);
  assert.equal(await page.locator('#ng-contact-field').isVisible(),false);
  assert.ok(await page.locator('#ng-lead').textContent().then(text=>text.includes('已上架')));
  await page.locator('#ng-ten').fill('Canceled title');await page.locator('#ng-cancel').click();
  assert.equal(updates,0);assert.equal(game.t_en,'Original');
  // The row is already expanded after canceling.
  await page.getByRole('button',{name:'编辑游戏资料',exact:true}).click();
  await page.locator('#ng-ten').fill('Renamed');
  await page.locator('#ng-fen').fill('A concise publisher brief.\n\n- **Distinctive feature**\n- Another concrete feature');
  await page.locator('#ng-fzh').fill('简短商务介绍。\n\n- 第一个卖点\n- 第二个卖点');
  await page.locator('#ng-dev').fill('Official Revised Studio');await page.locator('#ng-sen').fill('Revised team introduction');
  await page.locator('#ng-stage').selectOption('Playtest');await page.locator('#ng-cover').fill('https://example.com/new-cover.png');
  await page.locator('#ng-shots').fill('https://example.com/new-shot.png\nhttps://example.com/second-shot.png');
  await page.locator('#ng-genres button').filter({hasText:'动作'}).click();
  await page.locator('#ng-preview summary').click();await page.locator('#ng-preview-language').selectOption('zh');
  assert.equal(await page.locator('#ng-description-preview li').count(),2);
  await page.setViewportSize({width:375,height:820});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const save=page.locator('#ng-submit');await save.click();assert.equal(await save.isDisabled(),true);assert.equal(await page.locator('#ng-cancel').isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('#ng-msg').textContent.includes('游戏资料已保存'));
  await page.waitForFunction(()=>!document.querySelector('#ng-submit').disabled);
  assert.equal(updates,1);assert.equal(creates,0);
  assert.deepEqual(Object.keys(lastUpdate.changes).sort(),['cover','developer','full_en','full_zh','genres','screenshots','stage','studio_en','t_en'].sort());
  assert.equal(lastUpdate.expected.developer,original.developer);assert.equal(lastUpdate.expected.full_en,original.full_en);
  assert.equal('claimed_by' in lastUpdate.changes,false);assert.equal('status' in lastUpdate.changes,false);
  assert.ok(game.genres.includes('Legacy Genre'));assert.equal(game.status,'approved');assert.equal(game.visible,1);
  await save.click();assert.equal(updates,1);assert.match(await page.locator('#ng-msg').textContent(),/没有需要保存/);
  await page.locator('#ng-cancel').click();assert.match(await page.locator('.row[data-id="1"] .rname').textContent(),/Renamed/);

  await openEditor();conflictNext=true;await page.locator('#ng-fen').fill('Keep this unsaved draft');await save.click();
  await page.waitForFunction(()=>document.querySelector('#ng-msg').textContent.includes('草稿仍保留'));
  assert.equal(await page.locator('#ng-fen').inputValue(),'Keep this unsaved draft');assert.equal(await save.isDisabled(),false);
  assert.notEqual(game.full_en,'Keep this unsaved draft');
  failNext=true;await save.click();await page.waitForFunction(()=>document.querySelector('#ng-msg').textContent.includes('保存失败'));
  assert.equal(await page.locator('#ng-fen').inputValue(),'Keep this unsaved draft');
  await page.locator('#ng-cancel').click();
  await page.locator('#fzh-1').fill('更新后的中文概览。');
  await page.getByRole('button',{name:'保存三语内容',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#load-status').textContent.includes('三语内容已保存'));
  assert.deepEqual(lastUpdate.changes,{full_zh:'更新后的中文概览。'});
  assert.equal(lastUpdate.expected.full_zh,'简短商务介绍。\n\n- 第一个卖点\n- 第二个卖点');
  await page.locator('.row[data-id="1"] .rhead').click();
  await page.getByRole('link',{name:'查看线上游戏 ↗'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'查看线上游戏 ↗'}).getAttribute('href'),'/game.html?id=1');
  await page.locator('#fzh-1').fill('带入完整编辑器的三语草稿');
  await page.getByRole('button',{name:'编辑游戏资料',exact:true}).click();
  await page.locator('#ngmask').waitFor({state:'visible'});
  assert.equal(await page.locator('#ng-fzh').inputValue(),'带入完整编辑器的三语草稿');
  await page.locator('#ng-cancel').click();
  assert.equal(game.full_zh,'更新后的中文概览。');
  for(const id of ['1','original-abcdef','original']){
   await page.goto(base+'/game.html?id='+id);await page.locator('.ptitle').waitFor();
   assert.equal(await page.locator('.ptitle').textContent(),'Renamed');assert.equal(await page.locator('.overview li').count(),2);
   assert.match(await page.locator('.deal-v').first().textContent(),/Official Revised Studio/);
  }
  await page.goto(base+'/index.html');await page.locator('.card').first().waitFor();
  assert.equal(await page.locator('.card').first().getAttribute('href'),'game.html?id=original-abcdef');
  // Creating a new game resets the shared editor instead of reusing the edited game's data.
  await page.goto(base+'/admin.html');await page.locator('[data-m="games"]').click();await page.locator('#newgamebtn').click();
  assert.equal(await page.locator('#ng-title').textContent(),'新增游戏');assert.equal(await page.locator('#ng-ten').inputValue(),'');
  assert.equal(await page.locator('#ng-dev').inputValue(),'');assert.equal(await page.locator('#ng-contact-field').isVisible(),true);
  assert.equal(await page.locator('#ng-studios').isVisible(),false);assert.equal(await page.locator('#ng-stage').inputValue(),'In Development');
  await page.locator('#ng-ten').fill('New game');await save.click();await page.waitForFunction(()=>document.querySelector('#load-status').textContent.includes('游戏已创建'));
  assert.equal(creates,1);assert.deepEqual(errors,[]);
  console.log('PASS: published and legacy game editing, cancel, three-language Markdown preview, mobile editor, changed-field saves, draft preservation on errors, stable links and new-game reset');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
