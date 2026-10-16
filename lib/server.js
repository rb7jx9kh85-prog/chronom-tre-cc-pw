import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError, initialState, mutate, project } from './core.js';
const equal=(a,b)=>{const aa=createHash('sha256').update(String(a??'')).digest(),bb=createHash('sha256').update(String(b??'')).digest();return timingSafeEqual(aa,bb);};
const CAS=`local raw=redis.call('GET',KEYS[1]); local v=0; if raw then v=cjson.decode(raw).version end; if v~=tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`;
const RATE=`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n`;
export function redisClient(env) {
  const url=env.UPSTASH_REDIS_REST_URL||env.KV_REST_API_URL,token=env.UPSTASH_REDIS_REST_TOKEN||env.KV_REST_API_TOKEN;
  if(!url||!token) throw new AppError(503,'Connecte une base Upstash Redis à ce projet Vercel, puis redéploie.');
  return async command=>{
    const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(10000)});
    if(!r.ok) throw new AppError(503,'Stockage indisponible. Aucun changement confirmé ; réessaie.');
    const d=await r.json();if(d.error)throw new AppError(503,'Erreur de stockage. Vérifie la connexion Redis.');return d.result;
  };
}
export function createHandler({env=process.env,clock=Date.now,redis=null}={}) {
  return async (req,res)=>{
    const send=(status,body)=>res.status(status).json(body);
    res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Vary','Cookie');
    try {
      if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');throw new AppError(405,'Méthode non autorisée.');}
      if(!env.ADMIN_ID||!env.CLIENT_ID||!env.ADMIN_PASSWORD||!env.CLIENT_PASSWORD||env.ADMIN_PASSWORD.length<12||env.CLIENT_PASSWORD.length<12||env.ADMIN_ID===env.CLIENT_ID||env.ADMIN_PASSWORD===env.CLIENT_PASSWORD)throw new AppError(503,'Configure ADMIN_ID, ADMIN_PASSWORD, CLIENT_ID et CLIENT_PASSWORD dans Vercel. Identifiants et mots de passe distincts ; mots de passe de 12 caractères minimum.');
      const now=clock(), db=redis||redisClient(env),key=env.DATA_KEY||'prestige-wash:production:v1';
      const secret=createHash('sha256').update(JSON.stringify([env.ADMIN_ID,env.ADMIN_PASSWORD,env.CLIENT_ID,env.CLIENT_PASSWORD])).digest();
      const sign=x=>createHmac('sha256',secret).update(x).digest('base64url');
      const cookie=(value,maxAge)=>{res.setHeader('Set-Cookie',`pw_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${env.VERCEL?' ; Secure':''}`);};
      let role=null;
      const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('pw_session='))?.slice(11);
      if(token)try {const [payload,sig,...extra]=token.split('.');if(extra.length===0&&equal(sig,sign(payload))){const p=JSON.parse(Buffer.from(payload,'base64url').toString());if(p.exp>now&&['admin','client'].includes(p.role))role=p.role;}}catch{}
      let body={};
      if(req.method==='POST') {
        const origin=req.headers.origin;
        if(origin && new URL(origin).host!==req.headers.host)throw new AppError(403,'Origine non autorisée.');
        if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AppError(415,'JSON requis.');
        body=typeof req.body==='string'?JSON.parse(req.body):req.body;
        if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>20000)throw new AppError(400,'Requête invalide.');
        if(body.action==='login') {
          const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0];
          const hash=createHash('sha256').update(ip).digest('hex');
          const attempts=await db(['EVAL',RATE,1,`${key}:login:${hash}`]);
          if(Number(attempts)>20)throw new AppError(429,'Trop de tentatives. Réessaie dans 15 minutes.');
          if(equal(body.id,env.ADMIN_ID)&&equal(body.password,env.ADMIN_PASSWORD))role='admin';
          else if(equal(body.id,env.CLIENT_ID)&&equal(body.password,env.CLIENT_PASSWORD))role='client';
          else throw new AppError(401,'Identifiant ou mot de passe incorrect.');
          const p=Buffer.from(JSON.stringify({role,exp:now+7*86400000})).toString('base64url');cookie(`${p}.${sign(p)}`,604800);
        }else if(body.action==='logout'){cookie('',0);return send(200,{ok:true});}
      }
      if(!role)throw new AppError(401,'Connecte-toi pour consulter le suivi.');
      const raw=await db(['GET',key]);let state=raw?JSON.parse(raw):initialState();
      if(req.method==='POST'&&body.action!=='login') {
        if(role!=='admin')throw new AppError(403,'Cet accès permet uniquement de consulter le temps.');
        const next=mutate(state,body,now);
        const ok=await db(['EVAL',CAS,1,key,state.version,JSON.stringify(next)]);
        if(Number(ok)!==1)throw new AppError(409,'Le suivi a changé. Recharge avant de réessayer.');state=next;
      }
      return send(200,{role,state:project(state,role,now),serverTime:now});
    }catch(e){if(e instanceof SyntaxError)return send(400,{error:'JSON invalide.'});return send(e.status||503,{error:e.status?e.message:'Serveur temporairement indisponible. Réessaie avant de quitter.'});}
  };
}
