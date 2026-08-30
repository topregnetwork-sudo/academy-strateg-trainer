/* FUNNEL-CONSOLE-032: additive operator controls; existing chat renderer is preserved. */
(() => {
  const chosen = new Set();
  let state=null, draft=null;
  const el=id=>document.getElementById(id);
  const html=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const call=(body,query='')=>api(body?'POST':'GET',body,'/api/funnel'+query);
  const host=document.createElement('details');host.className='funnel-console';host.id='funnelConsole';
  host.innerHTML=`<summary>Управление воронкой · <span id="fcCount">выбрано 0</span></summary>
  <p>Выберите людей галочками в списке. Статусы и отправки изменяются только после проверки состава и нажатия «Отправить».</p>
  <div class="fc-toolbar"><button id="fcSelect">Выбрать видимых</button><button id="fcClear">Снять выбор</button><button id="fcLoad">Обновить настройки и журнал</button></div>
  <p id="fcError" role="status"></p>
  <div class="fc-columns"><section><h3>Действие и сообщение</h3>
  <label>Шаблон / версия<select id="fcTemplate"><option>Загрузка…</option></select></label>
  <label>Действие<select id="fcAction"></select></label>
  <label>Встреча (для приглашения)<select id="fcSession"><option value="">Выберите встречу</option></select></label>
  <label>Сообщение<textarea id="fcText" rows="9"></textarea></label>
  <small>Подстановки: {name}, {city}, {date}, {location}. Текст обычный, без HTML. Для приглашений автоматически добавляются Цели, PDF и свободные слоты.</small>
  <div id="fcButtons"></div><button id="fcAddButton">Добавить кнопку</button>
  <label>Название шаблона<input id="fcName" placeholder="Сохранить как новую версию"></label>
  <div class="fc-toolbar"><button id="fcSaveTemplate">Сохранить версию</button><button id="fcTest">Отправить тест мне (@HRAcademyStrateg)</button><button id="fcPreview">Проверить получателей</button></div>
  <div id="fcPreviewBox" hidden></div></section>
  <section><h3>Новая проверка продуктивности</h3><p>Существующие записи 1 сентября не меняются. Здесь создаются отдельные встречи. Время — Минск / Москва (UTC+3).</p>
  <label>Название<input id="fsName" value="Проверка продуктивности"></label>
  <div class="fc-pair"><label>Город<input id="fsCity" placeholder="Минск"></label><label>Формат<select id="fsFormat"><option value="offline">Офлайн</option><option value="online">Онлайн</option></select></label></div>
  <label>Дата<input id="fsDate" type="date"></label>
  <div class="fc-pair"><label>С<input id="fsStart" type="time" value="11:00"></label><label>По<input id="fsEnd" type="time" value="13:30"></label></div>
  <div class="fc-pair"><label>Интервал, минут<input id="fsInterval" type="number" min="5" max="240" value="15"></label><label>Мест на слот<input id="fsCapacity" type="number" min="1" max="50" value="1"></label></div>
  <label>Адрес / ссылка на онлайн-встречу<input id="fsLocation"></label>
  <div class="fc-pair"><label>Закрыть запись за, минут<input id="fsCutoff" type="number" min="0" value="60"></label><label>Напомнить за, минут<input id="fsReminder" type="number" min="0" value="30"></label></div>
  <label>Подтверждение записи<textarea id="fsConfirmation" rows="4">Вы записаны на встречу Академии Стратег.
Дата: {date}
Время: {time} МСК
{location}</textarea></label>
  <p>Брифы и сводки: тема «Координация». Тексты уже отправленных приглашений не переписываются.</p>
  <button id="fsSave">Создать встречу</button><div id="fcSessions"></div></section></div>
  <h3>Журнал действий</h3><p>«Требует внимания» означает, что результат нельзя безопасно повторить вслепую. Доставленные сообщения повторно не отправляются.</p><div id="fcJobs"></div><div id="fcJobDetails"></div><div id="fcTasks"></div>
  <h3>Участники встречи</h3><div id="fcBookings"></div>`;
  document.querySelector('#panel nav').insertAdjacentElement('afterend',host);
  const styles=document.createElement('style');styles.textContent=`
  .funnel-console{background:#fff;border:1px solid #ccd8e2;border-radius:14px;padding:16px;margin:16px 0;color:#14253d}.funnel-console summary{font-weight:700;cursor:pointer;font-size:18px}.funnel-console .fc-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}.funnel-console label{display:block;font-size:14px;margin:10px 0}.funnel-console input,.funnel-console select,.funnel-console textarea{display:block;width:100%;min-width:0;box-sizing:border-box;padding:10px;border:1px solid #c7d4e0;border-radius:8px;font:inherit;background:white;color:#14253d}.funnel-console textarea{resize:vertical}.fc-toolbar,.fc-pair{display:flex;gap:8px;flex-wrap:wrap}.fc-pair>label{flex:1;min-width:120px}.funnel-console button{padding:10px 12px;border:1px solid #c7d4e0;border-radius:8px;cursor:pointer}.funnel-console button:disabled{opacity:.5;cursor:wait}.funnel-console .fc-card{border:1px solid #d9e2ec;border-radius:8px;padding:10px;margin:10px 0;overflow-wrap:anywhere}.fc-check-row{display:flex;align-items:flex-start}.fc-check-row>.row{flex:1;min-width:0}.fc-check-row>label{padding:14px 6px;cursor:pointer}.fc-check-row input{width:18px;height:18px}.funnel-console pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f8fa;padding:10px}.funnel-console #fcError{color:#9a3412}.fc-button-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}.fc-button-row button{justify-self:start}@media(max-width:760px){.funnel-console .fc-columns{grid-template-columns:1fr}.funnel-console{padding:12px}.fc-toolbar button{flex:1}.fc-button-row{grid-template-columns:1fr}}`;
  document.head.appendChild(styles);
  const statusAdd=[['productivity_invited','Приглашён: продуктивность'],['productivity_booked','Записан: продуктивность'],['finalist','Финал отбора'],['selection_closed','Отбор завершён — ожидаем ответ']];
  for(const [v,l] of statusAdd){if(!statuses.some(s=>s[0]===v)){statuses.push([v,l]);$('filter').add(new Option(l,v));}}
  const originalList=renderList;
  renderList=function(){originalList();document.querySelectorAll('#candidates .row').forEach(row=>{
    const id=Number(row.dataset.id),wrapper=document.createElement('div');wrapper.className='fc-check-row';
    row.before(wrapper);const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=chosen.has(id);check.setAttribute('aria-label','Выбрать '+row.querySelector('strong').textContent);label.append(check);wrapper.append(label,row);
    check.onchange=()=>{if(check.checked)chosen.add(id);else chosen.delete(id);invalidate();updateCount();};
  });updateCount();};
  function updateCount(){el('fcCount').textContent='выбрано '+chosen.size;}
  function invalidate(){draft=null;el('fcPreviewBox').hidden=true;}
  function fail(e){el('fcError').textContent=e.message||String(e);}
  async function busy(button,fn){button.disabled=true;el('fcError').textContent='';try{await fn();}catch(e){fail(e);}finally{button.disabled=false;}}
  function addButton(b={text:'',url:''}){
    const row=document.createElement('div');row.className='fc-button-row';row.innerHTML=`<input class="fb-text" placeholder="Название кнопки" value="${html(b.text)}"><select class="fb-kind"><option value="url">Ссылка HTTPS</option><option value="yes">Ответ Да</option><option value="no">Ответ Нет</option><option value="thanks">Ответ Спасибо</option></select><input class="fb-url" placeholder="https://…" value="${html(b.url||'')}"><button type="button">Убрать кнопку</button>`;
    row.querySelector('.fb-kind').value=b.choice||'url';row.querySelector('.fb-url').hidden=Boolean(b.choice);row.querySelector('.fb-kind').onchange=e=>{row.querySelector('.fb-url').hidden=e.target.value!=='url';invalidate();};row.querySelector('button').onclick=()=>{row.remove();invalidate();};el('fcButtons').append(row);
  }
  function config(){return {action:el('fcAction').value,text:el('fcText').value,sessionId:el('fcSession').value||null,buttons:[...el('fcButtons').children].map(row=>{const kind=row.querySelector('.fb-kind').value;return {text:row.querySelector('.fb-text').value,...(kind==='url'?{url:row.querySelector('.fb-url').value}:{choice:kind})};})};}
  function applyTemplate(t){const c=t.config||t;el('fcAction').value=c.action;el('fcText').value=c.text;el('fcName').value=t.name;el('fcButtons').innerHTML='';(c.buttons||[]).forEach(addButton);invalidate();}
  async function refresh(){
    await call({action:'migrate_timers'});
    state=await call();const current=el('fcSession').value,action=el('fcAction').value;
    el('fcAction').innerHTML=Object.entries(state.actions).map(([k,v])=>`<option value="${k}">${html(v.label)}</option>`).join('');
    if(action)el('fcAction').value=action;
    el('fcTemplate').innerHTML=[...state.defaults.map((t,i)=>`<option value="d${i}">${html(t.name)} — исходный</option>`),...state.templates.map((t,i)=>`<option value="v${i}">${html(t.name)} — v${t.version}</option>`)].join('');
    el('fcSession').innerHTML='<option value="">Выберите встречу</option>'+state.sessions.filter(s=>s.active).map(s=>`<option value="${s.id}">${html(s.config.name)} · ${html(s.config.city)} · ${html(s.config.date)}</option>`).join('');el('fcSession').value=current;
    if(!el('fcText').value)applyTemplate(state.defaults[0]);
    el('fcSessions').innerHTML=state.sessions.map(s=>`<div class="fc-card">${html(s.config.name)} · ${html(s.config.city)} · ${html(s.config.date)} · ${s.active?'Запись открыта':'Закрыта'}<br><button data-session="${s.id}">Участники</button> <button data-active="${s.id}" data-value="${!s.active}">${s.active?'Закрыть запись':'Открыть запись'}</button></div>`).join('');
    el('fcJobs').innerHTML=state.jobs.map(j=>`<div class="fc-card">${html(state.actions[j.config.action]?.label)} · ${new Date(j.created_at).toLocaleString('ru-RU')}<br>${html(j.state)} · получателей ${j.total} · доставлено ${j.sent} · внимание ${j.attention}<br><button data-job="${j.id}">Подробности</button>${['running','queued','attention'].includes(j.state)?` <button data-resume="${j.id}">Продолжить неотправленных</button>`:''}</div>`).join('');
    el('fcTasks').innerHTML=state.tasks.filter(t=>t.error||t.state==='attention').map(t=>`<div class="fc-card">Задача ${html(t.kind)}: ${html(t.error||t.state)} <button data-task="${t.id}">Повторить обработку без повторной доставки</button></div>`).join('');
    el('fcSessions').querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>busy(b,()=>showBookings(b.dataset.session)));
    el('fcSessions').querySelectorAll('[data-active]').forEach(b=>b.onclick=()=>busy(b,async()=>{await call({action:'session_active',sessionId:b.dataset.active,active:b.dataset.value==='true'});await refresh();}));
    el('fcJobs').querySelectorAll('[data-job]').forEach(b=>b.onclick=()=>busy(b,async()=>{const d=await call(null,'?jobId='+b.dataset.job);el('fcJobDetails').innerHTML=d.recipients.map(r=>`<div class="fc-card">${html(r.first_name)} @${html(r.username)} · ${html(r.city)} · ${html(r.state)}<br>${html(r.error||'')}${r.choice?' · Ответ: '+html(r.choice):''}</div>`).join('');}));
    el('fcJobs').querySelectorAll('[data-resume]').forEach(b=>b.onclick=()=>busy(b,async()=>{await call({action:'resume_job',jobId:b.dataset.resume});await refresh();}));
    el('fcTasks').querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>busy(b,async()=>{await call({action:'retry_task',taskId:b.dataset.task});await refresh();}));
  }
  async function showBookings(id){const d=await call(null,'?sessionId='+id);el('fcBookings').innerHTML=d.bookings.length?d.bookings.map(b=>`<div class="fc-card">${html(new Date(b.starts_at).toLocaleString('ru-RU'))} · ${html(b.first_name)} ${html(b.last_name)} · ${html(b.city)} <button data-person="${b.candidate_id}">Анкета и чат</button> ${b.folder_url?`<a target="_blank" rel="noopener" href="${html(b.folder_url)}">Папка</a>`:''}</div>`).join(''):'На эту встречу пока нет записей';el('fcBookings').querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>openCandidate(Number(b.dataset.person)));}
  host.addEventListener('input',invalidate);
  el('fcSelect').onclick=()=>{document.querySelectorAll('#candidates .row').forEach(r=>chosen.add(Number(r.dataset.id)));invalidate();renderList();};
  el('fcClear').onclick=()=>{chosen.clear();invalidate();renderList();};
  el('fcLoad').onclick=e=>busy(e.target,refresh);
  el('fcTemplate').onchange=e=>{const v=e.target.value;applyTemplate(v[0]==='d'?state.defaults[Number(v.slice(1))]:state.templates[Number(v.slice(1))]);};
  el('fcAddButton').onclick=()=>{addButton();invalidate();};
  el('fcSaveTemplate').onclick=e=>busy(e.target,async()=>{const c=config();await call({action:'save_template',name:el('fcName').value,config:c});await refresh();el('fcAction').value=c.action;showNotice('Сохранена новая версия; прежние версии остались');});
  el('fcTest').onclick=e=>busy(e.target,async()=>{await call({action:'test',config:config()});showNotice('Тест отправлен @HRAcademyStrateg. Кнопки не занимают места.');});
  el('fcPreview').onclick=e=>busy(e.target,async()=>{
    const c=config();draft=await call({action:'preview',config:c,candidateIds:[...chosen]});
    const box=el('fcPreviewBox');box.hidden=false;box.innerHTML=`<h4>Получателей: ${draft.recipients.length}</h4><p>Будет выполнено: ${html(state.actions[c.action].label)}</p>${draft.recipients.map(r=>`<div>${html(r.name)} · @${html(r.username)} · ${html(r.city)}</div>`).join('')}<h4>Пример сообщения</h4><pre>${html(draft.recipients[0].text)}</pre>${draft.excluded.length?'<h4>Исключены</h4>'+draft.excluded.map(r=>`<div>${html(r.name||r.id)}: ${html(r.reason)}</div>`).join(''):''}<button id="fcSend">Отправить именно этим ${draft.recipients.length} кандидатам</button>`;
    el('fcSend').onclick=e2=>busy(e2.target,async()=>{const id=draft?.jobId;if(!id)throw Error('Повторите проверку');await call({action:'send',jobId:id});invalidate();chosen.clear();await load();await refresh();showNotice('Отправка запущена. Можно закрыть панель — обработка продолжится.');});
  });
  el('fsSave').onclick=e=>busy(e.target,async()=>{const r=await call({action:'save_session',config:{name:el('fsName').value,city:el('fsCity').value,format:el('fsFormat').value,date:el('fsDate').value,start:el('fsStart').value,end:el('fsEnd').value,interval:el('fsInterval').value,capacity:el('fsCapacity').value,location:el('fsLocation').value,cutoff:el('fsCutoff').value,reminder:el('fsReminder').value,confirmation:el('fsConfirmation').value}});await refresh();el('fcSession').value=r.session.id;invalidate();showNotice('Встреча создана. Приглашения ещё не отправлялись.');});
  host.addEventListener('toggle',()=>{if(host.open&&!state)busy(el('fcLoad'),refresh);});
  const deepSession=new URLSearchParams(location.search).get('funnel_session');
  if(deepSession&&key){host.open=true;refresh().then(()=>showBookings(deepSession)).catch(fail);}
})();
