(function(){
  'use strict';
  const words={
    en:{compose:'Leave a message',subject:'Subject',body:'Message',send:'Send message',sending:'Sending…',close:'Close',loading:'Loading…',retry:'Refresh',more:'Load more',inbox:'Message Inbox',retention:'Messages remain available for 30 days.',empty:'No messages yet. Publishers and investors can leave a message after using all 10 monthly contact unlocks.',hint:'This message goes to the developer’s inbox and is retained for 30 days. They will see your company name and contact email. One message per developer every 24 hours; up to 20 per day.',sent:'Message sent. The developer can read it in their account inbox.',email:'Contact email',game:'Game',from:'From',expires:'Available until',unread:'Unread',network:'Unable to load. Please try again.',errors:{quota_not_exhausted:'Messaging opens after all 10 monthly contact unlocks are used.',developer_unavailable:'This project has no available developer inbox. Please contact SRY.',verified_partner_only:'Only verified publishers and investors can send messages.',message_rate_limit:'You can send one message to each developer every 24 hours, and up to 20 per day. Please try later.',invalid_message:'Please enter a subject (up to 120 characters) and message (up to 2,000 characters).',message_not_found:'This message has expired or is no longer available.',account_suspended:'This account is suspended.',not_logged_in:'Please sign in again.',request_key_conflict:'The message changed. Close this window and try again.'}},
    zh:{compose:'给开发者留言',subject:'主题',body:'留言内容',send:'发送留言',sending:'发送中…',close:'关闭',loading:'正在加载…',retry:'刷新',more:'加载更多',inbox:'留言箱',retention:'留言自发送日起保留 30 天。',empty:'暂无留言。发行商和投资者用完每月 10 条查看额度后，可给你留言。',hint:'留言会进入开发者的留言箱，保留 30 天。对方可看到你的公司名称和联系邮箱。同一开发者每 24 小时可留 1 条，每天最多发送 20 条。',sent:'留言已发送，开发者可在账号中心的留言箱查看。',email:'联系邮箱',game:'相关游戏',from:'发送方',expires:'保留至',unread:'未读',network:'暂时无法加载，请重试。',errors:{quota_not_exhausted:'当月 10 条查看额度用完后，才可发送站内留言。',developer_unavailable:'该项目尚无可用的开发者留言箱，请联系 SRY。',verified_partner_only:'仅已认证的发行商和投资者可以发送留言。',message_rate_limit:'同一开发者每 24 小时可留 1 条，每天最多发送 20 条，请稍后再试。',invalid_message:'请填写主题（最多 120 字）和留言（最多 2,000 字）。',message_not_found:'留言已过期或无法查看。',account_suspended:'账号已停用。',not_logged_in:'请重新登录。',request_key_conflict:'留言内容已变更，请关闭窗口后重试。'}},
    ko:{compose:'개발자에게 메시지 남기기',subject:'제목',body:'메시지',send:'메시지 보내기',sending:'전송 중…',close:'닫기',loading:'불러오는 중…',retry:'새로고침',more:'더 보기',inbox:'메시지함',retention:'메시지는 전송일부터 30일간 보관됩니다.',empty:'아직 메시지가 없습니다. 퍼블리셔와 투자자는 월 10개 연락처 조회를 모두 사용한 후 메시지를 남길 수 있습니다.',hint:'메시지는 개발자 메시지함에 30일간 보관됩니다. 회사명과 연락 이메일이 표시됩니다. 개발자별 24시간에 1개, 하루 최대 20개를 보낼 수 있습니다.',sent:'메시지를 보냈습니다. 개발자는 계정의 메시지함에서 확인할 수 있습니다.',email:'연락 이메일',game:'관련 게임',from:'보낸 사람',expires:'보관 기한',unread:'읽지 않음',network:'불러올 수 없습니다. 다시 시도해 주세요.',errors:{quota_not_exhausted:'월 10개 연락처 조회를 모두 사용한 후 메시지를 보낼 수 있습니다.',developer_unavailable:'이 프로젝트에는 이용 가능한 개발자 메시지함이 없습니다. SRY에 문의해 주세요.',verified_partner_only:'인증된 퍼블리셔와 투자자만 메시지를 보낼 수 있습니다.',message_rate_limit:'개발자별 24시간에 1개, 하루 최대 20개를 보낼 수 있습니다. 나중에 다시 시도해 주세요.',invalid_message:'제목(120자 이내)과 메시지(2,000자 이내)를 입력하세요.',message_not_found:'메시지가 만료되었거나 이용할 수 없습니다.',account_suspended:'정지된 계정입니다.',not_logged_in:'다시 로그인해 주세요.',request_key_conflict:'메시지가 변경되었습니다. 창을 닫고 다시 시도해 주세요.'}}
  };
  const language=()=>document.body.getAttribute('lang')||localStorage.getItem('sry_lang')||'en';
  const t=()=>words[language()]||words.en;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const localized=(row,key)=>row[key+'_'+language()]||row[key]||'';
  const date=value=>new Date(value.replace(' ','T')+'Z');
  const format=value=>date(value).toLocaleString({en:'en-US',zh:'zh-CN',ko:'ko-KR'}[language()]||'en-US');
  const errorText=error=>t().errors[error.message]||t().network;
  async function api(path,body){
    const response=await fetch('/api/messages/'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'network');return data;
  }
  let modal=null,returnFocus=null,busy=false;
  function close(){if(busy)return;if(modal){modal.remove();modal=null;}returnFocus?.focus();}
  function dialog(title){
    close();returnFocus=document.activeElement;
    modal=document.createElement('div');modal.className='sry-msg-mask';
    modal.innerHTML=`<section class="sry-msg-dialog" role="dialog" aria-modal="true" aria-labelledby="sry-dialog-title" tabindex="-1"><h2 id="sry-dialog-title"></h2><div id="sry-dialog-content"></div><div class="sry-msg-status" role="status"></div><div class="sry-msg-actions"><button type="button" class="sry-msg-button" data-close>${esc(t().close)}</button></div></section>`;
    document.body.append(modal);modal.querySelector('h2').textContent=title;
    modal.querySelector('[data-close]').onclick=close;modal.onclick=e=>{if(e.target===modal)close();};
    modal.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();close();}
      if(e.key==='Tab'){
        const elements=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]')];const first=elements[0],last=elements.at(-1);
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===modal.querySelector('section'))){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };
    modal.querySelector('section').focus();return modal;
  }
  async function compose(game){
    const mask=dialog(t().compose),content=mask.querySelector('#sry-dialog-content'),status=mask.querySelector('[role="status"]');
    content.textContent=t().loading;
    try{
      const permission=await api('eligible?game_id='+game.id);if(modal!==mask)return;
      if(!permission.can_send)throw new Error(permission.reason);
      content.innerHTML=`<p class="sry-msg-hint">${esc(t().hint)}</p><p class="sry-msg-meta">${esc(t().game)}: ${esc(game['t_'+language()]||game.t_en||game.t_zh||game.t_ko)}<br>${esc(t().email)}: ${esc(permission.sender_email)}</p><form id="sry-compose-form"><label for="sry-subject">${esc(t().subject)}</label><input id="sry-subject" maxlength="120" required><label for="sry-body">${esc(t().body)}</label><textarea id="sry-body" maxlength="2000" required></textarea><div class="sry-msg-actions"><button class="sry-msg-button primary" type="submit">${esc(t().send)}</button></div></form>`;
      const form=content.querySelector('form'),subject=form.querySelector('input'),body=form.querySelector('textarea');let key=crypto.randomUUID();
      subject.focus();for(const input of [subject,body])input.oninput=()=>{key=crypto.randomUUID();};
      form.onsubmit=async e=>{
        e.preventDefault();if(busy)return;busy=true;status.textContent='';status.classList.remove('error');
        const button=form.querySelector('button');button.disabled=true;subject.disabled=true;body.disabled=true;button.textContent=t().sending;
        try{await api('send',{game_id:game.id,subject:subject.value,body:body.value,request_key:key});form.remove();status.textContent=t().sent;}
        catch(error){status.textContent=errorText(error);status.classList.add('error');button.disabled=false;subject.disabled=false;body.disabled=false;button.textContent=t().send;}
        finally{busy=false;}
      };
    }catch(error){if(modal===mask){content.textContent='';status.textContent=errorText(error);status.classList.add('error');}}
  }
  let inbox=null,rows=[],unread=0,cursor=null,loaded=false,loading=false,failure=null,opened=null;
  function renderInbox(){
    if(!inbox)return;const W=t();rows=rows.filter(row=>date(row.expires_at)>Date.now());
    inbox.innerHTML=`<div class="sry-inbox-head"><div><h2>${esc(W.inbox)}${unread?`<span class="sry-unread-count" aria-label="${esc(W.unread)}">${unread}</span>`:''}</h2><p>${esc(W.retention)}</p></div><button class="sry-msg-button" data-refresh>${esc(W.retry)}</button></div><div class="sry-inbox-list"></div>`;
    inbox.querySelector('[data-refresh]').onclick=()=>loadInbox(false);
    const list=inbox.querySelector('.sry-inbox-list');
    if(!rows.length){list.innerHTML=`<div class="sry-inbox-empty" role="status">${esc(loading?W.loading:failure||W.empty)}</div>`;}
    else for(const row of rows){
      const button=document.createElement('button');button.type='button';button.className='sry-message-row'+(row.read_at?'':' unread');button.dataset.id=row.id;
      button.innerHTML=`<small>${esc(localized(row,'sender_name'))} · ${esc(format(row.created_at))}${row.read_at?'':' · '+esc(W.unread)}</small><strong>${esc(row.subject)}</strong><small>${esc(W.game)}: ${esc(localized(row,'game_title'))}</small><small>${esc(row.preview)}</small>`;
      button.onclick=()=>readMessage(row.id);list.append(button);
    }
    if(failure&&rows.length){const note=document.createElement('p');note.className='sry-inbox-empty';note.textContent=failure;list.append(note);}
    if(cursor){const more=document.createElement('button');more.type='button';more.className='sry-msg-button sry-inbox-more';more.textContent=loading?W.loading:W.more;more.disabled=loading;more.onclick=()=>loadInbox(true);inbox.append(more);}
  }
  async function loadInbox(append=false){
    if(loading)return;loading=true;failure=null;renderInbox();
    try{const data=await api('mine'+(append?'?before='+cursor:''));rows=append?[...rows,...data.rows]:data.rows;unread=data.unread;cursor=data.next_cursor;}
    catch(error){failure=errorText(error);}finally{loading=false;renderInbox();}
  }
  async function readMessage(id){
    const mask=dialog(t().inbox),content=mask.querySelector('#sry-dialog-content'),status=mask.querySelector('[role="status"]');content.textContent=t().loading;
    try{
      const {row}=await api('read',{id});if(modal!==mask)return;opened=row;
      const listed=rows.find(message=>message.id===id);if(listed&&!listed.read_at){listed.read_at=row.read_at;unread=Math.max(0,unread-1);}renderInbox();
      mask.querySelector('h2').textContent=row.subject;
      content.innerHTML=`<div class="sry-msg-meta">${esc(t().from)}: ${esc(localized(row,'sender_name'))}<br>${esc(t().game)}: ${esc(localized(row,'game_title'))}<br>${esc(t().expires)}: ${esc(format(row.expires_at))}<br>${esc(t().email)}: <a class="sry-sender-email"></a></div><div class="sry-msg-body"></div>`;
      const email=content.querySelector('a');email.textContent=row.sender_email;email.href='mailto:'+encodeURIComponent(row.sender_email);
      content.querySelector('.sry-msg-body').textContent=row.body;
    }catch(error){if(modal===mask){content.textContent='';status.textContent=errorText(error);status.classList.add('error');}}
  }
  function initInbox(selector,role){
    inbox=document.querySelector(selector);if(!inbox)return;inbox.hidden=role!=='developer';if(inbox.hidden)return;
    if(!loaded){loaded=true;loadInbox();}else renderInbox();
  }
  setInterval(()=>{
    if(opened&&date(opened.expires_at)<=Date.now()){opened=null;close();}
    if(rows.some(row=>date(row.expires_at)<=Date.now())){unread=Math.max(0,unread-rows.filter(row=>!row.read_at&&date(row.expires_at)<=Date.now()).length);renderInbox();}
  },60000);
  globalThis.SryMessages={compose,initInbox};
})();
