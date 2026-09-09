// GuestHub V22 FINAL - PORT FIX + FULL OS 18.0 + CONFIG.JS - NEVER CRASH
import express from "express";
import compression from "compression";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 10000);
console.log("🚀 Starting V22 on", PORT);

const REAL_URL = process.env.SUPABASE_URL;
const REAL_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const REAL_SERVICE = process.env.SUPABASE_SERVICE_KEY || REAL_KEY;

const SUPABASE_URL = REAL_URL || "https://placeholder.supabase.co";
const SUPABASE_KEY = REAL_KEY || "placeholder-anon-key";
const SUPABASE_SERVICE_KEY = REAL_SERVICE || SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_OS_2026_SECURE";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

let supa;
try {
  supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {auth:{persistSession:false, autoRefreshToken:false}});
  console.log("✅ Supabase client OK:", SUPABASE_URL.substring(0,30));
} catch(e){
  console.log("⚠️ Supabase fail, dummy mode:", e.message);
  supa = null;
}

const app = express();
app.set('trust proxy', 1);
app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:false, crossOriginEmbedderPolicy:false}));
app.use(compression());
app.use(cors({origin:()=>true, credentials:true}));
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true, limit:"2mb"}));
app.use("/api/", rateLimit({windowMs:60*1000, max:600}));

// ===== CONFIG.JS - MUST BE BEFORE STATIC =====
app.get('/config.js',(req,res)=>{
  res.type('application/javascript');
  res.setHeader('Cache-Control','no-cache');
  const url = process.env.SUPABASE_URL || SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || SUPABASE_KEY;
  res.send(`
const SUPABASE_URL="${url}";
const SUPABASE_KEY="${key}";
window.SUPABASE_URL="${url}";
window.SUPABASE_KEY="${key}";
window.SUPABASE_ANON_KEY="${key}";
console.log("✅ Config loaded", "${url}".slice(0,30));
`);
});

app.get('/api/health',(req,res)=>res.json({
  ok:true, os:'V22 FINAL PORT-FIXED', 
  port:PORT, 
  hasRealUrl:!!REAL_URL, 
  hasRealKey:!!REAL_KEY,
  time:new Date().toISOString()
}));

app.get('/api/data', async (req,res)=>{
  try{
    if(!supa || !REAL_URL) return res.json({hotels:[{id:'BAOBAB',hotel_id:'BAOBAB',hotel_name:'Baobab Beach Resort',location:'Diani',city:'Diani',hotel_type:'Beach'}]});
    const {data} = await supa.from('hotels').select("id,hotel_id,hotel_name,name,location,city,hotel_type").limit(50);
    res.json({hotels:data||[]});
  }catch(e){ res.json({hotels:[{id:'BAOBAB',hotel_id:'BAOBAB',hotel_name:'Baobab Beach Resort'}]}); }
});

// HELPERS
function clean(v){return String(v||"").trim().toLowerCase()}
function cleanText(v,m=500){return String(v||"").trim().slice(0,m)}
function isValidEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)}
function safeNumber(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f}
function sendError(res,s,m){return res.status(s).json({ok:false,error:m})}
function sendSuccess(res,d={}){return res.json({ok:true,...d})}
function createToken(p){return jwt.sign(p,JWT_SECRET,{expiresIn:"12h"})}
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

// SIGNUP
app.post("/api/hotels/signup", async(req,res)=>{
 try{
  const {hotel_name,name,email,phone,password,location,city,hotel_type,manager_name,rooms}=req.body;
  const finalName=cleanText(hotel_name||name||'Hotel',100);
  if(finalName.length<3) return sendError(res,400,"Hotel name short");
  if(!supa || !REAL_URL){
    const hotelId=finalName.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10)+Math.floor(Math.random()*99);
    return sendSuccess(res,{hotel_id:hotelId,status:"PENDING",msg:"Dummy - add ENV"});
  }
  const finalEmail=clean(email);
  if(!isValidEmail(finalEmail)) return sendError(res,400,"Bad email");
  const base=finalName.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,12)||'hotel';
  const hotelId=base.toUpperCase()+(Math.floor(Math.random()*900)+100);
  const hash=await bcrypt.hash(String(password||'12345678'),10);
  const row={ id:hotelId, hotel_id:hotelId, name:finalName, hotel_name:finalName, city:cleanText(city||location||'Mombasa',80), location:cleanText(location||city||'Mombasa',100), hotel_type:cleanText(hotel_type||'Boutique',40), manager_name:cleanText(manager_name||'',100), rooms:safeNumber(rooms,30), email:finalEmail, phone:cleanText(phone||'',30), status:"PENDING", approved_by_admin:false, plan:"Upendo", price:6500, password_hash:hash };
  const {error}=await supa.from("hotels").insert([row]); if(error) throw new Error(error.message);
  return sendSuccess(res,{hotel_id:hotelId,status:"PENDING"});
 }catch(e){ return sendError(res,500,e.message); }
});
app.post("/api/hotels/register",(req,res)=>{ req.url="/api/hotels/signup"; app.handle(req,res); });

// ORDERS
app.post("/api/orders", async(req,res)=>{
  try{
    const hid=getHotelIdFromReq(req);
    const payload={ hotel_id:hid, room_number:cleanText(req.body.room||req.body.room_number||'101',30), guest_name:cleanText(req.body.guest_name||'Guest',100), guest_phone:cleanText(req.body.guest_phone||'',30), items:req.body.items||[{name:'Order',qty:1}], total:safeNumber(req.body.total||0), status:'pending', department:clean(req.body.department||'kitchen'), location_label:`Room ${req.body.room||req.body.room_number} - ${req.body.guest_name}` };
    let data=payload;
    if(supa && REAL_URL){
      const {data:real,error}=await supa.schema('guesthub_os').from('orders').insert([payload]).select().single();
      if(error) throw error; data=real;
    }
    const routing=await routeOrderToDepartment(data);
    return sendSuccess(res,{order:data,routing});
  }catch(e){ return sendError(res,500,e.message); }
});

// STATIC
app.use(express.static(path.join(__dirname,"public"),{
  setHeaders:(res, fp)=>{ if(fp.endsWith('.html')) res.setHeader('Cache-Control','no-cache'); }
}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT, '0.0.0.0', ()=>{ console.log(`🚀 V22 FINAL LIVE on 0.0.0.0:${PORT} — PORT OPEN — NO MORE BLACK SCREEN`); });
