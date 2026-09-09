// GuestHub OS 18.0 — MERGED FINAL V19 — ULTRA FAST + PUBLIC /api/data + NO CRASH
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

// ===== SUPA — JUU KABISA =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_OS_18_1000_SCALED_SECURED_2026";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if(!SUPABASE_URL ||!SUPABASE_KEY ||!SUPABASE_SERVICE_KEY){
  console.error("❌ Missing SUPABASE ENV");
  process.exit(1);
}
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});

const app = express();
const PORT = Number(process.env.PORT || 10000);
app.set('trust proxy', 1);
app.disable("x-powered-by");

// 1. SECURITY + SPEED — FIX YA BLACK SCREEN
app.use(helmet({contentSecurityPolicy:false, crossOriginEmbedderPolicy:false}));
app.use(compression());
app.use(cors({origin:()=>true,credentials:true}));
app.use(express.json({limit:"200kb"}));
app.use(express.urlencoded({extended:true,limit:"200kb"}));

// 2. STATIC — HTML no-cache, JS/CSS cache 7d
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

// 3. RATE LIMIT
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
    try{ const {data}=await supa.schema('guesthub_os').from('departments').select('whatsapp_number').eq('hotel_id',hotel_id).eq('name',dept).maybeSingle(); if(data?.whatsapp_number) waNumber=data.whatsapp_number; }catch{}
    if(!waNumber){ try{ const {data:h}=await supa.from('hotels').select('phone').or(`hotel_id.eq.${hotel_id},id.eq.${hotel_id}`).maybeSingle(); waNumber=h?.phone||''; }catch{} }
    const itemsStr=Array.isArray(order.items)?order.items.map(i=>`${i.name||i.title} x${i.qty||1}`).join(', '):'Order';
    const msg=`🔔 NEW ORDER ${dept.toUpperCase()} - ${hotel_id} - Room ${order.room_number} - ${order.guest_name} - ${itemsStr} - Ksh ${order.total}`;
    const waLink=waNumber?`https://wa.me/${String(waNumber).replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`:'';
    return {sent:!!waNumber,to:waNumber,waLink,msg};
  }catch{return {sent:false}}
}

// ===== PUBLIC ROUTES — HIZI NDIZO ZINA-FIX BLACK SCREEN =====
app.get('/api/health',(req,res)=>res.json({ok:true,os:'18.0 MERGED V19',time:new Date().toISOString(),uptime:process.uptime()}));
app.get('/api/data', async (req,res)=>{
  try{
    const {data} = await supa.from('hotels').select(SAFE_HOTEL_FIELDS).eq('status','APPROVED').limit(50);
    res.json({hotels: data || []});
  }catch(e){
    res.json({hotels: [{id:'BAOBAB',hotel_id:'BAOBAB',hotel_name:'Baobab Beach Resort',location:'Diani',hotel_type:'Beach',city:'Diani'}]});
  }
});

// ADMIN & HOTEL
app.post("/api/admin/login",loginLimiter, async(req,res)=>{
  const pw=String(req.body.password||""); if(!pw) return sendError(res,400,"Password required");
  const valid=await bcrypt.compare(pw,ADMIN_PASSWORD).catch(()=>false);
  if(!(valid||pw===ADMIN_PASSWORD)) return sendError(res,401,"Wrong password");
  return sendSuccess(res,{token:createToken({role:"admin"})});
});
async function handleHotelSignup(req,res){
 try{
  const {hotel_name,name,manager_name,location,city,hotel_type,rooms,website,email,phone,password}=req.body;
  const finalName=cleanText(hotel_name||name||'Hotel',100);
  const finalEmail=clean(email);
  if(finalName.length<3) return sendError(res,400,"Hotel name min 3 chars");
  if(!isValidEmail(finalEmail)) return sendError(res,400,"Invalid email");
  if(!phone||String(phone).length<9) return sendError(res,400,"Phone required");
  if(!password||String(password).length<8) return sendError(res,400,"Password min 8 chars");
  const {data:exists}=await supa.from("hotels").select("id").eq("email",finalEmail).limit(1).maybeSingle();
  if(exists) return sendError(res,409,"Email already registered");
  const base=finalName.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,12)||'hotel';
  const hotelId=base.toUpperCase()+(Math.floor(Math.random()*900)+100);
  const hash=await bcrypt.hash(String(password),12);
  const row={ id:hotelId, hotel_id:hotelId, name:finalName, hotel_name:finalName, city:cleanText(city||location||'Mombasa',80), location:cleanText(location||city||'Mombasa',100), hotel_type:cleanText(hotel_type||'Boutique Hotel',40), manager_name:cleanText(manager_name||'',100), rooms:safeNumber(rooms,30), website:cleanText(website||'',200), email:finalEmail, phone:cleanText(phone,30), status:"PENDING", approved_by_admin:false, plan:"Upendo", price:6500, password_hash:hash, till_number:'123456', m_pesa_name:hotelId };
  const {error}=await supa.from("hotels").insert([row]); if(error) throw new Error(error.message);
  return sendSuccess(res,{hotel_id:hotelId,status:"PENDING"});
 }catch(e){ console.error("Signup error:",e.message); return sendError(res,500,"Unable to register: "+e.message); }
}
app.post("/api/hotels/signup",signupLimiter, handleHotelSignup);
app.post("/api/hotels/register",signupLimiter, handleHotelSignup);
app.post("/api/hotels",signupLimiter, handleHotelSignup);
app.post("/api/hotel/login",loginLimiter, async(req,res)=>{
  try{
    const id=clean(req.body.hotelId||req.body.hotel_id||''); const pw=String(req.body.password||'');
    if(!id||!pw) return sendError(res,400,"Hotel ID & password required");
    const {data:h,error}=await supa.from("hotels").select("*").or(`id.eq.${id},hotel_id.eq.${id}`).maybeSingle();
    if(error) throw error; if(!h) return sendError(res,404,"Hotel not found");
    const valid=await bcrypt.compare(pw,h.password_hash||''); if(!valid) return sendError(res,401,"Wrong password");
    if(String(h.status).toUpperCase()!=="APPROVED") return sendError(res,403,`Not approved yet: ${h.status}`);
    const token=createToken({role:"hotel",hotel_id:h.hotel_id||h.id});
    const safe={...h}; delete safe.password_hash;
    return sendSuccess(res,{token,hotel:safe});
  }catch(e){ return sendError(res,500,"Login error: "+e.message); }
});
app.get("/api/hotels",requireAdmin, async(req,res)=>{
  const page=safeNumber(req.query.page,1); const limit=Math.min(safeNumber(req.query.limit,50),100);
  const from=(page-1)*limit; const to=from+limit-1;
  const {data,error}=await supa.from("hotels").select(SAFE_HOTEL_FIELDS).order("created_at",{ascending:false}).range(from,to);
  if(error) return sendError(res,500,error.message); res.json(data||[]);
});
app.post("/api/hotels/:id/approve",requireAdmin, async(req,res)=>{
  const id=clean(req.params.id); const {data,error}=await supa.from("hotels").update({status:"APPROVED",approved_by_admin:true}).or(`id.eq.${id},hotel_id.eq.${id}`).select(SAFE_HOTEL_FIELDS).maybeSingle();
  if(error) return sendError(res,500,error.message); return sendSuccess(res,{hotel:data});
});
app.get("/api/admin/stats",requireAdmin, async(req,res)=>{
  try{
    const [{count:hotels},{count:pending},{count:approved}] = await Promise.all([
      supa.from("hotels").select("id",{count:'exact',head:true}),
      supa.from("hotels").select("id",{count:'exact',head:true}).eq('status','PENDING'),
      supa.from("hotels").select("id",{count:'exact',head:true}).eq('status','APPROVED')
    ]);
    return sendSuccess(res,{hotels:hotels||0,pendingHotels:pending||0,approvedHotels:approved||0});
  }catch(e){ return sendError(res,500,e.message); }
});
app.get("/api/departments", async(req,res)=>{
  const hid=getHotelIdFromReq(req); if(!hid) return res.json([]);
  try{ const {data}=await supa.schema('guesthub_os').from('departments').select('*').eq('hotel_id',hid).limit(50); return res.json(data||[]); }catch{ return res.json([]); }
});
app.post("/api/departments", requireHotel, async(req,res)=>{
  const hid=req.user.hotel_id.toUpperCase(); const {name,whatsapp_number}=req.body;
  if(!name||!whatsapp_number) return sendError(res,400,"Name & whatsapp required");
  try{ const {data,error}=await supa.schema('guesthub_os').from('departments').upsert({hotel_id:hid,name:clean(name),whatsapp_number:cleanText(whatsapp_number,30)},{onConflict:'hotel_id,name'}).select().single(); if(error) throw error; return res.json(data); }catch(e){ return sendError(res,500,e.message); }
});
app.get("/api/menu", async(req,res)=>{
  const hid=getHotelIdFromReq(req)||'BAOBAB'; const limit=Math.min(safeNumber(req.query.limit,100),200);
  try{ const {data}=await supa.schema('guesthub_os').from('menu_items').select('id,name,price,category,is_active,hotel_id').eq('hotel_id',hid.toUpperCase()).eq('is_active',true).order('created_at',{ascending:false}).limit(limit); return res.json({items:data||[],menus:[{till_number:'123456'}]}); }catch{ return res.json({items:[],menus:[]}); }
});
app.post("/api/orders", async(req,res)=>{
  try{
    const hid=(req.body.hotel_id||getHotelIdFromReq(req)||'BAOBAB').toUpperCase();
    if(!req.body.room &&!req.body.room_number) return sendError(res,400,"Room required");
    const payload={ hotel_id:hid, room_number:cleanText(req.body.room||req.body.room_number||'101',30), guest_name:cleanText(req.body.guest_name||'Guest',100), guest_phone:cleanText(req.body.guest_phone||'',30), items:req.body.items||[{name:req.body.service_title||'Order',qty:1}], total:safeNumber(req.body.total||req.body.amount||0), status:'pending', department:clean(req.body.department||'kitchen'), location_label:`Room ${req.body.room||req.body.room_number} - ${req.body.guest_name}` };
    const {data,error}=await supa.schema('guesthub_os').from('orders').insert([payload]).select().single(); if(error) throw error;
    const routing=await routeOrderToDepartment(data); return sendSuccess(res,{order:data,routing});
  }catch(e){ return sendError(res,500,e.message); }
});
app.get('*',(req,res)=>{
  res.sendFile(path.join(__dirname,"public","index.html"),(e)=>{
    if(e) res.status(200).send('GuestHub OS 18.0 MERGED V19 — API OK at /api/health');
  });
});
app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`🚀 MERGED FINAL V19 on 0.0.0.0:${PORT} — NO BLACK, /api/data PUBLIC, 1000+ READY`);
});
