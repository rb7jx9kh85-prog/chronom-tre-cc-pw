import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, mutate, summary, project } from '../lib/core.js';
import { createHandler } from '../lib/server.js';
const base=Date.parse('2026-10-16T20:00:00Z');
test('timer survives closure, excludes pauses, records whole seconds',()=>{
 let s=mutate(initialState(),{action:'start',type:'call',version:0},base);
 assert.equal(summary(s,base+3600000).totalMs,3600000);
 s=mutate(s,{action:'pause',version:1},base+3600500);
 assert.equal(summary(s,base+7200000).totalMs,3600500);
 s=mutate(s,{action:'start',version:2},base+7200000);
 s=mutate(s,{action:'stop',version:3},base+9000000);
 assert.equal(s.sessions[0].ms,5400000);assert.equal(s.timer,null);
 s=mutate(s,{action:'settings',plan:'hour',paidCents:1000,version:4},base+9000000);
 assert.equal(summary(s,base).billCents,4500);assert.equal(summary(s,base).balanceCents,3500);
});
test('package prices, overtime and credit',()=>{
 let s=mutate(initialState(),{action:'manual',type:'work',date:'2026-10-15',seconds:39600,version:0},base);
 assert.equal(summary(s,base).billCents,22500);assert.equal(summary(s,base).quotaMs,36000000);
 s=mutate(s,{action:'settings',plan:'5',paidCents:15000,version:1},base);
 assert.equal(summary(s,base).billCents,12500);assert.equal(summary(s,base).balanceCents,-2500);
});
test('validates values, versions and dates; duplicate start rejected',()=>{
 assert.throws(()=>mutate(initialState(),{action:'manual',type:'call',date:'2026-02-30',seconds:1,version:0},base));
 assert.throws(()=>mutate(initialState(),{action:'manual',type:'call',date:'2026-10-16',seconds:-1,version:0},base));
 assert.throws(()=>mutate(initialState(),{action:'settings',plan:'5',paidCents:0,version:5},base),{status:409});
 let s=mutate(initialState(),{action:'start',type:'call',version:0},base);
 assert.throws(()=>mutate(s,{action:'start',type:'work',version:1},base),{status:409});
});
test('client projection never contains financial fields',()=>{
 const s={...initialState(),paidCents:15000};const v=project(s,'client',base);
 assert.ok(!('paidCents' in v));assert.ok(!('billCents' in v));assert.ok('paidCents' in project(s,'admin',base));
});
const env={ADMIN_ID:'noe',ADMIN_PASSWORD:'test-admin-password-123',CLIENT_ID:'prestigewash',CLIENT_PASSWORD:'test-client-password-456',VERCEL:'1'};
function mockDB(){let raw=null,rate=0,conflict=false;const db=async c=>{
 if(c[0]==='GET')return raw;
 if(c[0]==='EVAL'&&c[1].includes('INCR'))return ++rate;
 if(c[0]==='EVAL'){if(conflict)return 0;if((raw?JSON.parse(raw).version:0)!==Number(c[4]))return 0;raw=c[5];return 1;}
 throw Error('Unsupported mock');};return {db,conflict:()=>{conflict=true},read:()=>JSON.parse(raw)};}
async function request(handler,body,cookie='',origin='https://example.com'){
 const headers={};let status,payload;
 const req={method:body?'POST':'GET',headers:{cookie,host:'example.com',origin,'content-type':'application/json','x-forwarded-for':'192.0.2.1'},body};
 const res={setHeader:(k,v)=>{headers[k]=v},status:n=>{status=n;return res},json:p=>{payload=p}};
 await handler(req,res);return {status,payload,headers,cookie:headers['Set-Cookie']?.split(';')[0]};
}
test('authentication, read-only client, cross-device state and secure cookie',async()=>{
 const db=mockDB(),h=createHandler({env,clock:()=>base,redis:db.db});
 assert.equal((await request(h)).status,401);
 assert.equal((await request(h,{action:'login',id:'noe',password:'bad'})).status,401);
 const admin=await request(h,{action:'login',id:'noe',password:env.ADMIN_PASSWORD});
 assert.equal(admin.status,200);assert.match(admin.headers['Set-Cookie'],/HttpOnly/);assert.match(admin.headers['Set-Cookie'],/Secure/);
 assert.equal((await request(h,{action:'manual',type:'call',date:'2026-10-16',seconds:90,version:0},admin.cookie)).status,200);
 const client=await request(h,{action:'login',id:'prestigewash',password:env.CLIENT_PASSWORD});
 assert.equal(client.payload.state.sessions[0].ms,90000);assert.ok(!('paidCents' in client.payload.state));
 assert.equal((await request(h,{action:'start',type:'call',version:1},client.cookie)).status,403);
 assert.equal((await request(h,{action:'start',type:'call',version:1},admin.cookie,'https://evil.example')).status,403);
 assert.equal((await request(h,undefined,admin.cookie+'tamper')).status,401);
 const logout=await request(h,{action:'logout'},admin.cookie);assert.match(logout.headers['Set-Cookie'],/Max-Age=0/);
});
test('atomic write conflicts return 409 without claiming success',async()=>{
 const db=mockDB(),h=createHandler({env,clock:()=>base,redis:db.db});
 const a=await request(h,{action:'login',id:'noe',password:env.ADMIN_PASSWORD});db.conflict();
 assert.equal((await request(h,{action:'start',type:'call',version:0},a.cookie)).status,409);assert.equal(db.read(),null);
});
test('login throttling and missing configuration',async()=>{
 const db=mockDB(),h=createHandler({env,clock:()=>base,redis:db.db});
 for(let i=0;i<20;i++)assert.equal((await request(h,{action:'login',id:'bad',password:'bad'})).status,401);
 assert.equal((await request(h,{action:'login',id:'noe',password:env.ADMIN_PASSWORD})).status,429);
 assert.equal((await request(createHandler({env:{},redis:db.db}))).status,503);
});
