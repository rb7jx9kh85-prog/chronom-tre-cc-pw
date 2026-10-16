import { randomUUID } from 'node:crypto';
export class AppError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const initialState = () => ({ version: 0, plan: '10', paidCents: 0, sessions: [], timer: null, updatedAt: null });
export const elapsed = (t, now) => t ? t.elapsedMs + (t.startedAt === null ? 0 : Math.max(0, now - t.startedAt)) : 0;
export function summary(s, now) {
  const callMs = s.sessions.filter(x => x.type === 'call').reduce((n,x) => n+x.ms,0);
  const workMs = s.sessions.filter(x => x.type === 'work').reduce((n,x) => n+x.ms,0);
  const recordedMs = callMs + workMs;
  const totalMs = recordedMs + elapsed(s.timer,now);
  const quotaMs = s.plan === 'hour' ? null : Number(s.plan)*3600000;
  const billCents = s.plan === 'hour' ? Math.round(recordedMs/3600000*3000) : s.plan === '10' ? 22500 : 12500;
  return { callMs, workMs, recordedMs, totalMs, quotaMs, billCents, balanceCents: billCents - s.paidCents };
}
export function project(s, role, now) {
  if (role === 'admin') return s;
  return { version:s.version, plan:s.plan, sessions:s.sessions.map(({id,date,type,ms}) => ({id,date,type,ms})), timer:s.timer, updatedAt:s.updatedAt };
}
function requireValue(ok,msg='Valeur invalide.') { if(!ok) throw new AppError(400,msg); }
export function mutate(current, input, now = Date.now()) {
  requireValue(input && Number.isInteger(input.version), 'Version manquante.');
  if(input.version !== current.version) throw new AppError(409,'Le suivi a changé sur un autre appareil. Recharge et réessaie.');
  const s=structuredClone(current), type=input.type;
  const checkType=()=>requireValue(['call','work'].includes(type),'Activité invalide.');
  switch(input.action) {
    case 'start':
      if(s.timer?.startedAt !== null && s.timer) throw new AppError(409,'Une session est déjà active.');
      if(s.timer) s.timer.startedAt=now;
      else {checkType();s.timer={type,startedAt:now,elapsedMs:0,date:new Date(now).toLocaleDateString('en-CA',{timeZone:'Europe/Zurich'})};}
      break;
    case 'pause':
      requireValue(s.timer && s.timer.startedAt!==null,'Aucune session active.');
      s.timer.elapsedMs=elapsed(s.timer,now);s.timer.startedAt=null;break;
    case 'stop': {
      requireValue(s.timer,'Aucune session à enregistrer.');
      const ms=Math.floor(elapsed(s.timer,now)/1000)*1000;
      requireValue(ms>=1000,'La session doit durer au moins une seconde.');
      requireValue(s.sessions.length<10000,'Exporte les données : limite de 10 000 sessions atteinte.');
      s.sessions.push({id:randomUUID(),type:s.timer.type,date:s.timer.date,ms});s.timer=null;break;
    }
    case 'manual': {
      checkType();requireValue(Number.isInteger(input.seconds)&&input.seconds>0&&input.seconds<=3600000,'Durée invalide (maximum 1 000 heures).');
      const d=input.date;requireValue(typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d,'Date invalide.');
      requireValue(s.sessions.length<10000,'Limite de sessions atteinte.');
      s.sessions.push({id:randomUUID(),type,date:d,ms:input.seconds*1000});break;
    }
    case 'delete':
      requireValue(s.sessions.some(x=>x.id===input.id),'Session introuvable.');s.sessions=s.sessions.filter(x=>x.id!==input.id);break;
    case 'settings':
      requireValue(['10','5','hour'].includes(input.plan),'Forfait invalide.');
      requireValue(Number.isSafeInteger(input.paidCents)&&input.paidCents>=0&&input.paidCents<=100000000,'Montant invalide.');
      s.plan=input.plan;s.paidCents=input.paidCents;break;
    default:throw new AppError(400,'Action inconnue.');
  }
  s.version++;s.updatedAt=now;return s;
}
