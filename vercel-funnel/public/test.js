const SUPABASE_URL='https://rgllatulrowzhipihlgi.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnbGxhdHVscm93emhpcGlobGdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNTM4ODEsImV4cCI6MjEwMjYyOTg4MX0.q8Y_mylhNE8r0C-pHl48mozZYuPg0u3SSI-rFJwWclE';
const definition=window.TEST_DEFINITION;
const token=(new URLSearchParams(location.search).get('token')||'').trim();
const draftKey=`academy-strateg-test:${token}`;
const $=id=>document.getElementById(id);
let session=null;

function rpc(name,payload,signal){
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{
    method:'POST',
    headers:{'content-type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`},
    body:JSON.stringify(payload),
    signal
  }).then(async response=>{
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(data?.message||data?.error||'Сервис тестирования временно недоступен');
    return data;
  });
}

function show(id){['loading','errorState','doneState','testForm'].forEach(name=>$(name).hidden=name!==id)}
function safeDraft(){try{const value=JSON.parse(localStorage.getItem(draftKey)||'{}');return value&&typeof value==='object'?value:{}}catch{return{}}}
function saveDraft(){const answers={};document.querySelectorAll('input[type=radio]:checked').forEach(input=>answers[input.name]=input.value);try{localStorage.setItem(draftKey,JSON.stringify(answers))}catch{}}
function clearDraft(){try{localStorage.removeItem(draftKey)}catch{}}

function renderQuestions(){
  const draft=safeDraft();
  $('questions').innerHTML=definition.questions.map(({number,text})=>`<fieldset class="question" data-number="${number}"><legend><span class="question-number">${number}.</span><span>${escapeHtml(text)}</span></legend><div class="answer-grid">${definition.scale.map(option=>`<label class="answer-option"><input type="radio" name="q${number}" value="${option.value}" ${draft[`q${number}`]===option.value?'checked':''}><span>${option.label}</span></label>`).join('')}</div></fieldset>`).join('');
  document.querySelectorAll('input[type=radio]').forEach(input=>input.addEventListener('change',()=>{input.closest('.question').classList.remove('unanswered');saveDraft();updateProgress()}));
  updateProgress();
}

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function answeredCount(){return document.querySelectorAll('input[type=radio]:checked').length}
function firstUnanswered(){return definition.questions.map(({number})=>document.querySelector(`.question[data-number="${number}"]`)).find(field=>!field.querySelector('input:checked'))}
function updateProgress(){const count=answeredCount(),left=definition.questions.length-count;$('progressCount').textContent=`${count} из ${definition.questions.length}`;$('progressHint').textContent=left?`Осталось ответить: ${left}`:'Все вопросы заполнены';$('progressBar').style.width=`${count/definition.questions.length*100}%`;$('unansweredButton').hidden=!count||!left}
function goToUnanswered(){const field=firstUnanswered();if(!field)return;field.classList.add('unanswered');field.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>field.querySelector('input')?.focus({preventScroll:true}),450)}

async function loadSession(){
  if(!definition?.questions||definition.questions.length!==200||!/^[a-f0-9]{48,80}$/i.test(token)){show('errorState');$('errorText').textContent='Персональная ссылка недействительна. Откройте тест кнопкой из сообщения Telegram.';return}
  show('loading');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
    session=await rpc('get_candidate_test',{p_token:token},controller.signal);
    if(!session?.candidate_name)throw new Error('Персональная ссылка не найдена или была отключена');
    if(session.questionnaire_version!==definition.version)throw new Error('Версия теста обновилась. Запросите у координатора новую ссылку.');
    if(session.submitted_at){show('doneState');return}
    $('candidateName').textContent=session.candidate_name;
    $('candidateMeta').textContent=[session.city,session.telegram_username?`@${session.telegram_username}`:''].filter(Boolean).join(' · ');
    renderQuestions();
    show('testForm');
  }catch(error){show('errorState');$('errorText').textContent=error.name==='AbortError'?'Сервис отвечает слишком долго. Проверьте интернет и повторите попытку.':error.message}
  finally{clearTimeout(timeout)}
}

$('testForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const missing=definition.questions.length-answeredCount();
  if(missing){$('formNotice').textContent=`Осталось ответить на ${missing} ${missing===1?'вопрос':'вопросов'}.`;$('submitHint').textContent='Сначала заполните пропущенные вопросы — мы покажем первый из них.';goToUnanswered();return}
  const answers=definition.questions.map(({number})=>document.querySelector(`input[name="q${number}"]:checked`).value);
  const button=$('submitButton');button.disabled=true;button.textContent='Отправляем ответы…';$('formNotice').textContent='';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
  try{
    const result=await rpc('submit_candidate_test',{p_token:token,p_answers:answers,p_questionnaire_version:definition.version},controller.signal);
    if(!result?.ok)throw new Error(result?.error||'Не удалось сохранить ответы');
    clearDraft();show('doneState');scrollTo({top:0,behavior:'smooth'});
  }catch(error){$('formNotice').textContent=error.name==='AbortError'?'Отправка заняла слишком много времени. Проверьте интернет и нажмите ещё раз.':error.message;button.disabled=false;button.textContent='Отправить 200 ответов'}
  finally{clearTimeout(timeout)}
});

$('retryButton').addEventListener('click',loadSession);
$('unansweredButton').addEventListener('click',goToUnanswered);
loadSession();
