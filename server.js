import express from "express";
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

// ===== SUPA — LAZIMA IWE HAPA JUU — FIX YA Cannot access 'supa' =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_OS_18_MERGED_FINAL_2026";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if(!SUPABASE_URL||!SUPABASE_KEY){ console.error("❌ Missing SUPABASE env"); process.exit(1); }
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY||SUPABASE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});

const app = express();
app.set('trust proxy', 1);

app.get('/config.js', (req,res)=>{
  res.type('application/javascript').send(`const SUPABASE_URL="${SUPABASE_URL}";const SUPABASE_KEY="${SUPABASE_KEY}";window.SUPABASE_URL="${SUPABASE_URL}";window.SUPABASE_KEY="${SUPABASE_KEY}";`);
});

const PORT = process.env.PORT || 10000;
app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:false, crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:"200kb"}));
app.use(cors({origin:()=>true,credentials:true}));
app.use(express.static(path.join(__dirname,"public")));

const loginLimiter = rateLimit({windowMs:15*60*1000,max:100});
const signupLimiter = rateLimit({windowMs:60*60*1000,max:100});
app.use("/api/", rateLimit({windowMs:60*1000,max:500}));

function clean(v){return String(v||"").trim().toLowerCase()}
function cleanText(v,m=500){return String(v||"").trim().slice(0,m)}
function isValidEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)}
function safeNumber(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f}
function sendError(res,s,m){return res.status(s).json({ok:false,error:m})}
function sendSuccess(res,d={}){return res.json({ok:true,...d})}
const SAFE_HOTEL_FIELDS="id,hotel_id,hotel_name,name,email,phone,location,city,hotel_type,plan,price,status,created_at,whatsapp_kitchen,whatsapp_taxi";
function createToken(p){return jwt.sign(p,JWT_SECRET,{expiresIn:"12h"})}
function getBearer(req){const h=req.headers.authorization; if(h&&h.startsWith("Bearer ")) return h.slice(7); return null}
function verifyToken(req){const t=getBearer(req); if(!t) return null; try{return jwt.verify(t,JWT_SECRET)}catch{return null}}
function requireAdmin(req,res,next){const d=verifyToken(req); if(!d||d.role!=="admin") return sendError(res,401,"Admin required"); next();}
function requireHotel(req,res,next){const d=verifyToken(req); if(!d||d.role!=="hotel") return sendError(res,401,"Hotel login required"); req.user=d; next();}

async function routeOrderToDepartment(order){
  try{
    const hotel_id=(order.hotel_id||'BAOBAB').toUpperCase();
    const dept=(order.department||'kitchen').toLowerCase();
    let waNumber=''; try{ const {data}=await supa.schema('guesthub_os').from('departments').select('*').eq('hotel_id',hotel_id).eq('name',dept).maybeSingle(); if(data?.whatsapp_number) waNumber=data.whatsapp_number; }catch(e){}
    if(!waNumber){ try{ const {data:h}=await supa.from('hotels').select('*').or(`hotel_id.eq.${hotel_id},id.eq.${hotel_id}`).maybeSingle(); waNumber=h?.['whatsapp_'+dept]||h?.phone||''; }catch(e){} }
    const itemsStr=Array.isArray(order.items)?order.items.map(i=>`${i.name} x${i.qty}`).join(', '):'Order';
    const msg=`🔔 NEW ORDER ${dept.toUpperCase()} - ${hotel_id} - Room ${order.room_number} - ${order.guest_name} - ${order.guest_phone} - ${itemsStr} - Ksh ${order.total}`;
    const waLink=waNumber?`https://wa.me/${String(waNumber).replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`:'';
    return {sent:!!waNumber,to:waNumber,waLink};
  }catch(e){return {sent:false}}
}

app.get('/api/health',(req,res)=>res.json({ok:true,os:'18.0 MERGED FINAL - supa on top FIXED'}));

// ===== ADMIN LOGIN =====
app.post("/api/admin/login",loginLimiter, async(req,res)=>{
  const pw=String(req.body.password||""); const valid=await bcrypt.compare(pw,ADMIN_PASSWORD).catch(()=>false);
  if(!(valid||pw===ADMIN_PASSWORD)) return sendError(res,401,"Wrong password");
  return sendSuccess(res,{token:createToken({role:"admin"})});
});

// ===== HOTEL SIGNUP — FINAL FIX — DOUBLE FALLBACK =====
async function handleHotelSignup(req,res){
 try{
  const {hotel_name,name,manager_name,location,city,hotel_type,rooms,website,email,phone,password}=req.body;
  const finalName=cleanText(hotel_name||name||'Hotel',100);
  const finalEmail=clean(email);
  if(finalName.length<3) return sendError(res,400,"Hotel name min 3 chars");
  if(!isValidEmail(finalEmail)) return sendError(res,400,"Invalid email");
  if(!password||String(password).length<6) return sendError(res,400,"Password min 6 chars");

  const base=finalName.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,15)||'hotel';
  let hotelId=base.toUpperCase()+(Math.floor(Math.random()*90)+10);
  const hash=await bcrypt.hash(String(password),12);

  const fullPayload={
    id:hotelId, hotel_id:hotelId, name:finalName, hotel_name:finalName,
    city:cleanText(city||location||'Mombasa',80), location:cleanText(location||city||'Mombasa',100),
    hotel_type:cleanText(hotel_type||'Boutique Hotel',30), manager_name:cleanText(manager_name||'',100),
    rooms:safeNumber(rooms,30), website:cleanText(website||'',200), email:finalEmail, phone:cleanText(phone||'0707142187',30),
    password:hash, password_hash:hash, status:"PENDING", plan:"Upendo", price:6500
  };

  let {error}=await supa.from("hotels").insert([fullPayload]);
  if(error){
    console.warn("Full insert failed:", error.message, "→ trying minimal");
    if(String(error.message).includes('duplicate')||error.code==='23505'){
      return sendError(res,409,"Email already registered — tumia email ingine kama arapasta2@gmail.com");
    }
    // FALLBACK 1 — only columns that 100% exist in old table
    const mini={ hotel_id:hotelId, name:finalName, email:finalEmail, city:cleanText(city||'Mombasa',80), status:'PENDING' };
    const r2=await supa.from("hotels").insert([mini]);
    if(r2.error){
      // FALLBACK 2 — even more minimal
      const ultra={ hotel_id:hotelId, email:finalEmail, status:'PENDING' };
      const r3=await supa.from("hotels").insert([ultra]);
      if(r3.error) return sendError(res,500,"DB Schema not updated — Run SQL ya ADD COLUMN + NOTIFY pgrst, 'reload schema' — Error: "+r3.error.message);
    }
  }
  return sendSuccess(res,{hotel_id:hotelId,status:"PENDING"});
 }catch(e){ console.error(e); return sendError(res,500,"Unable to register: "+e.message); }
}
app.post("/api/hotels/signup",signupLimiter, handleHotelSignup);
app.post("/api/hotels/register",signupLimiter, handleHotelSignup);
app.post("/api/hotels",signupLimiter, handleHotelSignup);

app.post("/api/hotel/login",loginLimiter, async(req,res)=>{
  const {hotelId,hotel_id,password}=req.body; const id=clean(hotelId||hotel_id);
  const {data:h}=await supa.from("hotels").select("*").or(`id.eq.${id},hotel_id.eq.${id}`).maybeSingle();
  if(!h) return sendError(res,404,"Hotel not found");
  const valid=await bcrypt.compare(String(password),h.password_hash||h.password).catch(()=> String(password)===(h.password_hash||h.password));
  if(!valid) return sendError(res,401,"Wrong password");
  if(String(h.status).toUpperCase()!=="APPROVED") return sendError(res,403,`Not approved: ${h.status}`);
  return sendSuccess(res,{token:createToken({role:"hotel",hotel_id:h.hotel_id||h.id}),hotel:h});
});

app.get("/api/hotels", requireAdmin, async(req,res)=>{ const {data}=await supa.from("hotels").select(SAFE_HOTEL_FIELDS).order("created_at",{ascending:false}).limit(500); res.json(data||[]); });
app.post("/api/hotels/:id/approve", requireAdmin, async(req,res)=>{ const id=clean(req.params.id); const {data}=await supa.from("hotels").update({status:"APPROVED",approved_by_admin:true}).or(`id.eq.${id},hotel_id.eq.${id}`).select().maybeSingle(); res.json({ok:true,hotel:data}); });

app.get("/api/menu", async(req,res)=>{ const hid=(req.query.hotel_id||'BAOBAB').toUpperCase(); try{ const {data}=await supa.schema('guesthub_os').from('menu_items').select('*').eq('hotel_id',hid).eq('is_active',true); return res.json({items:data||[],menus:[{till_number:'123456'}]}); }catch(e){ return res.json({items:[],menus:[]}); } });
app.get("/api/departments", async(req,res)=>{ const hid=(req.query.hotel_id||'BAOBAB').toUpperCase(); try{ const {data}=await supa.schema('guesthub_os').from('departments').select('*').eq('hotel_id',hid); return res.json(data||[]); }catch(e){ return res.json([]); } });
app.post("/api/departments", async(req,res)=>{ const {hotel_id,name,whatsapp_number}=req.body; try{ const {data}=await supa.schema('guesthub_os').from('departments').upsert({hotel_id:(hotel_id||'BAOBAB').toUpperCase(),name:clean(name),whatsapp_number},{onConflict:'hotel_id,name'}).select().single(); return res.json(data); }catch(e){ return sendError(res,500,e.message); } });
app.post("/api/orders", async(req,res)=>{
  try{
    const b=req.body; const hid=(b.hotel_id||'BAOBAB').toUpperCase();
    const payload={ hotel_id:hid, room_number:cleanText(b.room||b.room_number||'101'), guest_name:cleanText(b.guest_name||'Guest'), guest_phone:cleanText(b.guest_phone||''), items:b.items||[{name:b.service_title||'Order',qty:1}], total:safeNumber(b.total||b.amount||0), status:'pending', department:clean(b.department||'kitchen'), location_label:`Room ${b.room||b.room_number} - ${b.guest_name}` };
    const {data}=await supa.schema('guesthub_os').from('orders').insert([payload]).select().single();
    const routing=await routeOrderToDepartment(data); return sendSuccess(res,{order:data,routing});
  }catch(e){ return sendError(res,500,e.message); }
});
app.get("/api/admin/stats", requireAdmin, async(req,res)=>{
  const {data:hotels}=await supa.from("hotels").select("id,status",{count:"exact"});
  const pending=hotels?.filter(h=>String(h.status).toUpperCase()==="PENDING").length||0;
  return sendSuccess(res,{pendingHotels:pending,hotels:hotels?.length||0});
});

app.get('*',(req,res)=>{ res.sendFile(path.join(__dirname,"public","index.html"),(e)=>{ if(e) res.status(404).send('Not found'); }); });
app.listen(PORT,()=>console.log(`🚀 FINAL MERGED FIXED on ${PORT} — supa on top — signup arapasta@gmail.com ready`));
