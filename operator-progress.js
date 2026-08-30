/* CANDIDATE-VISIBILITY-033: evidence, not inferred delivery or automatic status changes. */
(() => {
  let evidence={};
  if(!statuses.some(s=>s[0]==='productivity_passed'))statuses.push(['productivity_passed','Продуктивность пройдена — расшифровать Тест 1']);
  const stageOrder=['new','experienced_not_target','interview_booked','interviewed','questionnaire','test_1_completed','productivity_invited','productivity_booked','productivity_passed','test_1_passed','finalist','selection_closed','rejected','cancelled','academy_contact','training','internship','hired'];
  statuses.sort((a,b)=>stageOrder.indexOf(a[0])-stageOrder.indexOf(b[0]));
  const names={new:'Анкета 1 / выбор Zoom',experienced_not_target:'Опыт от года — без приглашения',interview_booked:'Записан на первичный Zoom',interviewed:'Первичный Zoom пройден',questionnaire:'Анкета 2 / Тест 1',test_1_completed:'Тест 1 заполнен — интервью на продуктивность',test_1_passed:'Тест 1 расшифрован',productivity_invited:'Приглашён на продуктивность',productivity_booked:'Записан на продуктивность',productivity_passed:'Продуктивность пройдена — расшифровать Тест 1',finalist:'Финал отбора',selection_closed:'Не прошёл — ожидается ответ',rejected:'Отбор завершён',cancelled:'Отказался сам',academy_contact:'Контакт Академии',training:'Обучение',internship:'Стажировка',hired:'Принят'};
  statuses.forEach(item=>{item[1]=names[item[0]]||item[1];});
  const filter=$('filter'),current=filter.value;filter.innerHTML='<option value="">Все этапы</option>';
  const recruit=document.createElement('optgroup');recruit.label='Отбор';
  const after=document.createElement('optgroup');after.label='После отбора';
  statuses.forEach(([v,l])=>(['training','internship','hired','academy_contact'].includes(v)?after:recruit).append(new Option(l,v)));
  filter.append(recruit,after);filter.value=current;
  const oldApply=applyCandidateData;applyCandidateData=d=>{oldApply(d);evidence=d.progress||{errors:['not_loaded']};};
  const date=x=>x?new Date(x).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'})+' МСК':'дата не сохранена';
  const day=x=>String(x||'').slice(0,10);
  const delivered=m=>m.direction==='out'&&m.delivery_status==='delivered';
  const last=items=>items[items.length-1];
  const stage=t=>t?.submitted_at?'Заполнено · '+date(t.submitted_at):t?.sent_at?'Ссылка отправлена · '+date(t.sent_at):'Заполнение не подтверждено';
  function view(){
    const p=evidence,c=details,rows=[];
    const sent=messages.filter(delivered),incoming=last(messages.filter(m=>m.direction==='in')),outgoing=last(sent);
    const primary=last(sent.filter(m=>['booking_confirmation','reschedule_confirmation'].includes(m.kind)));
    const invites=sent.filter(m=>m.kind==='offline_interview_invite');
    const campaigns=p.campaigns||[],bookings=p.bookings||[],old=p.offlineBookings||[];
    const invitation=campaigns.find(r=>r.state==='sent'&&['invite','test_passed'].includes(r.config?.action));
    const active=bookings.find(b=>b.active&&new Date(b.starts_at)>new Date());
    const legacy=old.find(b=>b.status==='booked'&&new Date(day(b.event_date)+'T'+(String(b.slot_time).includes(':')?b.slot_time:String(b.slot_time).replace(/^(\d{2})(\d{2})$/,'$1:$2'))+':00+03:00')>new Date());
    const unread=Boolean(incoming&&(!outgoing||new Date(incoming.created_at)>new Date(outgoing.created_at)));
    const errors=p.errors?.length;
    const closed=['rejected','cancelled','selection_closed','academy_contact','finalist','training','internship','hired'].includes(c.status);
    let next=c.status==='productivity_passed'?'Интервью на продуктивность пройдено. Теперь расшифруйте Тест 1':c.status==='test_1_passed'?'Тест 1 расшифрован. Ожидается решение по дальнейшему этапу':closed?'Решение / дальнейший этап: '+label(c.status):active||legacy?'Ожидаем встречу по выбранному времени':errors?'Журнал приглашений загружен не полностью — обновите карточку':invitation||invites.length?'Приглашение есть в истории. Проверьте дату и выбор времени ниже':testDetails?.submitted_at?'Тест 1 заполнен. Подтверждения приглашения на продуктивность не найдено: следующий шаг — интервью на продуктивность, без предварительной расшифровки теста':!questionnaireTwo?.submitted_at&&['interviewed','questionnaire'].includes(c.status)?'Ожидаем Анкету 2':questionnaireTwo?.submitted_at?'Ожидаем Тест 1 по инструкциям группы':c.status==='interview_booked'?'Ожидаем первичный Zoom и кодовое слово после встречи':'Ожидаем продолжение кандидатом в боте';
    rows.push(['Анкета 2',stage(questionnaireTwo)],['Тест 1',stage(testDetails)],['Первичный Zoom',c.interview_at?date(c.interview_at)+(new Date(c.interview_at)<new Date()?' · прошедшая дата':''):primary?'Есть подтверждение в переписке':'Запись не подтверждена']);
    rows.push(['Приглашение на продуктивность',errors?'Данные неполные':invitation?'Отправлено · '+date(invitation.updated_at):invites.length?'Есть отправка в переписке · '+date(last(invites).created_at):(p.offlineInvites||[]).some(i=>['sent','booked'].includes(i.status))?'Подтверждено журналом офлайн-приглашений':'Подтверждённой отправки нет']);
    rows.push(['Выбранное время',active?date(active.starts_at)+' · '+(active.config.location||''):legacy?day(legacy.event_date)+' '+String(legacy.slot_time).replace(/^(\d{2})(\d{2})$/,'$1:$2')+' МСК':'Будущая запись на продуктивность не найдена']);
    const summaries=campaigns.map(r=>`${r.config?.action||'Действие'} · ${({sent:'Отправлено',pending:'Ожидает отправки',processing:'Обрабатывается',attention:'Требует проверки'})[r.state]||r.state}${r.job_state==='draft'?' · только черновик':''} · ${date(r.updated_at)}${r.error?' · '+r.error:''}${r.choice?' · ответ: '+r.choice:''}`);
    (p.offlineInvites||[]).forEach(r=>summaries.push('Офлайн '+day(r.event_date)+' · '+({sent:'Отправлено',booked:'Время выбрано',pending:'Отправка не подтверждена',failed:'Ошибка'})[r.status]));
    return `<summary>${unread?'✉ Есть входящее после последнего ответа · ':''}Движение кандидата</summary><p class="progress-next">${esc(next)}</p><dl>${rows.map(([a,b])=>`<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl><p><b>Последнее отправленное:</b> ${outgoing?esc(date(outgoing.created_at)+' — '+plain(outgoing.text)):'Нет подтверждения в истории'}</p><p><b>Последнее входящее:</b> ${incoming?esc(date(incoming.created_at)+' — '+plain(incoming.text)):'Нет'}</p>${summaries.length?'<h4>Журнал приглашений и решений</h4>'+summaries.map(t=>'<p>'+esc(t)+'</p>').join(''):''}<p class="muted">«Отправлено» означает принятие сообщения Telegram, не прочтение. Старые кнопки целиком не сохранялись; текст сообщения не доказывает наличие конкретного свободного слота.</p>`;
  }
  const render=renderDetail;renderDetail=()=>{
    render();if(!details)return;
    const head=$('detail').querySelector('.candidate-head>div');
    const progress=document.createElement('details');progress.className='candidate-progress';progress.open=true;progress.innerHTML=view();head.prepend(progress);
    const select=$('status');select.title='Ручная коррекция этапа — без отправки сообщения';
    select.querySelectorAll('option').forEach(o=>o.textContent=names[o.value]||o.textContent);
    const history=$('detail').querySelector('.history');
    history.querySelectorAll('.bubble').forEach((bubble,i)=>{const m=messages[i];if(!m)return;const note=document.createElement('div');note.className='message-purpose';note.textContent=({candidate_group_invite:'Группа + Анкета 2 (две кнопки)',questionnaire_2_required:'Кнопка «Заполнить Анкету 2»',candidate_test_invite:'Персональная ссылка на Тест 1',offline_interview_invite:'Приглашение: Цели, PDF, выбор времени',booking_confirmation:'Подтверждение первичного Zoom',reschedule_confirmation:'Подтверждение переноса Zoom',candidate_test_already_completed:'Тест уже сохранён — не приглашение',test_1_completed:'Подтверждение заполнения Теста 1',questionnaire_2_completed:'Подтверждение заполнения Анкеты 2'})[m.kind]||(m.direction==='in'?'От кандидата':'Сообщение кандидату');bubble.prepend(note);const small=bubble.querySelector('small');if(small)small.textContent=date(m.created_at)+' · '+({delivered:'Принято Telegram',received:'Получено',failed:'Ошибка отправки'})[m.delivery_status];});
  };
  const style=document.createElement('style');style.textContent=`
  #candidates .row{display:flex;flex-direction:column;gap:5px;overflow:hidden}#candidates .row>span{display:block;width:100%;min-width:0;overflow-wrap:anywhere}#candidates .row>span:nth-of-type(2){font-size:12px}#candidates .row em{display:block;width:100%;min-width:0}#candidates .row strong{font-size:15px}#candidates .row b{font-weight:500}
  .candidate-progress{border:1px solid #ccd8e2;background:#f5fafc;border-radius:10px;padding:10px;margin-bottom:12px;font-size:13px;overflow-wrap:anywhere}.candidate-progress summary{cursor:pointer;font-weight:700}.candidate-progress p{margin:8px 0;white-space:pre-wrap}.candidate-progress dl{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,2fr);gap:7px}.candidate-progress dt{font-weight:700}.candidate-progress dd{margin:0}.progress-next{color:#155775;font-weight:700}.message-purpose{font-size:12px;color:#5f6573;margin-bottom:6px}.candidate-head select{max-width:100%}@media(max-width:1100px){.candidate-head{flex-direction:column}.candidate-head select{width:100%}}@media(max-width:430px){.candidate-progress dl{grid-template-columns:1fr}.candidate-progress dd{margin-bottom:6px}}
  `;document.head.append(style);
})();
