// New outgoing coordination messages only. Never move/edit historic messages.
export function routeStaffMessage(method,payload){
 const sends=['sendMessage','sendDocument','sendPhoto','sendVideo','sendAudio','sendVoice','sendMediaGroup'];
 if(sends.includes(method)&&String(payload.chat_id)==='-1004397133749'&&Number(payload.message_thread_id)===30)return {...payload,message_thread_id:619};
 return payload;
}
