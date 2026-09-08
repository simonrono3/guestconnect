// GuestHub OS 18.0 — MERGED FINAL — ULTRA FAST + 1000+ SCALED + SECURED
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

// ===== SUPA — JUU KABISA — FIX YA Cannot access before initialization =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_OS_18_1000_SCALED_SECURED_2026";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if(!SUPABASE_URL ||!SUPABASE_KEY ||!SUPABASE_SERVICE_KEY){
  console.error("❌ Missing SUPABASE_URL / KEY / SERVICE_KEY in Render ENV");
  process.exit(1);
}
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});

const app = express();
const PORT = Number(process.env.PORT || 10000);
app.set('trust proxy', 1);
app.disable("x-powered-by");

// 1. SECURITY + SPEED
app.use(helmet({contentSecurityPolicy:false, crossOriginEmbedderPolicy:false}));
app.use(compression()); // <-- FIX YA SLOW — 70% smaller
app.use(cors({origin:()=>true,credentials:true}));
app.use(express.json({limit:"200kb"}));
app.use(express.urlencoded({extended:true,limit:"200kb"}));

// 2. STATIC — FAST CACHE but HTML haina cache (ina-baki secure)
app.use(express.static(path.join(__dirname,"public"),{
  maxAge:'7d',
  etag:true,
  lastModified:true,
  setHeaders:(res, filePath)=>{
    if(filePath.endsWith('.html')){
      res.setHeader('Cache-Control','public, max-age=0, must-revalidate');
    }else if(filePath.endsWith('.js') || filePath.endsWith('.css')){
      res.setHeader('Cache-Control','public, max-age=7d, immutable');
    }
  }
}));

app.get('/config.js',(req,res)=>{
  res.type('application/javascript');
  res.setHeader('Cache-Control','public, max-age=3600');
  res.send(`const SUPABASE_URL="${SUPABASE_URL}";const SUPABASE_KEY="${SUPABASE_KEY}";window.SUPABASE_URL="${SUPABASE_URL}";window.SUPABASE_KEY="${SUPABASE_KEY}";`);
});

// 3. RATE LIMIT — kwa API pekee (static hai-limit)
const loginLimiter = rateLimit({windowMs:15*60*1000,max:100});
const signupLimiter = rateLimit({windowMs:60*60*1000,max:50});
app.use("/api/", rateLimit({windowMs:60*1000,max:600}));

// Helpers
function clean(v){return String(v||"").trim().toLowerCase()}
function cleanText(v,m=500){return String(v||"").trim().slice(0,m)}
function isValidEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)}
function safeNumber(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f}
function sendError(res,s,m){return res.status(s).json({ok:false,error:m})}
function sendSuccess(res,d={}){return res.json({ok:true,...d})}
const SAFE_HOTEL_FIELDS="id,hotel_id,hotel_name,name,email,phone,location,city,hotel_type,plan,price,status,created_at";
function createToken(p){return jwt.sign(p,JWT_SECRET,{expiresIn:"12h"})}
function getBearer(req){const h=req.headers.authorization; if(h&&h.startsWith("Bearer ")) return h.slice(7); return req.headers["x-admin-token"]||null}
function verifyToken(req){const t=getBearer(req); if(!t) return null; try{return jwt.verify(t,JWT_SECRET)}catch{return null}}
function requireAdmin(req,res,next){const d=verifyToken(req); if(!d||d.role!=="admin") return sendError(res,401,"Admin required"); req.user=d; next();}
function requireHotel(req,res,next){const d=verifyToken(req); if(!d||d.role!=="hotel") return sendError(res,401,"Hotel login required"); req.user=d; next();}
function getHotelIdFromReq(req){
  const token = verifyToken(req);
  if(token?.role==="hotel" && token?.hotel_id) return token.hotel_id.toUpperCase();
  if(token?.role==="admin") return (req.query.hotel_id||req.body.hotel_id||'').toString().toUpperCase()||null;
  return (req.query.hotel_id||req.body.hotel_id||req.headers['x-hotel-id']||'').toString().toUpperCase()||null;
}

async function routeOrderToDepartment(order){
  try{
    const hotel_id=(order.hotel_id||'BAOBAB').toUpperCase();
    const dept=(order.department||'kitchen').toLowerCase();
    let waNumber='';
    try{ const {data}=await supa.schema('guesthub_os').from('departments').select('whatsapp_number').eq('hotel_id',hotel_id).eq('name',dept).maybeSingle(); if(data?.whatsapp_number) waNumber=data.whatsapp_number; }catch(e){}
    if(!waNumber){ try{ const {data:h}=await supa.from('hotels').select('phone').or(`hotel_id.eq.${hotel_id},id.eq.${hotel_id}`).maybeSingle(); waNumber=h?.phone||''; }catch(e){} }
    const itemsStr=Array.isArray(order.items)?order.items.map(i=>`${i.name||i.title} x${i.qty||1}`).join(', '):'Order';
    const msg=`🔔 NEW ORDER ${dept.toUpperCase()} - ${hotel_id} - Room ${order.room_number} - ${order.guest_name} - ${itemsStr} - Ksh ${order.total}`;
    const waLink=waNumber?`https://wa.me/${String(waNumber).replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`:'';
    return {sent:!!waNumber,to:waNumber,waLink,msg};
  }catch(e){return {sent:false}}
}

app.get('/api/health',(req,res)=>res.json({ok:true,os:'18.0 MERGED ULTRA FAST 1000+ SECURED',secured:true,scaled:true,compression:true,time:new Date().toISOString(),uptime:process.uptime()}));

app.post("/api/admin/login",loginLimiter, async(req,res)=>{
  const pw=String(req.body.password||""); if(!pw) return sendError(res,400,"Password required");
  const valid=await bcrypt.compare(pw,ADMIN_PASSWORD).catch(()=>false);
  if(!(valid||pw===ADMIN_PASSWORD)) return sendError(res,401,"Wrong password");
  return sendSuccess(res,{token:createToken({role:"admin"})});
});

async function handleHotelSignup(req,res){
 try{
  const {hotel_name,name,manager_name,location,city,hotel_type,rooms
