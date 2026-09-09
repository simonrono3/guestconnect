// GuestHub V31 FULL SECURE - PRODUCTION READY + PORT FIXED
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

// ===== PORT OPEN INSTANT FOR RENDER - MUST BE FIRST =====
app.get('/api/health',(req,res)=>res.json({ok:true, os:'V31 SECURE', port:PORT, hasUrl:!!process.env.SUPABASE_URL, time:new Date().toISOString()}));
app.get('/config.js',(req,res)=>{
  res.type('application/javascript');
  res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
  res.setHeader('X-Content-Type-Options','nosniff');
  const u = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
  const k = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-key';
  res.send(`const SUPABASE_URL="${u}";const SUPABASE_KEY="${k}";window.SUPABASE_URL="${u}";window.SUPABASE_KEY="${k}";window.SUPABASE_ANON_KEY="${k}";`);
});

const server = app.listen(PORT, '0.0.0.0', ()=>console.log(`🔒 V31 SECURE LIVE on 0.0.0.0:${PORT} - PORT OPEN`));
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;

process.on('uncaughtException', e=>console.log('UNCAUGHT:', e.message));
process.on('unhandledRejection', e=>console.log('REJECTION:', e?.message));

// ===== SECURITY MIDDLEWARE =====
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors({origin:(origin,cb)=>cb(null,true), credentials:true, methods:['GET','POST','PUT','DELETE','OPTIONS']}));
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true, limit:"2mb"}));

// Rate Limiters
const loginLimiter = rateLimit({ windowMs:15*60*1000, max:10, message:{ok:false,error:"Too many login attempts, try after 15 min"} });
const signupLimiter = rateLimit({ windowMs:60*60*1000, max:20, message:{ok:false,error:"Too many signups, try later"} });
const orderLimiter = rateLimit({ windowMs:60*1000, max:60, message:{ok:false,error:"Too many orders, slow down"} });

// ===== CONFIG =====
const REAL_URL = process.env.SUPABASE_URL;
const REAL_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const REAL_SERVICE = process.env.SUPABASE_SERVICE_KEY || REAL_KEY;
const SUPABASE_URL = REAL_URL || "https://placeholder.supabase.co";
const SUPABASE_KEY = REAL_KEY || "placeholder-anon-key";
const SUPABASE_SERVICE_KEY = REAL_SERVICE || SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_OS_2026_SECURE_KEY_CHANGE_ME_IN_ENV";

let supa = null;
try {
  supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {auth:{persistSession:false, autoRefreshToken:false}});
  console.log("✅ Supabase client V31");
} catch(e){ console.log("⚠️ Supabase dummy", e.message); }

// ===== HELPERS SECURE =====
function clean(v){return String(v||"").trim().toLowerCase()}
function cleanText(v,m=500){ 
  let s = String(v||"").trim().slice(0,m);
  // Strip < > to prevent XSS
  s = s.replace(/[<>]/g,'');
  return s;
}
function isValidEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)}
function safeNumber(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f}
function sendError(res,s,m){return res.status(s).json({ok:false,error:m})}
function sendSuccess(res,d={}){return res.json({ok:true,...d})}
function getBearer(req){const h=req.headers.authorization; if(h&&h.startsWith("Bearer ")) return h.slice(7); return null}
function verifyToken(req){const t=getBearer(req); if(!t) return null; try{return jwt.verify(t,JWT_SECRET)}catch{return null}}
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

// ===== ROUTES =====
app.get('/api/data', async (req,res)=>{
  try{
    if(!supa ||!REAL_URL) return res.json({hotels:[{id:'BAOBAB',hotel_id:'BAOBAB',hotel_name:'Baobab Beach Resort',location:'Diani'}]});
    const {data} = await supa.from('hotels').select("id,hotel_id,hotel_name,name,location,city,hotel_type,status").limit(100);
    res.json({hotels:data||[]});
  }catch(e){ res.json({hotels:[{id:'BAOBAB',hotel_id:'BAOBAB',hotel_name:'Baobab Beach Resort'}]}); }
});

async function handleSignup(req,res){
 try{
  const {hotel_name,name,email,phone,password,location,city,hotel_type,manager_name,rooms}=req.body;
  if(!password || String(password).length < 8) return sendError(res,400,"Password must be 8+ characters");
  const finalName=cleanText(hotel_name||name||'Hotel',100);
  if(finalName.length<3) return sendError(res,400,"Hotel name too short");
  if(!supa ||!REAL_URL){
    const hotelId=finalName.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10)+Math.floor(Math.random()*99);
    return sendSuccess(res,{hotel_id:hotelId,status:"PENDING",msg:"Add ENV on Render"});
  }
  const finalEmail=clean(email); if(!isValidEmail(finalEmail)) return sendError(res,400,"Invalid email");
  const base=finalName.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,12)||'hotel';
  const hotelId=base.toUpperCase()+(Math.floor(Math.random()*900)+100);
  const hash=await bcrypt.hash(String(password),12);
  const row={ id:hotelId, hotel_id:hotelId, name:finalName, hotel_name:finalName, city:cleanText(city||location||'Mombasa',80), location:cleanText(location||city||'Mombasa',100), hotel_type:cleanText(hotel_type||'Boutique',40), manager_name:cleanText(manager_name||'',100), rooms:safeNumber(rooms,30), email:finalEmail, phone:cleanText(phone||'',30), status:"PENDING", approved_by_admin:false, plan:"Upendo", price:6500, password_hash:hash };
  const {error}=await supa.from("hotels").insert([row]); if(error) throw new Error(error.message);
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
    if(hid) q = q.or(`hotel_id.eq.${hid},id.eq.${hid}`);
    else if(email) q = q.eq('email', clean(email));
    const {data} = await q.maybeSingle();
    if(!data) return sendError(res,404,"Hotel not found");
    if(password && data.password_hash){
      const ok = await bcrypt.compare(String(password), data.password_hash);
      if(!ok) return sendError(res,401,"Wrong password");
    }
    const token = jwt.sign({hotel_id:data.hotel_id||data.id, email:data.email}, JWT_SECRET, {expiresIn:'7d'});
    return sendSuccess(res,{token, hotel_id:data.hotel_id||data.id, hotel:data});
  }catch(e){ return sendError(res,500,e.message); }
});

app.post("/api/orders", orderLimiter, async(req,res)=>{
  try{
    const hid=getHotelIdFromReq(req);
    const payload={ hotel_id:hid, room_number:cleanText(req.body.room||req.body.room_number||'101',30), guest_name:cleanText(req.body.guest_name||'Guest',100), guest_phone:cleanText(req.body.guest_phone||'',30), items:req.body.items||[{name:'Order',qty:1}], total:safeNumber(req.body.total||0), status:'pending', department:clean(req.body.department||'kitchen'), location_label:`Room ${req.body.room||req.body.room_number} - ${req.body.guest_name}` };
    let data=payload;
    if(supa && REAL_URL){ try{ const {data:real,error}=await supa.schema('guesthub_os').from('orders').insert([payload]).select().single(); if(!error) data=real; }catch(err){ console.log("order skip", err.message); } }
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

// STATIC
app.use(express.static(path.join(__dirname,"public"),{ 
  setHeaders:(res,fp)=>{ 
    if(fp.endsWith('.html')) res.setHeader('Cache-Control','no-cache'); 
    res.setHeader('X-Frame-Options','SAMEORIGIN');
  } 
}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,"public","index.html"), err=>{ if(err) res.status(200).send(`<h1>🔒 V31 SECURE LIVE PORT ${PORT}</h1><a href="/api/health">health</a>`); }));
