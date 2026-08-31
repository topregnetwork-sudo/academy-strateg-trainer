export function reviewThread(city){return city==='Челябинск'?635:30;}
export function confirmationKeyboard(session){
 const rows=[];
 if(session.config.format==='online')rows.push([{text:'Подключиться к Zoom',url:session.config.location}]);
 if(session.config.allowReschedule!==false)rows.push([{text:'Изменить время',callback_data:`fc_change_${session.id}`}]);
 return {inline_keyboard:rows};
}
