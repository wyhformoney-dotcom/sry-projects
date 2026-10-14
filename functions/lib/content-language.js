const locales = ['en', 'zh', 'ko'];

// Detect clear EN/ZH/KO mismatches while allowing official names and shared terms.
// This is a script check, not a general-purpose language identification service.
export function matchesContentLanguage(value, locale, names = []) {
  let text=String(value || '').trim();
  if (!text) return false;
  for (const name of [...names].filter(Boolean).sort((a,b)=>b.length-a.length)) text=text.split(name).join('');
  text=text.replace(/https?:\/\/\S+/g,'').replace(/\b(?:PC|RPG|MMORPG|MMO|VR|AR|AI|PvP|PvE|Steam|Poki|Unity|Unreal Engine|3D|2D)\b/gi,'');
  const han=(text.match(/\p{Script=Han}/gu)||[]).length;
  const hangul=(text.match(/\p{Script=Hangul}/gu)||[]).length;
  const latin=(text.match(/\p{Script=Latin}/gu)||[]).length;
  const other=(text.replace(/[\p{Script=Han}\p{Script=Hangul}\p{Script=Latin}]/gu,'').match(/\p{Letter}/gu)||[]).length;
  if (!han && !hangul && !latin) return other===0;
  if (other>Math.max(3,(han+hangul+latin)*.15)) return false;
  if (locale==='en') return latin>0 && han<=Math.max(3,latin*.15) && hangul<=Math.max(3,latin*.15);
  if (locale==='zh') return han>0 && hangul<=Math.max(3,han*.3) && !(latin>han*6 && (text.match(/[a-z]+/gi)||[]).length>=10);
  if (locale==='ko') return hangul>0 && han<=Math.max(3,hangul*.3) && !(latin>hangul*6 && (text.match(/[a-z]+/gi)||[]).length>=10);
  return false;
}

export const gameNames = game => ['t_en','t_zh','t_ko','developer'].map(key=>String(game[key] || '')).filter(Boolean);

export function translationTargets(content) {
  const names=gameNames(content),keys=[];
  for (const base of ['t','d','full','studio']) {
    const hasSource=locales.some(locale=>String(content[`${base}_${locale}`] || '').trim());
    const derivePitch=base==='d' && locales.some(locale=>String(content[`full_${locale}`] || '').trim());
    if (base!=='t' && !hasSource && !derivePitch) continue;
    for (const locale of locales) {
      const key=`${base}_${locale}`,value=String(content[key] || '').trim();
      if (!value || (base!=='t' && !matchesContentLanguage(value,locale,names))) keys.push(key);
    }
  }
  return keys;
}

export function localizedSteamText(value, locale, names = []) {
  return matchesContentLanguage(value,locale,names)?value:'';
}
