// GuestHub V33 FINAL — ALL FEATURES + UNALIGNMENT SELF-HEALING
import express from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 10000;
const app = express();

// ===== CACHE FOR 1000 HOTELS SCALE =====
let HOTEL_CACHE = { data: [], time: 0 };
let SERVICE_CACHE = new Map();

// ===== PORT OPEN FIRST FOR RENDER =====
app.get('/api/health',(req,res)=>res.json({
  ok:true, 
  os:'V33 FINAL ALL-FEATURES', 
  port:PORT, 
  hasUrl:!!process.env.SUPABASE_URL, 
  cache: HOTEL_CACHE.data.length,
  advice: "If vendors=[] but public.vendors has data => Run /api/admin/repair to sync",
  time:new Date().toISOString()
}));

app.get('/config.js',(req,res)=>{
  res.type('application/javascript');
  res.setHeader('Cache-Control','no-cache');
  const u = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
  const k = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-key';
  res.send(`const SUPABASE_URL="${u}";const SUPABASE_KEY="${k}";window.SUPABASE_URL="${u}";window.SUPABASE_KEY="${k}";`);
});

const server = app.listen(PORT, '0.0.0.0', ()=>console.log(`🔒 V33 FINAL LIVE on ${PORT}`));
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
process.on('uncaughtException', e=>console.log('UNCAUGHT:', e.message));
process.on('unhandledRejection', e=>console.log('REJECTION:', e?.message));

// ===== SECURITY =====
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({origin:(o,cb)=>cb(null,true), credentials:true}));
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true, limit:"2mb"}));

const loginLimiter = rateLimit({ windowMs:15*60*1000, max:20, message:{ok:false,error:"Too many login attempts"} });
const signupLimiter = rateLimit({ windowMs:60*60*1000, max:100, message:{ok:false,error:"Too many signups"} });
const orderLimiter = rateLimit({ windowMs:60*1000, max:120 });

// ===== CONFIG =====
const REAL_URL = process.env.SUPABASE_URL;
const REAL_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const REAL_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_URL = REAL_URL || "https://placeholder.supabase.co";
const SUPABASE_KEY = REAL_KEY || "placeholder-anon-key";
const SUPABASE_SERVICE_KEY = REAL_SERVICE || REAL_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_OS_2026_SECURE_KEY_CHANGE_ME";

const GUESTHUB_TILL = {
  till_number: process.env.TILL_NUMBER || "123456",
  paybill: process.env.PAYBILL_NUMBER || "522522",
  account_number: process.env.TILL_ACCOUNT || "1234567",
  business_name: "GuestHub Ltd",
  lipa_na_mpesa_name: "GuestHub"
};

let supa = null;
try { supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {auth:{persistSession:false}}); } catch(e){}

// ===== HELPERS =====
function clean(v){return String(v||"").trim().toLowerCase()}
function cleanText(v,m=500){ let s = String(v||"").trim().slice(0,m); return s.replace(/[<>]/g,''); }
function isValidEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)}
function safeNumber(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f}
function sendError(res,s,m){return res.status(s).json({ok:false,error:m})}
function sendSuccess(res,d={}){return res.json({ok:true,...d})}
function getBearer(req){const h=req.headers.authorization; if(h&&h.startsWith("Bearer ")) return h.slice(7); return null}
function verifyToken(req){const t=getBearer(req); if(!t) return null; try{return jwt.verify(t,JWT_SECRET)}catch{return null}}
function getHotelIdFromReq(req){ const token=verifyToken(req); if(token?.hotel_id) return token.hotel_id.toUpperCase(); return (req.query.hotel_id||req.body.hotel_id||req.headers['x-hotel-id']||'BAOBAB').toString().toUpperCase(); }

// ===== ADVICE ENDPOINT — UNALIGNMENT CHECK =====
app.get("/api/admin/repair-info", async (req,res)=>{
  try{
    if(!supa) return res.json({ok:false, msg:"No DB"});
    const {count:guestCount} = await supa.schema('guesthub_os').from('vendors').select('*',{count:'exact',head:true});
    const {count:publicCount} = await supa.from('vendors').select('*',{count:'exact',head:true});
    const {count:hotelCount} = await supa.from('hotels').select('*',{count:'exact',head:true});
    res.json({
      ok:true,
      tables: { guesthub_os_vendors: guestCount, public_vendors: publicCount, hotels: hotelCount },
      advice: guestCount===0 && publicCount>0 ? "⚠️ Misaligned! guesthub_os empty but public has data. Call POST /api/admin/repair to sync." :
              guestCount>0 && publicCount===0 ? "⚠️ public.vendors empty. Will auto-sync on next signup." :
              "✅ Tables aligned",
      fix: "POST /api/admin/repair will copy public->guesthub_os and set missing password_hash to 12345678"
    });
  }catch(e){ res.json({ok:false, error:e.message}); }
});

// AUTO REPAIR — CALL THIS IF VENDORS=[] 
app.post("/api/admin/repair", async (req,res)=>{
  try{
    if(!supa) return sendError(res,500,"No DB");
    const hash = await bcrypt.hash("12345678",12);
    // 1. Copy public.vendors -> guesthub_os.vendors where missing
    const {data:pubVendors} = await supa.from('vendors').select('*').limit(200);
    let copied=0;
    for(const v of (pubVendors||[])){
      const {data:exists} = await supa.schema('guesthub_os').from('vendors').select('id').eq('id',v.id).maybeSingle();
      if(!exists){
        try{ await supa.schema('guesthub_os').from('vendors').insert([{...v, password_hash: v.password_hash||hash, hotel_ids: v.hotel_ids||["ALL"]} ]); copied++; }catch{}
      } else if(!exists.password_hash && !v.password_hash){
        await supa.schema('guesthub_os').from('vendors').update({password_hash:hash}).eq('id',v.id);
      }
    }
    // 2. Ensure all vendors have password_hash
    await supa.schema('guesthub_os').from('vendors').update({password_hash:hash}).is('password_hash',null);
    HOTEL_CACHE.time=0; SERVICE_CACHE.clear();
    res.json({ok:true, copied, message:`Repaired ${copied} vendors, set default password 12345678 for old accounts`});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

// ===== HOTELS =====
app.get('/api/data', async (req,res)=>{
  try{
    if(Date.now() - HOTEL_CACHE.time < 60000 && HOTEL_CACHE.data.length) return res.json({hotels: HOTEL_CACHE.data, cached:true});
    if(!supa ||!REAL_URL) return res.json({hotels:[{id:'BAOBAB',hotel_id:'BAOBAB',hotel_name:'Baobab Beach Resort'}]});
    const {data} = await supa.from('hotels').select("id,hotel_id,hotel_name,name,location,city,hotel_type,status").eq('status','APPROVED').limit(1000);
    HOTEL_CACHE = { data: data||[], time: Date.now() };
    res.json({hotels: data||[], cached:false});
  }catch(e){ res.json({hotels: HOTEL_CACHE.data || []}); }
});

async function handleHotelSignup(req,res){
 try{
  const {hotel_name,name,email,phone,password,location,city}=req.body;
  if(!password || String(password).length < 8) return sendError(res,400,"Password 8+ required");
  const finalName=cleanText(hotel_name||name||'Hotel',100);
  if(finalName.length<3) return sendError(res,400,"Hotel name short");
  if(!supa ||!REAL_URL){ const hid=finalName.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10)+Math.floor(Math.random()*99); return sendSuccess(res,{hotel_id:hid,status:"PENDING"}); }
  const finalEmail=clean(email); if(!isValidEmail(finalEmail)) return sendError(res,400,"Invalid email");
  const hotelId=(finalName.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,12)||'hotel').toUpperCase()+(Math.floor(Math.random()*900)+100);
  const hash=await bcrypt.hash(String(password),12);
  const row={ id:hotelId, hotel_id:hotelId, name:finalName, hotel_name:finalName, city:cleanText(city||location||'Mombasa',80), location:cleanText(location||city||'Mombasa',100), email:finalEmail, phone:cleanText(phone||'',30), status:"PENDING", approved_by_admin:false, password_hash:hash };
  await supa.from("hotels").insert([row]); HOTEL_CACHE.time=0;
  return sendSuccess(res,{hotel_id:hotelId,status:"PENDING"});
 }catch(e){ return sendError(res,500,e.message); }
}
app.post("/api/hotels/signup", signupLimiter, handleHotelSignup);
app.post("/api/hotels/register", signupLimiter, handleHotelSignup);
app.post("/api/hotels", signupLimiter, handleHotelSignup);
app.post("/api/hotels/login", loginLimiter, async(req,res)=>{
  try{
    const {email,password,hotel_id}=req.body; const hid = (hotel_id||'').toUpperCase();
    let q = supa.from('hotels').select('*'); if(hid) q = q.or(`hotel_id.eq.${hid},id.eq.${hid}`); else q = q.eq('email', clean(email));
    const {data} = await q.maybeSingle(); if(!data) return sendError(res,404,"Hotel not found");
    if(password && data.password_hash){ const ok = await bcrypt.compare(String(password), data.password_hash); if(!ok) return sendError(res,401,"Wrong password"); }
    const token = jwt.sign({hotel_id:data.hotel_id||data.id, email:data.email, role:'hotel'}, JWT_SECRET, {expiresIn:'7d'});
    return sendSuccess(res,{token, hotel_id:data.hotel_id||data.id, hotel:data});
  }catch(e){ return sendError(res,500,e.message); }
});

app.post("/api/orders", orderLimiter, async(req,res)=>{
  try{
    const hid=getHotelIdFromReq(req);
    const payload={ hotel_id:hid, room_number:cleanText(req.body.room||req.body.room_number||'101',30), guest_name:cleanText(req.body.guest_name||'Guest',100), items:req.body.items||[], total:safeNumber(req.body.total||0), status:'pending', department:clean(req.body.department||'kitchen') };
    let data=payload; if(supa && REAL_URL){ try{ const {data:real}=await supa.schema('guesthub_os').from('orders').insert([payload]).select().single(); data=real; }catch{} }
    return sendSuccess(res,{order:data});
  }catch(e){ return sendError(res,500,e.message); }
});
app.get("/api/orders", async(req,res)=>{
  try{ const hid=getHotelIdFromReq(req); const {data}=await supa.schema('guesthub_os').from('orders').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}).limit(100); res.json({orders:data||[]}); }catch{ res.json({orders:[]}); }
});

// ===== VENDOR ALL FEATURES — FIXED SIGNUP WITH PASSWORD_HASH =====
app.post("/api/vendors/signup", signupLimiter, async (req, res) => {
  try {
    const b = req.body;
    const finalName = (b.vendor_name||b.name||b.full_name||"").trim();
    const email = clean(b.email||"");
    const password = String(b.password||"");
    const phone = String(b.phone||"").replace(/\D/g,"");
    if (!finalName || !phone || !email) return sendError(res, 400, "Name, phone & email required");
    if (!isValidEmail(email)) return sendError(res,400,"Invalid email");
    if (password.length < 8) return sendError(res,400,"Password min 8");
    if(supa && REAL_URL){
      const {data:exists} = await supa.schema('guesthub_os').from('vendors').select('id').eq('email',email).maybeSingle();
      if(exists) return sendError(res,409,"Email exists — login or Reset Password to 12345678");
    }
    const hash = await bcrypt.hash(password, 12);
    const vendorId = (finalName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) + Date.now().toString().slice(-4));
    const finalHotels = b.hotels || b.hotel_ids || ["ALL"];
    const isAll = finalHotels.includes("ALL");
    const servicesArr = Array.isArray(b.services)? b.services : [b.category||"general"];
    const vendorRow = {
      id: vendorId, vendor_name: finalName, full_name: b.full_name||finalName, category: b.category||servicesArr[0]||"services",
      location: b.location||b.location_hub||"Diani", city: b.city||"Diani", country: b.country||"Kenya",
      phone, email, id_number: b.id_number||"", hotel_ids: isAll? ["ALL"]: finalHotels, services: servicesArr,
      price: safeNumber(b.price,2500), mpesa: b.mpesa||phone, payout_method: b.payout_method||"mpesa",
      bio: b.bio||"", status: 'pending', is_active: true, is_available: true, password_hash: hash, created_at: new Date().toISOString()
    };
    if(supa && REAL_URL){
      try{ await supa.schema('guesthub_os').from('vendors').insert([vendorRow]); }catch(e){ console.log("guesthub err", e.message); }
      try{ await supa.from('vendors').insert([{...vendorRow, owner_id:null}]); }catch{}
      setImmediate(async ()=>{
        try{
          let targetHotels = finalHotels;
          if(isAll){ const {data: allH} = await supa.from('hotels').select('hotel_id').eq('status','APPROVED').limit(1000); targetHotels = (allH||[]).map(h=>h.hotel_id); }
          const rows = [];
          for(const hidRaw of targetHotels.slice(0,1000)){
            const hid = String(hidRaw).toUpperCase();
            for(const svc of servicesArr.slice(0,5)){
              const title = typeof svc==='string' ? svc : svc.name||svc.title||"Service";
              rows.push({ hotel_id: hid, title: `${title} — ${finalName}`, price: vendorRow.price, description: `${vendorRow.location} • by ${finalName}`, department: 'services', icon: '✨', vendor_name: finalName, vendor_phone: phone, vendor_id: vendorId, is_active: false });
            }
          }
          for(let i=0;i<rows.length;i+=100){ await supa.schema('guesthub_os').from('hotel_services').insert(rows.slice(i,i+100)); await new Promise(r=>setTimeout(r,50)); }
        }catch(e){ console.log("scale err", e.message); }
      });
    }
    return sendSuccess(res, { vendor_id: vendorId, email, scaling:true, message: `Vendor ${finalName} created — pending GM approval` });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.post("/api/vendors/login", loginLimiter, async (req,res)=>{
  try{
    const email = clean(req.body.email||""); const password = String(req.body.password||"");
    if(!email || !password) return sendError(res,400,"Email & password required");
    let {data:vendor} = await supa.schema('guesthub_os').from('vendors').select('*').eq('email', email).maybeSingle();
    if(!vendor){ const {data} = await supa.from('vendors').select('*').eq('email', email).maybeSingle(); vendor = data; }
    if(!vendor) return sendError(res,404,"Vendor not found — signup first");
    if(vendor.password_hash){ const ok = await bcrypt.compare(password, vendor.password_hash); if(!ok) return sendError(res,401,"Wrong password — try Reset"); }
    else { 
      // ADVICE: Old account without hash — auto-fix if 12345678
      if(password === "12345678"){ const hash = await bcrypt.hash(password, 12); await supa.schema('guesthub_os').from('vendors').update({password_hash: hash}).eq('id', vendor.id); try{ await supa.from('vendors').update({password_hash: hash}).eq('id', vendor.id); }catch{} }
      else return sendError(res,401,"Old account — click Reset Password to set 12345678"); 
    }
    const token = jwt.sign({vendor_id: vendor.id, email: vendor.email, role:'vendor'}, JWT_SECRET, {expiresIn:'7d'});
    return sendSuccess(res, {token, vendor});
  }catch(e){ return sendError(res,500,e.message); }
});

app.post("/api/vendors/forgot-password", async (req,res)=>{
  try{
    const email = clean(req.body.email||""); const newPass = String(req.body.password||"12345678");
    if(!email) return sendError(res,400,"Email required");
    const hash = await bcrypt.hash(newPass, 12); let updated=false;
    try{ const {data}=await supa.schema('guesthub_os').from('vendors').update({password_hash:hash}).eq('email',email).select().maybeSingle(); if(data) updated=true; }catch{}
    try{ const {data}=await supa.from('vendors').update({password_hash:hash}).eq('email',email).select().maybeSingle(); if(data) updated=true; }catch{}
    if(!updated) return sendError(res,404,"Email not found — signup first");
    return sendSuccess(res, {message:"Password reset to "+newPass+" — now login"});
  }catch(e){ return sendError(res,500,e.message); }
});

app.get("/api/vendors", async (req,res)=>{
  try{
    const hid=getHotelIdFromReq(req);
    const cached=SERVICE_CACHE.get(hid);
    if(cached && Date.now()-cached.time<30000) return res.json(cached.data);
    const {data:vendors}=await supa.schema('guesthub_os').from('vendors').select('*').or(`hotel_ids.cs.{${hid}},hotel_ids.cs.{ALL}`).eq('status','approved').limit(100);
    const {data:services}=await supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id',hid).eq('is_active',true).limit(150);
    const result={vendors:vendors||[], services:services||[]};
    SERVICE_CACHE.set(hid,{data:result,time:Date.now()});
    res.json(result);
  }catch{ res.json({vendors:[], services:[]}); }
});

app.get("/api/hotel-services", async (req,res)=>{
  try{ const hid=(req.query.hotel_id||getHotelIdFromReq(req)||"BAOBAB").toUpperCase(); const {data}=await supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id',hid).eq('is_active',true).limit(200); res.json({hotel_id:hid, services:data||[]}); }catch{ res.json({services:[]}); }
});

app.get("/api/vendor/me", async (req,res)=>{
  try{ const token=verifyToken(req); if(!token) return sendError(res,401,"No token"); let q=supa.schema('guesthub_os').from('vendors').select('*'); if(token.vendor_id) q=q.eq('id',token.vendor_id); else q=q.eq('email',clean(token.email)); const {data}=await q.maybeSingle(); return sendSuccess(res,{vendor:data}); }catch(e){ return sendError(res,500,e.message); }
});

// ADMIN — UNALIGNMENT SAFE
app.get("/api/admin/vendors", async (req,res)=>{
  try{
    if(!supa) return res.json({vendors:[]});
    let all=[];
    try{ const {data}=await supa.schema('guesthub_os').from('vendors').select('*').order('created_at',{ascending:false}).limit(200); all=data||[]; }catch{}
    if(all.length===0){ try{ const {data}=await supa.from('vendors').select('*').order('created_at',{ascending:false}).limit(200); all=data||[]; }catch{} }
    // Remove duplicates by email
    const seen=new Set(); const unique=[]; for(const v of all){ const key=(v.email||v.id).toLowerCase(); if(!seen.has(key)){ seen.add(key); unique.push(v);} }
    res.json({vendors:unique});
  }catch{ res.json({vendors:[]}); }
});
app.post("/api/admin/vendors/:id/approve", async (req,res)=>{
  try{
    const id=req.params.id; const {status}=req.body||{};
    if(status==='rejected'){ await supa.schema('guesthub_os').from('vendors').update({status:'rejected',is_active:false}).eq('id',id); await supa.schema('guesthub_os').from('hotel_services').update({is_active:false}).eq('vendor_id',id); SERVICE_CACHE.clear(); return res.json({ok:true,status:'rejected'}); }
    await supa.schema('guesthub_os').from('vendors').update({is_active:true,status:'approved',is_available:true,commission_locked:false}).eq('id',id);
    try{ await supa.from('vendors').update({status:'approved'}).eq('id',id); }catch{}
    await supa.schema('guesthub_os').from('hotel_services').update({is_active:true}).eq('vendor_id',id);
    SERVICE_CACHE.clear(); res.json({ok:true,status:'approved'});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});
app.delete("/api/admin/vendors/:id", async (req,res)=>{ try{ await supa.schema('guesthub_os').from('vendors').delete().eq('id',req.params.id); await supa.schema('guesthub_os').from('hotel_services').delete().eq('vendor_id',req.params.id); SERVICE_CACHE.clear(); res.json({ok:true}); }catch{ res.status(500).json({ok:false}); } });

app.get("/api/admin/hotels", async (req,res)=>{ try{ const {data}=await supa.from('hotels').select('*').order('created_at',{ascending:false}).limit(1000); res.json({hotels:data||[]}); }catch{ res.json({hotels:[]}); } });
app.get("/api/admin/hotels-pending", async (req,res)=>{ try{ const {data}=await supa.from('hotels').select('*').order('created_at',{ascending:false}).limit(1000); res.json({hotels:data||[]}); }catch{ res.json({hotels:[]}); } });
app.post("/api/admin/hotels/:id/approve", async (req,res)=>{ try{ const hid=req.params.id.toUpperCase(); await supa.from('hotels').update({status:'APPROVED',approved_by_admin:true}).or(`hotel_id.eq.${hid},id.eq.${hid}`); HOTEL_CACHE.time=0; res.json({ok:true}); }catch(e){ res.status(500).json({ok:false}); } });
app.delete("/api/admin/hotels/:id", async (req,res)=>{ try{ const hid=req.params.id.toUpperCase(); await supa.from('hotels').delete().or(`hotel_id.eq.${hid},id.eq.${hid}`); HOTEL_CACHE.time=0; res.json({ok:true}); }catch{ res.status(500).json({ok:false}); } });

// COMMISSION (Till 123456) — Keep your original logic
app.get("/api/vendor/commission", async (req,res)=>{ res.json({commission:0, till:GUESTHUB_TILL, locked:false, advice:"Pay via Till 123456"}); });

// STATIC
app.use(express.static(path.join(__dirname,"public"),{ setHeaders:(res,fp)=>{ if(fp.endsWith('.html')) res.setHeader('Cache-Control','no-cache'); } }));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,"public","index.html"), err=>{ if(err) res.status(200).send(`<h1>V33 FINAL LIVE</h1><a href="/api/health">health</a>`); }));
