// GuestHub V34 OS — PERMANENT FLOW — GM Approves → Guest Sees
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

let HOTEL_CACHE = { data: [], time: 0 };
let SERVICE_CACHE = new Map();

app.get('/api/health',(req,res)=>res.json({ok:true, os:'V34 OS FLOW', port:PORT, time:new Date().toISOString()}));
app.get('/config.js',(req,res)=>{
  res.type('application/javascript');
  const u = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
  const k = process.env.SUPABASE_KEY || 'placeholder-key';
  res.send(`const SUPABASE_URL="${u}";const SUPABASE_KEY="${k}";`);
});

const server = app.listen(PORT,'0.0.0.0',()=>console.log(`🔒 V34 OS LIVE ${PORT}`));
app.use(helmet({contentSecurityPolicy:false})); app.use(compression());
app.use(cors({origin:(o,cb)=>cb(null,true), credentials:true}));
app.use(express.json({limit:"2mb"})); app.use(express.urlencoded({extended:true}));

const loginLimiter = rateLimit({windowMs:15*60*1000,max:20});
const signupLimiter = rateLimit({windowMs:60*60*1000,max:100});

const REAL_URL = process.env.SUPABASE_URL;
const REAL_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY || REAL_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_OS_2026_SECURE";

let supa=null; try{supa=createClient(REAL_URL,SERVICE,{auth:{persistSession:false}})}catch{}

const clean=v=>String(v||"").trim().toLowerCase();
const cleanText=(v,m=500)=>String(v||"").trim().slice(0,m).replace(/[<>]/g,'');
const isValidEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const safeNumber=(v,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f;}
const sendError=(res,s,m)=>res.status(s).json({ok:false,error:m});
const sendSuccess=(res,d={})=>res.json({ok:true,...d});
const verifyToken=req=>{const h=req.headers.authorization; if(!h) return null; const t=h.startsWith("Bearer ")?h.slice(7):h; try{return jwt.verify(t,JWT_SECRET)}catch{return null}};
const getHotelId=req=>{const tk=verifyToken(req); if(tk?.hotel_id) return tk.hotel_id.toUpperCase(); return (req.query.hotel_id||req.body.hotel_id||req.headers['x-hotel-id']||'BAOBAB').toString().toUpperCase();};

// === 1. HOTELS ===
app.get('/api/data', async (req,res)=>{
  try{
    if(Date.now()-HOTEL_CACHE.time<60000 && HOTEL_CACHE.data.length) return res.json({hotels:HOTEL_CACHE.data,cached:true});
    const {data}=await supa.from('hotels').select("id,hotel_id,hotel_name,name,location,city,status").eq('status','APPROVED').limit(1000);
    HOTEL_CACHE={data:data||[],time:Date.now()}; res.json({hotels:data||[]});
  }catch{res.json({hotels:HOTEL_CACHE.data||[]})}
});

app.post("/api/hotels/signup", signupLimiter, async(req,res)=>{
  try{
    const {hotel_name,name,email,phone,password,location,city}=req.body;
    if(!password||password.length<8) return sendError(res,400,"Password 8+");
    const finalName=cleanText(hotel_name||name||'Hotel',100); const finalEmail=clean(email);
    if(!isValidEmail(finalEmail)) return sendError(res,400,"Invalid email");
    const hotelId=(finalName.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,12)||'hotel').toUpperCase()+(Math.floor(Math.random()*900)+100);
    const hash=await bcrypt.hash(String(password),12);
    await supa.from("hotels").insert([{id:hotelId,hotel_id:hotelId,name:finalName,hotel_name:finalName,city:cleanText(city||location||'Mombasa',80),location:cleanText(location||city||'Mombasa',100),email:finalEmail,phone:cleanText(phone||'',30),status:"PENDING",password_hash:hash}]);
    HOTEL_CACHE.time=0; return sendSuccess(res,{hotel_id:hotelId,status:"PENDING"});
  }catch(e){return sendError(res,500,e.message)}
});
app.post("/api/hotels/login", loginLimiter, async(req,res)=>{
  try{
    const {email,password,hotel_id}=req.body; const hid=(hotel_id||'').toUpperCase();
    let q=supa.from('hotels').select('*'); if(hid) q=q.or(`hotel_id.eq.${hid},id.eq.${hid}`); else q=q.eq('email',clean(email));
    const {data}=await q.maybeSingle(); if(!data) return sendError(res,404,"Hotel not found");
    if(data.password_hash){const ok=await bcrypt.compare(String(password),data.password_hash); if(!ok) return sendError(res,401,"Wrong password");}
    const token=jwt.sign({hotel_id:data.hotel_id||data.id,email:data.email,role:'hotel'},JWT_SECRET,{expiresIn:'7d'});
    return sendSuccess(res,{token,hotel_id:data.hotel_id||data.id,hotel:data});
  }catch(e){return sendError(res,500,e.message)}
});

// === 2. VENDORS — MASTER = guesthub_os.vendors ===
app.post("/api/vendors/signup", signupLimiter, async (req,res)=>{
  try{
    const b=req.body; const finalName=(b.vendor_name||b.name||"").trim(); const email=clean(b.email||"");
    const password=String(b.password||""); const phone=String(b.phone||"").replace(/\D/g,"");
    if(!finalName||!phone||!email) return sendError(res,400,"Name, phone & email required");
    if(!isValidEmail(email)) return sendError(res,400,"Invalid email"); if(password.length<8) return sendError(res,400,"Password min 8");
    const {data:exists}=await supa.schema('guesthub_os').from('vendors').select('id').eq('email',email).maybeSingle();
    if(exists) return sendError(res,409,"Email exists — login");
    const hash=await bcrypt.hash(password,12);
    const vendorId=(finalName.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8)+Date.now().toString().slice(-4));
    const vendorRow={id:vendorId,vendor_name:finalName,full_name:b.full_name||finalName,category:b.category||"services",location:b.location||"Diani",city:b.city||"Diani",phone,email,hotel_ids:["ALL"],services:Array.isArray(b.services)?b.services:[b.category||"general"],price:safeNumber(b.price,2500),status:'pending',is_active:true,is_available:true,password_hash:hash};
    await supa.schema('guesthub_os').from('vendors').insert([vendorRow]);
    // Create services inactive until GM approves
    setImmediate(async()=>{
      const {data:allH}=await supa.from('hotels').select('hotel_id').eq('status','APPROVED').limit(500);
      const rows=(allH||[]).map(h=>({hotel_id:h.hotel_id,title:`${vendorRow.services[0]} — ${finalName}`,price:vendorRow.price,department:'services',vendor_name:finalName,vendor_phone:phone,vendor_id:vendorId,is_active:false}));
      for(let i=0;i<rows.length;i+=100){await supa.schema('guesthub_os').from('hotel_services').insert(rows.slice(i,i+100))}
    });
    return sendSuccess(res,{vendor_id:vendorId,message:"Pending GM approval"});
  }catch(e){return sendError(res,500,e.message)}
});

// SINGLE LOGIN — FIXED (no duplicate)
app.post("/api/vendors/login", loginLimiter, async (req,res)=>{
  try{
    const email=clean(req.body.email||""); const password=String(req.body.password||"");
    if(!email||!password) return sendError(res,400,"Email & password required");
    const {data:vendor}=await supa.schema('guesthub_os').from('vendors').select('*').eq('email',email).maybeSingle();
    if(!vendor) return sendError(res,404,"Vendor not found — signup");
    if(vendor.password_hash){const ok=await bcrypt.compare(password,vendor.password_hash); if(!ok) return sendError(res,401,"Wrong password");}
    if(vendor.status==='pending') return res.json({ok:true,pending:true,vendor,message:"Pending GM approval"});
    const token=jwt.sign({vendor_id:vendor.id,email:vendor.email,role:'vendor'},JWT_SECRET,{expiresIn:'7d'});
    return sendSuccess(res,{token,vendor});
  }catch(e){return sendError(res,500,e.message)}
});

app.post("/api/vendors/forgot-password", async (req,res)=>{
  const email=clean(req.body.email||""); const newPass=String(req.body.password||"12345678");
  const hash=await bcrypt.hash(newPass,12);
  const {data}=await supa.schema('guesthub_os').from('vendors').update({password_hash:hash}).eq('email',email).select().maybeSingle();
  if(!data) return sendError(res,404,"Email not found"); return sendSuccess(res,{message:"Reset to "+newPass});
});

// === 3. GUEST SEES ONLY APPROVED + ACTIVE ===
app.get("/api/vendors", async (req,res)=>{
  try{
    const hid=getHotelId(req);
    const {data:vendors}=await supa.schema('guesthub_os').from('vendors').select('*').or(`hotel_ids.cs.{${hid}},hotel_ids.cs.{ALL}`).eq('status','approved').eq('is_active',true).limit(100);
    const {data:services}=await supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id',hid).eq('is_active',true).limit(150);
    res.json({vendors:vendors||[],services:services||[]});
  }catch{res.json({vendors:[],services:[]})}
});
app.get("/api/hotel-services", async (req,res)=>{
  try{const hid=(req.query.hotel_id||getHotelId(req)||"BAOBAB").toUpperCase(); const {data}=await supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id',hid).eq('is_active',true).limit(200); res.json({hotel_id:hid,services:data||[]});}catch{res.json({services:[]})}
});

// === 4. GM FLOW — GM CAN ADD/APPROVE VENDORS TO HIS HOTEL ===
app.get("/api/gm/vendors-pool", async (req,res)=>{
  try{
    const token=verifyToken(req); if(!token) return sendError(res,401,"No token");
    const {data:pool}=await supa.schema('guesthub_os').from('vendors').select('*').eq('status','approved').limit(100);
    const hid=getHotelId(req);
    const {data:myServices}=await supa.schema('guesthub_os').from('hotel_services').select('vendor_id').eq('hotel_id',hid).eq('is_active',true);
    const myIds=new Set((myServices||[]).map(s=>s.vendor_id));
    res.json({pool:pool||[], myVendorIds:[...myIds], hotel_id:hid});
  }catch(e){res.json({pool:[]})}
});
app.post("/api/gm/vendors/:vendorId/add", async (req,res)=>{
  try{
    const hid=getHotelId(req); const vendorId=req.params.vendorId;
    const {data:vendor}=await supa.schema('guesthub_os').from('vendors').select('*').eq('id',vendorId).maybeSingle();
    if(!vendor) return sendError(res,404,"Vendor not found");
    // Activate service for this hotel
    await supa.schema('guesthub_os').from('hotel_services').update({is_active:true}).eq('hotel_id',hid).eq('vendor_id',vendorId);
    // If not exists, create
    const {data:exists}=await supa.schema('guesthub_os').from('hotel_services').select('id').eq('hotel_id',hid).eq('vendor_id',vendorId).maybeSingle();
    if(!exists){
      await supa.schema('guesthub_os').from('hotel_services').insert([{hotel_id:hid,title:`${vendor.services?.[0]||'Service'} — ${vendor.vendor_name}`,price:vendor.price,department:'services',vendor_name:vendor.vendor_name,vendor_phone:vendor.phone,vendor_id:vendorId,is_active:true}]);
    }
    return sendSuccess(res,{message:`${vendor.vendor_name} added to ${hid}`});
  }catch(e){return sendError(res,500,e.message)}
});
app.post("/api/gm/vendors/:vendorId/remove", async (req,res)=>{
  const hid=getHotelId(req); await supa.schema('guesthub_os').from('hotel_services').update({is_active:false}).eq('hotel_id',hid).eq('vendor_id',req.params.vendorId); res.json({ok:true});
});

// === 5. ADMIN ===
app.get("/api/admin/vendors", async (req,res)=>{const {data}=await supa.schema('guesthub_os').from('vendors').select('*').order('created_at',{ascending:false}).limit(200); res.json({vendors:data||[]})});
app.post("/api/admin/vendors/:id/approve", async (req,res)=>{
  const id=req.params.id;
  if(req.body?.status==='rejected'){await supa.schema('guesthub_os').from('vendors').update({status:'rejected',is_active:false}).eq('id',id); await supa.schema('guesthub_os').from('hotel_services').update({is_active:false}).eq('vendor_id',id);}
  else {await supa.schema('guesthub_os').from('vendors').update({status:'approved',is_active:true,is_available:true}).eq('id',id); await supa.schema('guesthub_os').from('hotel_services').update({is_active:true}).eq('vendor_id',id);}
  res.json({ok:true});
});
app.get("/api/admin/hotels", async (req,res)=>{const {data}=await supa.from('hotels').select('*').order('created_at',{ascending:false}).limit(1000); res.json({hotels:data||[]})});
app.post("/api/admin/hotels/:id/approve", async (req,res)=>{const hid=req.params.id.toUpperCase(); await supa.from('hotels').update({status:'APPROVED',approved_by_admin:true}).or(`hotel_id.eq.${hid},id.eq.${hid}`); HOTEL_CACHE.time=0; res.json({ok:true})});

// ORDERS
app.post("/api/orders", async(req,res)=>{const hid=getHotelId(req); const payload={hotel_id:hid,room_number:cleanText(req.body.room||'101',30),guest_name:cleanText(req.body.guest_name||'Guest',100),items:req.body.items||[],total:safeNumber(req.body.total||0),status:'pending'}; const {data}=await supa.schema('guesthub_os').from('orders').insert([payload]).select().single(); res.json({ok:true,order:data})});

app.use(express.static(path.join(__dirname,"public")));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
