export function reviewThread(city){return city==='Челябинск'?635:30;}
export function confirmationKeyboard(session,booking){
 const rows=[];
 if(session.config.format==='online')rows.push([{text:'Подключиться к Zoom',url:session.config.location}]);
 if(session.config.allowReschedule!==false)rows.push([{text:'Изменить время',callback_data:`fc_change_${session.id}`}]);
 if(session.config.allowCancel&&booking)rows.push([{text:'Отменить запись',callback_data:`fc_cancel_${booking.id}_${booking.version}`}]);
 return {inline_keyboard:rows};
}
