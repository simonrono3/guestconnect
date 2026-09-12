// GuestHub V33 SCALE PROFESSIONAL — 1000 Hotels + Commission Till + Secure + ADMIN FIX
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

// ===== CACHE FOR 1000 HOTELS — HII NDIO SIRI MKUU — DEFINE EARLY =====
let HOTEL_CACHE = { data: [], time: 0 };
let SERVICE_CACHE = new Map();

// ===== PORT OPEN FIRST FOR RENDER =====
app.get('/api/health',(req,res)=>res.json({ok:true, os:'V33 SCALE 1000 HOTELS', port:PORT, hasUrl:!!process.env.SUPABASE_URL, cache: HOTEL_CACHE.data.length, time:new Date().toISOString()}));
app.get('/config.js',(req,res)=>{
  res.type('application/javascript');
  res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
  const u = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
  const k = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-key';
  res.send(`const SUPABASE_URL="${u}";const SUPABASE_KEY="${k}";window.SUPABASE_URL="${u}";window.SUPABASE_KEY="${k}";window.SUPABASE_ANON_KEY="${k}";`);
});

const server = app.listen(PORT, '0.0.0.0', ()=>console.log(`🔒 V33 SCALE LIVE on ${PORT}`));
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
process.on('uncaughtException', e=>console.log('UNCAUGHT:', e.message));
process.on('unhandledRejection', e=>console.log('REJECTION:', e?.message));

// ===== SECURITY =====
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({origin:(o,cb)=>cb(null,true), credentials:true, methods:['GET','POST','PUT','DELETE','OPTIONS']}));
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true, limit:"2mb"}));

const loginLimiter = rateLimit({ windowMs:15*60*1000, max:10, message:{ok:false,error:"Too many login attempts"} });
const signupLimiter = rateLimit({ windowMs:60*60*1000, max:50, message:{ok:false,error:"Too many signups"} });
const orderLimiter = rateLimit({ windowMs:60*1000, max:120, message:{ok:false,error:"Too many orders"} });

// ===== CONFIG — ENV ONLY =====
const REAL_URL = process.env.SUPABASE_URL;
const REAL_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const REAL_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_URL = REAL_URL || "https://placeholder.supabase.co";
const SUPABASE_KEY = REAL_KEY || "placeholder-anon-key";
const SUPABASE_SERVICE_KEY = REAL_SERVICE || REAL_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_OS_2026_SECURE_KEY_CHANGE_ME_IN_RENDER";

const GUESTHUB_TILL = {
  till_number: process.env.TILL_NUMBER || "123456",
  paybill: process.env.PAYBILL_NUMBER || "522522",
  account_number: process.env.TILL_ACCOUNT || "1234567",
  business_name: "GuestHub Ltd",
  lipa_na_mpesa_name: "GuestHub"
};

let supa = null;
try { 
  supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {auth:{persistSession:false, autoRefreshToken:false}}); 
  console.log("✅ Supabase V33", !!REAL_URL); 
} catch(e){ console.log("⚠️ Supabase dummy", e.message); }

// ===== HELPERS =====
function clean(v){return String(v||"").trim().toLowerCase()}
function cleanText(v,m=500){ let s = String(v||"").trim().slice(0,m); s = s.replace(/[<>]/g,''); return s; }
function isValidEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)}
function safeNumber(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f}
function sendError(res,s,m){return res.status(s).json({ok:false,error:m})}
function sendSuccess(res,d={}){return res.json({ok:true,...d})}
function getBearer(req){const h=req.headers.authorization; if(h&&h.startsWith("Bearer ")) return h.slice(7); return null}
function verifyToken(req){const t=getBearer(req); if(!t) return null; try{return jwt.verify(t,JWT_SECRET)}catch{return null}}
function isAdminToken(t){ return t && (t.role==='admin' || t.is_admin===true || t.email?.includes('admin')); }
function getHotelIdFromReq(req){
  const token=verifyToken(req);
  if(token?.hotel_id) return token.hotel_id.toUpperCase();
  return (req.query.hotel_id||req.body.hotel_id||req.headers['x-hotel-id']||'BAOBAB').toString().toUpperCase();
}

async function routeOrderToDepartment(order){
  try{
    const hotel_id=(order.hotel_id||'BAOBAB').toUpperCase();
    const dept=(order.department||'kitchen').toLowerCase();
    let waNumber='';
    if(supa && REAL_URL){
      try{ const {data}=await supa.schema('guesthub_os').from('departments').select('whatsapp_number').eq('hotel_id',hotel_id).eq('name',dept).maybeSingle(); waNumber=data?.whatsapp_number||''; }catch{}
      if(!waNumber){ try{ const {data:h}=await supa.from('hotels').select('phone').or(`hotel_id.eq.${hotel_id},id.eq.${hotel_id}`).maybeSingle(); waNumber=h?.phone||''; }catch{} }
    }
    const itemsStr=Array.isArray(order.items)?order.items.map(i=>`${i.name||i.title} x${i.qty||1}`).join(', '):'Order';
    const msg=`🔔 NEW ORDER ${dept.toUpperCase()} - ${hotel_id} - Room ${order.room_number} - ${order.guest_name} - ${itemsStr} - Ksh ${order.total}`;
    const waLink=waNumber?`https://wa.me/${String(waNumber).replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`:'';
    return {sent:!!waNumber,to:waNumber,waLink,msg};
  }catch{return {sent:false}}
}

// ===== HOTELS — CACHED FOR SCALE =====
app.get('/api/data', async (req,res)=>{
  try{
    if(Date.now() - HOTEL_CACHE.time < 60000 && HOTEL_CACHE.data.length){
      return res.json({hotels: HOTEL_CACHE.data, cached:true});
    }
    if(!supa ||!REAL_URL) return res.json({hotels:[{id:'BAOBAB',hotel_id:'BAOBAB',hotel_name:'Baobab Beach Resort'}]});
    const {data} = await supa.from('hotels').select("id,hotel_id,hotel_name,name,location,city,hotel_type,status").eq('status','APPROVED').limit(1000);
    HOTEL_CACHE = { data: data||[], time: Date.now() };
    res.json({hotels: data||[], cached:false});
  }catch(e){ res.json({hotels: HOTEL_CACHE.data || []}); }
});

async function handleSignup(req,res){
 try{
  const {hotel_name,name,email,phone,password,location,city,hotel_type,manager_name,rooms}=req.body;
  if(!password || String(password).length < 8) return sendError(res,400,"Password must be 8+");
  const finalName=cleanText(hotel_name||name||'Hotel',100);
  if(finalName.length<3) return sendError(res,400,"Hotel name too short");
  if(!supa ||!REAL_URL){ const hotelId=finalName.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10)+Math.floor(Math.random()*99); return sendSuccess(res,{hotel_id:hotelId,status:"PENDING"}); }
  const finalEmail=clean(email); if(!isValidEmail(finalEmail)) return sendError(res,400,"Invalid email");
  const base=finalName.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,12)||'hotel';
  const hotelId=base.toUpperCase()+(Math.floor(Math.random()*900)+100);
  const hash=await bcrypt.hash(String(password),12);
  const row={ id:hotelId, hotel_id:hotelId, name:finalName, hotel_name:finalName, city:cleanText(city||location||'Mombasa',80), location:cleanText(location||city||'Mombasa',100), hotel_type:cleanText(hotel_type||'Boutique',40), manager_name:cleanText(manager_name||'',100), rooms:safeNumber(rooms,30), email:finalEmail, phone:cleanText(phone||'',30), status:"PENDING", approved_by_admin:false, plan:"Upendo", price:6500, password_hash:hash };
  const {error}=await supa.from("hotels").insert([row]); if(error) throw new Error(error.message);
  HOTEL_CACHE.time = 0;
  return sendSuccess(res,{hotel_id:hotelId,status:"PENDING"});
 }catch(e){ return sendError(res,500,e.message); }
}
app.post("/api/hotels/signup", signupLimiter, handleSignup);
app.post("/api/hotels/register", signupLimiter, handleSignup);
app.post("/api/hotels", signupLimiter, handleSignup);

app.post("/api/hotels/login", loginLimiter, async(req,res)=>{
  try{
    const {email,password,hotel_id}=req.body;
    if(!supa ||!REAL_URL) return sendSuccess(res,{token:jwt.sign({hotel_id:'BAOBAB'},JWT_SECRET,{expiresIn:'7d'}), hotel_id:'BAOBAB'});
    const hid = (hotel_id||'').toUpperCase();
    let q = supa.from('hotels').select('*');
    if(hid) q = q.or(`hotel_id.eq.${hid},id.eq.${hid}`); else if(email) q = q.eq('email', clean(email));
    const {data} = await q.maybeSingle();
    if(!data) return sendError(res,404,"Hotel not found");
    if(password && data.password_hash){ const ok = await bcrypt.compare(String(password), data.password_hash); if(!ok) return sendError(res,401,"Wrong password"); }
    const token = jwt.sign({hotel_id:data.hotel_id||data.id, email:data.email, role: data.email?.includes('admin')?'admin':'hotel'}, JWT_SECRET, {expiresIn:'7d'});
    return sendSuccess(res,{token, hotel_id:data.hotel_id||data.id, hotel:data});
  }catch(e){ return sendError(res,500,e.message); }
});

app.post("/api/orders", orderLimiter, async(req,res)=>{
  try{
    const hid=getHotelIdFromReq(req);
    const payload={ hotel_id:hid, room_number:cleanText(req.body.room||req.body.room_number||'101',30), guest_name:cleanText(req.body.guest_name||'Guest',100), guest_phone:cleanText(req.body.guest_phone||'',30), items:req.body.items||[{name:'Order',qty:1}], total:safeNumber(req.body.total||0), status:'pending', department:clean(req.body.department||'kitchen'), location_label:`Room ${req.body.room||req.body.room_number} - ${req.body.guest_name}` };
    let data=payload;
    if(supa && REAL_URL){ try{ const {data:real,error}=await supa.schema('guesthub_os').from('orders').insert([payload]).select().single(); if(!error) data=real; }catch(err){} }
    const routing=await routeOrderToDepartment(data);
    return sendSuccess(res,{order:data,routing});
  }catch(e){ return sendError(res,500,e.message); }
});

app.get("/api/orders", async(req,res)=>{
  try{
    const hid=getHotelIdFromReq(req);
    if(!supa ||!REAL_URL) return res.json({orders:[]});
    const {data} = await supa.schema('guesthub_os').from('orders').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}).limit(100);
    res.json({orders:data||[]});
  }catch(e){ res.json({orders:[]}); }
});

// VENDOR OS — V33 SCALE
app.post("/api/vendors/signup", signupLimiter, async (req, res) => {
  try {
    const { vendor_name, name, category, location, location_hub, phone, email, hotels, hotel_ids, services, price, full_name } = req.body;
    const finalName = (vendor_name || name || full_name || "").trim();
    if (!finalName ||!phone) return sendError(res, 400, "Vendor name & phone required");
    const vendorId = (finalName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) + (Math.floor(Math.random() * 900) + 100));
    const finalHotels = hotels || hotel_ids || ["BAOBAB"];
    const isAll = finalHotels.includes("ALL");
    if(supa && REAL_URL){
      await supa.schema('guesthub_os').from('vendors').insert([{
        id: vendorId, vendor_name: finalName, full_name: finalName, category: category||"services",
        location: location||location_hub||"Diani", phone: String(phone).replace(/\D/g, ""),
        email: email || "", hotel_ids: isAll? ["ALL"] : finalHotels, is_active: true, status: 'pending', is_available: true
      }]);
      setImmediate(async ()=>{
        try{
          let targetHotels = finalHotels;
          if(isAll){
            const {data: allH} = await supa.from('hotels').select('hotel_id').eq('status','APPROVED').limit(1000);
            targetHotels = (allH||[]).map(h=>h.hotel_id);
          }
          const svcList = Array.isArray(services) && services.length ? services.map(s=> typeof s==='string'? {name:s} : s) : [{name: category||"Service"}];
          const rows = [];
          for(const hidRaw of targetHotels.slice(0,1000)){
            const hid = String(hidRaw).toUpperCase();
            for(const svc of svcList.slice(0,5)){
              rows.push({
                hotel_id: hid, title: `${svc.name||svc.title||"Service"} — ${finalName}`,
                price: Number(price||svc.price||2500), description: `${location||"Diani"} • by ${finalName} • ${phone}`,
                department: 'services', icon: '✨', vendor_name: finalName, vendor_phone: String(phone).replace(/\D/g,""), vendor_id: vendorId, is_active: true
              });
            }
          }
          for(let i=0;i<rows.length;i+=100){
            await supa.schema('guesthub_os').from('hotel_services').insert(rows.slice(i,i+100));
            await new Promise(r=>setTimeout(r,100));
          }
          console.log(`✅ SCALE: Vendor ${finalName} live in ${targetHotels.length} hotels`);
        }catch(e){ console.log("scale error:", e.message); }
      });
    }
    return sendSuccess(res, { vendor_id: vendorId, message: `Vendor ${finalName} live — scaling to ${isAll?'1000':finalHotels.length} hotels`, scaling:true });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.get("/api/vendors", async (req, res) => {
  try {
    const hotel_id = getHotelIdFromReq(req);
    const cached = SERVICE_CACHE.get(hotel_id);
    if(cached && Date.now()-cached.time < 30000) return res.json(cached.data);
    if (!supa ||!REAL_URL) return res.json({ vendors: [], services:[] });
    const { data: vendors } = await supa.schema('guesthub_os').from('vendors').select('*').or(`hotel_ids.cs.{${hotel_id}},hotel_ids.cs.{ALL}`).limit(100);
    const { data: services } = await supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id', hotel_id).eq('is_active', true).order('created_at',{ascending:false}).limit(150);
    const result = { vendors: vendors || [], services: services || [] };
    SERVICE_CACHE.set(hotel_id, {data: result, time: Date.now()});
    res.json(result);
  } catch (e) { res.json({ vendors: [], services:[] }); }
});

app.get("/api/hotel-services", async (req, res) => {
  try {
    const hotel_id = (req.query.hotel_id || getHotelIdFromReq(req) || "BAOBAB").toUpperCase();
    const cached = SERVICE_CACHE.get(hotel_id);
    if(cached && Date.now()-cached.time < 30000) return res.json({ hotel_id, services: cached.data.services||[], cached:true });
    if (!supa ||!REAL_URL) return res.json({ services: [] });
    const { data } = await supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id', hotel_id).eq('is_active', true).order('created_at',{ascending:false}).limit(200);
    res.json({ hotel_id, services: data || [] });
  } catch (e) { res.json({ services: [] }); }
});

app.delete("/api/hotel-services/:id", async (req, res) => {
  try {
    const hotel_id = getHotelIdFromReq(req);
    if (!supa) return sendError(res, 500, "No DB");
    await supa.schema('guesthub_os').from('hotel_services').delete().eq('id', req.params.id).eq('hotel_id', hotel_id);
    SERVICE_CACHE.delete(hotel_id);
    return sendSuccess(res, { deleted: true });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.get("/api/vendor/me", async (req,res)=>{
  try{
    const token=verifyToken(req); if(!token) return sendError(res,401,"No token");
    if(!supa) return sendError(res,500,"No DB");
    let q=supa.schema('guesthub_os').from('vendors').select('*');
    if(token.vendor_id||token.id) q=q.eq('id', token.vendor_id||token.id);
    else if(token.email) q=q.eq('email', clean(token.email));
    else return sendError(res,401,"Invalid token");
    const {data}=await q.maybeSingle();
    if(!data) return sendError(res,404,"Vendor not found");
    return sendSuccess(res,{vendor:data});
  }catch(e){ return sendError(res,500,e.message); }
});

app.get("/api/vendor/orders", async (req,res)=>{
  try{
    const token=verifyToken(req); if(!token) return sendError(res,401,"No token");
    if(!supa) return res.json({orders:[]});
    let vendor=null;
    if(token.vendor_id||token.id){
      const {data}=await supa.schema('guesthub_os').from('vendors').select('*').eq('id', token.vendor_id||token.id).maybeSingle(); vendor=data;
    } else if(token.email){
      const {data}=await supa.schema('guesthub_os').from('vendors').select('*').eq('email', clean(token.email)).maybeSingle(); vendor=data;
    }
    if(!vendor) return res.json({orders:[]});
    const vendorPhone=String(vendor.phone||'').replace(/\D/g,'').slice(-9);
    const {data:orders}=await supa.schema('guesthub_os').from('orders').select('*').or(`vendor_phone.ilike.%${vendorPhone}%`).order('created_at',{ascending:false}).limit(100);
    res.json({orders:orders||[]});
  }catch(e){ res.json({orders:[]}); }
});

app.get("/api/vendor/commission", async (req,res)=>{
  try{
    const token=verifyToken(req); if(!token) return sendError(res,401,"No token");
    if(!supa) return res.json({commission:0, till: GUESTHUB_TILL});
    let vendor=null;
    if(token.vendor_id||token.id){
      const {data}=await supa.schema('guesthub_os').from('vendors').select('*').eq('id', token.vendor_id||token.id).maybeSingle(); vendor=data;
    } else if(token.email){
      const {data}=await supa.schema('guesthub_os').from('vendors').select('*').eq('email', clean(token.email)).maybeSingle(); vendor=data;
    }
    if(!vendor) return res.json({commission:0, till: GUESTHUB_TILL});
    const now=new Date(); const twoWeeksAgo=new Date(now.getTime()-14*24*60*60*1000);
    const {data:orders}=await supa.schema('guesthub_os').from('orders').select('total').gte('created_at', twoWeeksAgo.toISOString()).limit(200);
    const totalSales=(orders||[]).reduce((a,b)=>a+Number(b.total||0),0);
    const commission=Math.round(totalSales*0.15);
    const {data:lastPay}=await supa.schema('guesthub_os').from('vendor_payments').select('*').eq('vendor_id', vendor.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
    let dueDate=new Date(new Date(vendor.created_at||now).getTime()+14*24*60*60*1000);
    if(lastPay && lastPay.status==='confirmed') dueDate=new Date(new Date(lastPay.created_at).getTime()+14*24*60*60*1000);
    const daysLeft=Math.ceil((dueDate - now)/(24*60*60*1000));
    const graceOver = daysLeft < -2;
    const shouldLock = commission>0 && graceOver && (!lastPay || lastPay.status!=='pending');
    if(shouldLock){
      await supa.schema('guesthub_os').from('vendors').update({is_active:false, commission_locked:true, commission_due:commission}).eq('id', vendor.id);
      await supa.schema('guesthub_os').from('hotel_services').update({is_active:false}).eq('vendor_id', vendor.id);
    }
    const {data:pendingPay}=await supa.schema('guesthub_os').from('vendor_payments').select('*').eq('vendor_id', vendor.id).eq('status','pending').order('created_at',{ascending:false}).limit(1).maybeSingle();
    res.json({ totalSales, commission, dueDate: dueDate.toISOString(), daysLeft, graceOver, locked: shouldLock || vendor.commission_locked, lastPayment: lastPay||null, pendingPayment: pendingPay||null, ordersCount: (orders||[]).length, till: GUESTHUB_TILL });
  }catch(e){ res.json({commission:0, till: GUESTHUB_TILL, locked:false}); }
});

app.post("/api/vendor/pay-commission", async (req,res)=>{
  try{
    const token=verifyToken(req); if(!token) return sendError(res,401,"No token");
    const {amount, mpesa_code, phone}=req.body;
    if(!mpesa_code) return sendError(res,400,"M-Pesa code required");
    let vendorId=token.vendor_id||token.id;
    if(!vendorId && token.email){
      const {data}=await supa.schema('guesthub_os').from('vendors').select('id').eq('email', clean(token.email)).maybeSingle(); vendorId=data?.id;
    }
    if(!vendorId) return sendError(res,404,"Vendor not found");
    const {data, error}=await supa.schema('guesthub_os').from('vendor_payments').insert([{
      vendor_id: vendorId, amount: Number(amount||0),
      mpesa_code: cleanText(mpesa_code,20).toUpperCase(), phone: phone||'',
      method: 'mpesa_till', status: 'pending', till_number: GUESTHUB_TILL.till_number
    }]).select().single();
    if(error) throw error;
    return sendSuccess(res,{pending:true, payment:data});
  }catch(e){ return sendError(res,500,e.message); }
});

app.get("/api/admin/commission-payments", async (req,res)=>{
  try{
    const {data}=await supa.schema('guesthub_os').from('vendor_payments').select('*').order('created_at',{ascending:false}).limit(100);
    res.json({payments:data||[], till: GUESTHUB_TILL});
  }catch(e){ res.json({payments:[]}); }
});

app.post("/api/admin/commission-payments/:id/confirm", async (req,res)=>{
  try{
    const {id}=req.params;
    const {data:pay}=await supa.schema('guesthub_os').from('vendor_payments').select('*').eq('id', id).maybeSingle();
    if(!pay) return sendError(res,404,"Payment not found");
    await supa.schema('guesthub_os').from('vendor_payments').update({status:'confirmed', confirmed_at:new Date().toISOString(), confirmed_by: 'admin'}).eq('id', id);
    await supa.schema('guesthub_os').from('vendors').update({is_active:true, commission_locked:false, commission_due:0, is_available:true}).eq('id', pay.vendor_id);
    await supa.schema('guesthub_os').from('hotel_services').update({is_active:true}).eq('vendor_id', pay.vendor_id);
    SERVICE_CACHE.clear();
    return sendSuccess(res,{confirmed:true});
  }catch(e){ return sendError(res,500,e.message); }
});

app.post("/api/admin/commission-payments/:id/reject", async (req,res)=>{
  try{
    await supa.schema('guesthub_os').from('vendor_payments').update({status:'rejected', reject_reason: req.body.reason||'Invalid'}).eq('id', req.params.id);
    return sendSuccess(res,{rejected:true});
  }catch(e){ return sendError(res,500,e.message); }
});

// ========================= V33 SCALE ADMIN — FIX FOR YOUR V19 DESIGN =========================
app.get("/api/admin/vendors", async (req,res)=>{
  try{
    if(!supa || !REAL_URL) return res.json({vendors:[]});
    const {data} = await supa.schema('guesthub_os').from('vendors').select('*').order('created_at',{ascending:false}).limit(200);
    res.json({vendors:data||[]});
  }catch(e){ res.json({vendors:[]}); }
});

app.post("/api/admin/vendors/:id/approve", async (req,res)=>{
  try{
    const id=req.params.id;
    const {status} = req.body || {};
    if(status && status.toLowerCase()==='rejected'){
      await supa.schema('guesthub_os').from('vendors').update({status:'rejected', is_active:false, is_available:false}).eq('id',id);
      await supa.schema('guesthub_os').from('hotel_services').update({is_active:false}).eq('vendor_id',id);
      SERVICE_CACHE.clear();
      return res.json({ok:true, status:'rejected'});
    }
    await supa.schema('guesthub_os').from('vendors').update({is_active:true,status:'approved',is_available:true,commission_locked:false,commission_due:0}).eq('id',id);
    await supa.schema('guesthub_os').from('hotel_services').update({is_active:true}).eq('vendor_id',id);
    SERVICE_CACHE.clear();
    res.json({ok:true, status:'approved'});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

app.delete("/api/admin/vendors/:id", async (req,res)=>{
  try{
    await supa.schema('guesthub_os').from('vendors').delete().eq('id',req.params.id);
    await supa.schema('guesthub_os').from('hotel_services').delete().eq('vendor_id',req.params.id);
    SERVICE_CACHE.clear();
    res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false}); }
});

app.get("/api/admin/hotels-pending", async (req,res)=>{
  try{
    if(!supa) return res.json({hotels:[]});
    const {data} = await supa.from('hotels').select('*').order('created_at',{ascending:false}).limit(1000);
    res.json({hotels:data||[]});
  }catch(e){ res.json({hotels:[]}); }
});

app.get("/api/admin/hotels", async (req,res)=>{
  try{
    if(!supa) return res.json({hotels:[]});
    const {data} = await supa.from('hotels').select('*').order('created_at',{ascending:false}).limit(1000);
    res.json({hotels:data||[]});
  }catch(e){ res.json({hotels:[]}); }
});

app.post("/api/admin/hotels/:id/approve", async (req,res)=>{
  try{
    const hid=req.params.id.toUpperCase();
    await supa.from('hotels').update({status:'APPROVED',approved_by_admin:true}).or(`hotel_id.eq.${hid},id.eq.${hid}`);
    HOTEL_CACHE.time=0;
    res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

app.delete("/api/admin/hotels/:id", async (req,res)=>{
  try{
    const hid=req.params.id.toUpperCase();
    await supa.from('hotels').delete().or(`hotel_id.eq.${hid},id.eq.${hid}`);
    HOTEL_CACHE.time=0;
    res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false}); }
});
// ========================= END ADMIN FIX =========================

// VENDOR LOGIN — V33 FIX FOR OLD VENDORS (owner_id NULL)
app.post("/api/vendors/login", loginLimiter, async (req,res)=>{
  try{
    const email = clean(req.body.email||"");
    const password = String(req.body.password||"");
    if(!email || !password) return sendError(res,400,"Email & password required");
    if(!supa || !REAL_URL) return sendError(res,404,"No DB");
    
    // 1. Tafuta kwa guesthub_os.vendors
    let {data:vendor} = await supa.schema('guesthub_os').from('vendors').select('*').eq('email', email).maybeSingle();
    // 2. Kama haipo, tafuta public.vendors
    if(!vendor){
      const {data} = await supa.from('vendors').select('*').eq('email', email).maybeSingle();
      vendor = data;
    }
    if(!vendor) return sendError(res,404,"Vendor not found — signup first");

    // 3. Check password_hash kama ipo, kama haipo allow reset flow
    if(vendor.password_hash){
      const ok = await bcrypt.compare(password, vendor.password_hash);
      if(!ok) return sendError(res,401,"Wrong password");
    } else {
      // Old vendor without password — auto-set kama user anaingiza 12345678
      if(password === "12345678"){
        const hash = await bcrypt.hash(password, 12);
        await supa.schema('guesthub_os').from('vendors').update({password_hash: hash}).eq('id', vendor.id);
        // also update public if exists
        try{ await supa.from('vendors').update({password_hash: hash}).eq('id', vendor.id); }catch{}
      } else {
        return sendError(res,401,"Old account — click Forgot Password and set to 12345678");
      }
    }

    const token = jwt.sign({vendor_id: vendor.id, email: vendor.email, role:'vendor'}, JWT_SECRET, {expiresIn:'7d'});
    return sendSuccess(res, {token, vendor, message:"Logged in"});
  }catch(e){ return sendError(res,500,e.message); }
});

app.post("/api/vendors/forgot-password", async (req,res)=>{
  try{
    const email = clean(req.body.email||"");
    const newPass = String(req.body.password||"12345678");
    if(!email) return sendError(res,400,"Email required");
    const hash = await bcrypt.hash(newPass, 12);
    let updated = false;
    try{
      const {data} = await supa.schema('guesthub_os').from('vendors').update({password_hash: hash}).eq('email', email).select().maybeSingle();
      if(data) updated = true;
    }catch{}
    try{
      const {data} = await supa.from('vendors').update({password_hash: hash}).eq('email', email).select().maybeSingle();
      if(data) updated = true;
    }catch{}
    if(!updated) return sendError(res,404,"Vendor email not found");
    return sendSuccess(res, {message:"Password reset to "+newPass+" — now login"});
  }catch(e){ return sendError(res,500,e.message); }
});



// STATIC
app.use(express.static(path.join(__dirname,"public"),{
  setHeaders:(res,fp)=>{
    if(fp.endsWith('.html')) res.setHeader('Cache-Control','no-cache');
    res.setHeader('X-Frame-Options','SAMEORIGIN');
  }
}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,"public","index.html"), err=>{ if(err) res.status(200).send(`<h1>🔒 V33 SCALE LIVE ${PORT}</h1><a href="/api/health">health</a>`); }));
