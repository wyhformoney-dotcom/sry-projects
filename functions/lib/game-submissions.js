export function normalizedGameNames(game) {
  return ['t_en','t_zh','t_ko'].map(key=>String(game[key]||'').normalize('NFKC').toLocaleLowerCase('und').replace(/[\p{P}\p{S}\s]+/gu,'')).filter(Boolean);
}
export function steamAppId(value) {
  try {const url=new URL(value);return url.hostname==='store.steampowered.com'?url.pathname.match(/^\/app\/(\d+)(?:\/|$)/)?.[1]||'':'';}catch{return '';}
}
export function sameGame(a,b) {
  const app=steamAppId(a.steam_url);
  return !!(app && app===steamAppId(b.steam_url)) || normalizedGameNames(a).some(name=>normalizedGameNames(b).includes(name));
}
export async function duplicateSubmissions(DB,owner,game) {
  if(!normalizedGameNames(game).length&&!steamAppId(game.steam_url))return [];
  const {results}=await DB.prepare("SELECT id,t_en,t_zh,t_ko,status,steam_url,created_at FROM games WHERE claimed_by=? ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,id DESC").bind(owner).all();
  return (results||[]).filter(row=>sameGame(game,row));
}
export async function canonicalMergeTarget(DB,id) {
  return (await canonicalMergeTargets(DB,[id])).get(id)||null;
}
export async function canonicalMergeTargets(DB,ids) {
  if(!ids.length)return new Map();
  const {results}=await DB.prepare(`WITH RECURSIVE chain(source_id,id,merged_into,path,depth) AS (
    SELECT id,id,merged_into,','||id||',',0 FROM games WHERE id IN (${ids.map(()=>'?').join(',')})
    UNION ALL SELECT c.source_id,g.id,g.merged_into,c.path||g.id||',',c.depth+1
    FROM chain c JOIN games g ON g.id=c.merged_into
    WHERE c.depth<100 AND instr(c.path,','||g.id||',')=0
  ) SELECT c.source_id,g.id,g.slug,g.t_en,g.t_zh,g.t_ko,g.status,g.visible FROM chain c JOIN games g ON g.id=c.id
    WHERE c.merged_into IS NULL AND c.depth>0 AND g.status!='merged'`).bind(...ids).all();
  return new Map((results||[]).map(({source_id,...target})=>[source_id,target]));
}
