// Cloudflare Pages Function —— 路由 /api/games
// 作用：用环境变量里的飞书密钥安全地读取多维表格，转换成页面需要的 JSON。
// 密钥只存在 Cloudflare 环境变量里，永远不会出现在前端代码中。

const GENRE={"动作":"Action","冒险":"Adventure","角色扮演":"RPG","策略":"Strategy","模拟":"Simulation","解谜":"Puzzle","平台":"Platformer","射击":"Shooter","生存":"Survival","恐怖":"Horror","Roguelite":"Roguelite","银河恶魔城":"Metroidvania","类魂":"Souls-like","视觉小说":"Visual Novel","卡牌":"Card Game","开放世界":"Open World","叙事":"Narrative","喜剧":"Comedy","合作":"Co-op","多人":"Multiplayer"};
const NEED={"寻找发行":"Seeking Publisher","寻找联合发行":"Seeking Publisher Partner","寻找投资":"Seeking Investment"};
const PLATFORM={"PC":"PC","主机":"Console","移动端":"Mobile"};
const REGION={"全球":"Global","中国":"China","海外":"Overseas"};
const STAGE={"开发中":"In Development","Demo":"Demo","Playtest":"Playtest","EA":"Early Access","发布":"Released"};

function txt(v){
  if(v==null) return "";
  if(typeof v==="string") return v;
  if(typeof v==="number") return String(v);
  if(Array.isArray(v)) return v.map(x=> typeof x==="string"? x : (x&&(x.text||x.name))||"").join("");
  if(typeof v==="object") return v.text||v.name||v.link||v.value||"";
  return String(v);
}
function arr(v){
  if(v==null) return [];
  if(Array.isArray(v)) return v.map(x=> typeof x==="string"? x : (x&&(x.text||x.name))||"").filter(Boolean);
  if(typeof v==="string") return v? [v] : [];
  return [];
}
function num(v){ const n=typeof v==="number"? v : parseFloat(txt(v)); return isNaN(n)? 999 : n; }
const mp=(d)=>(x)=> d[x]||x;

function mapRecord(f){
  const g=(n)=>txt(f[n]);
  return {
    t_en:g("游戏名_EN"), t_zh:g("游戏名_中文"), t_ko:g("游戏名_韩文"),
    d_en:g("简介_EN"), d_zh:g("简介_中文"), d_ko:g("简介_韩文"),
    stage: STAGE[txt(f["进展"])] || txt(f["进展"]) || "Demo",
    genres: arr(f["类型"]).map(mp(GENRE)),
    needs: arr(f["需求"]).map(mp(NEED)),
    platforms: arr(f["平台"]).map(mp(PLATFORM)),
    region: REGION[txt(f["目标市场"])] || txt(f["目标市场"]),
    cover: g("封面链接"),
    order: num(f["排序"]),
    visible: txt(f["是否上架"]) !== "否",
    full_en:g("完整简介_EN"), full_zh:g("完整简介_中文"), full_ko:g("完整简介_韩文"),
    developer:g("开发商"), studioLogo:g("工作室Logo"),
    studio_en:g("工作室简介_EN"), studio_zh:g("工作室简介_中文"), studio_ko:g("工作室简介_韩文"),
    video:g("预告片链接"),
    screenshots: g("截图链接").split(/\r?\n/).map(s=>s.trim()).filter(Boolean),
    contact:g("联系链接"),
  };
}

export async function onRequestGet(context){
  const env=context.env||{};
  const {FEISHU_APP_ID,FEISHU_APP_SECRET,FEISHU_APP_TOKEN,FEISHU_TABLE_ID}=env;
  const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"}});
  if(!FEISHU_APP_ID||!FEISHU_APP_SECRET||!FEISHU_APP_TOKEN||!FEISHU_TABLE_ID)
    return J({error:"missing_env",hint:"请在 Pages 项目里配置 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_APP_TOKEN / FEISHU_TABLE_ID"},500);
  try{
    const tr=await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({app_id:FEISHU_APP_ID,app_secret:FEISHU_APP_SECRET})
    });
    const td=await tr.json();
    if(!td.tenant_access_token) return J({error:"token_failed",detail:td},500);
    const token=td.tenant_access_token;

    let items=[],pageToken="";
    do{
      let url=`https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records?page_size=100`;
      if(pageToken) url+=`&page_token=${encodeURIComponent(pageToken)}`;
      const rr=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
      const rd=await rr.json();
      if(rd.code!==0) return J({error:"records_failed",detail:rd},500);
      items=items.concat((rd.data&&rd.data.items)||[]);
      pageToken=(rd.data&&rd.data.has_more)? rd.data.page_token : "";
    }while(pageToken);

    const games=items.map(it=>mapRecord(it.fields||{})).filter(g=>g.visible && (g.t_en||g.t_zh));
    games.sort((a,b)=>a.order-b.order);
    return new Response(JSON.stringify(games),{
      headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=300, s-maxage=300","Access-Control-Allow-Origin":"*"}
    });
  }catch(e){
    return J({error:"exception",detail:String((e&&e.message)||e)},500);
  }
}
