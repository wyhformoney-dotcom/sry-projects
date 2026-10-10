const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const page=await browser.newPage({viewport:{width:1200,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const name='A "quoted" & developer\'s game';let rows=[1,2].map(id=>({id,t_en:name,t_zh:'测试游戏',full_en:'## A world to explore\n\nDiscover a hand-crafted world.\n\n### What makes it special\n\n- **Exploration** with meaningful choices\n- A story shaped by your decisions\n\n> Every journey tells a different story.\n\n## Development progress\n\nA playable demo is available.',status:'pending',stage:'Demo',genres:['Adventure'],platforms:['PC'],needs:['Seeking Publisher'],screenshots:[],cover:'/images/studiologo.png'}));let deleted=null,submitted=null;
await page.route('**/api/**',async route=>{
 const u=new URL(route.request().url());let data={ok:true};
 if(u.pathname==='/api/auth/me')data={ok:true,loggedIn:true,needsRole:false,role:'developer',status:'verified',email:'test@example.com',isAdmin:true};
 else if(u.pathname==='/api/games')data=rows;
 else if(u.pathname==='/api/admin/games')data={ok:true,rows:rows.map(({full_en,screenshots,...summary})=>summary),counts:{pending:rows.length}};
 else if(u.pathname==='/api/admin/game')data={ok:true,row:rows.find(r=>r.id===Number(u.searchParams.get('id')))};
 else if(u.pathname==='/api/games-submit/create'){submitted=route.request().postDataJSON();data={ok:true,translation_status:'complete'};}
 else if(u.pathname==='/api/admin/partners')data={ok:true,rows:[],counts:{}};
 else if(u.pathname==='/api/admin/game-delete'){deleted=route.request().postDataJSON().id;rows=rows.filter(r=>r.id!==deleted);}
 else if(u.pathname==='/api/profile/me')data={ok:true,profile:{studio_name:'Test Studio'}};
 else if(u.pathname==='/api/favorites/ids')data={ok:true,ids:[]};
 await route.fulfill({json:data});
});
await page.goto('http://127.0.0.1:8811/submit-game.html');
await page.locator('#full-en').fill('## Features\n\nA short intro.\n\n- First feature\n- **Second feature**');
await page.locator('#description-preview-toggle').click();
assert.equal(await page.locator('#description-preview h2').textContent(),'Features');assert.equal(await page.locator('#description-preview li').count(),2);
await page.locator('#content-language').selectOption('zh');await page.locator('#lang button[data-l="ko"]').click();assert.equal(await page.locator('#content-language').inputValue(),'zh');
await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.setViewportSize({width:1200,height:900});
await page.locator('#studio').fill('Test Studio');await page.locator('#t-zh').fill('只有中文名的测试游戏');await page.locator('#d-en').fill('中文简介');
await page.evaluate(()=>{selStage=['Demo'];selGenres=['Adventure'];selPlatforms=['PC'];selMarket=['Global'];selNeeds=['Seeking Publisher'];coverUrl='https://example.com/a.png';shotUrls=['https://example.com/b.png'];});
await page.locator('#submit').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
assert.equal(submitted.source_language,'zh');assert.equal(submitted.t_en,'');assert.equal(submitted.t_zh,'只有中文名的测试游戏');assert.equal(submitted.d_source,'中文简介');
await page.goto('http://127.0.0.1:8811/game.html?id=a-quoted-developers-game');
// Use the same slug computation the app uses, including punctuation.
await page.evaluate((name)=>{GAME={...GAME,...{t_en:name,full_en:'## Features\n\nA short intro.\n\n- First\n- **Second**',screenshots:[],cover:'/images/studiologo.png'}};media=buildMedia(GAME);render();},name);
assert.equal(await page.locator('.overview li').count(),2);
await page.locator('.overview').screenshot({path:'/tmp/sry-description-preview.png'});
await page.goto('http://127.0.0.1:8811/admin.html');await page.locator('[data-m="games"]').click();
await page.locator('.row[data-id="1"] .rhead').click();
const button=page.locator('.row[data-id="1"] button').filter({hasText:'删除这款游戏'});
assert.equal(await button.getAttribute('data-name'),name);
page.once('dialog',async d=>{assert.ok(d.message().includes(name));await d.accept();});
await button.click();await page.waitForFunction(()=>!document.querySelector('.row[data-id="1"]'));
assert.equal(deleted,1);assert.equal(await page.locator('.row[data-id="2"]').count(),1);assert.deepEqual(errors,[]);
console.log('PASS: editor preview, mobile width, source-language selection, description rendering, quoted-title deletion and remaining duplicate');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
