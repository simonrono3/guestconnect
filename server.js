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

const app = express();

// 🔥 FIX #1 - LAZIMA IWE HAPA JUU KABISA KABLA YA YOTE!
app.set('trust proxy', 1);

// ====== CONFIG.JS INJECTION ======
app.get('/config.js', (req,res)=>{
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_KEY;
  if(!url||!key) return res.type('application/javascript').send(`console.error("Missing SUPABASE env");`);
  res.type('application/javascript').send(`const SUPABASE_URL="${url}";const SUPABASE_KEY="${key}";const SUPABASE_ANON_KEY="${key}";window.SUPABASE_URL="${url}";window.SUPABASE_KEY="${key}";window.SUPABASE_ANON_KEY="${key}";`);
});

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_Secured_OS_11_Change_This_In_Render";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if(!SUPABASE_URL||!SUPABASE_KEY){ console.error("❌ Missing SUPABASE env"); process.exit(1); }

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY||SUPABASE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});

// ====== MIDDLEWARE ======
app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:false, crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:"100kb"}));
app.use(express.urlencoded({extended:true,limit:"100kb"}));
app.use(cors({origin:(o,cb)=>{ if(!o) return cb(null,true); return cb(null,true); },credentials:true}));

// STATIC
const publicPath = path.join(__dirname,"public");
app.use(express.static(publicPath, { maxAge: '1d', etag: true }));
app.use(express.static(__dirname, { maxAge: '1d' }));

// RATE LIMIT - SASA ITAWORK BAADA YA trust proxy
const loginLimiter = rateLimit({windowMs:15*60*1000,max:50, standardHeaders:true, legacyHeaders:false});
const signupLimiter = rateLimit({windowMs:60*60*1000,max:50, standardHeaders:true, legacyHeaders:false});
const apiLimiter = rateLimit({windowMs:60*1000,max:500, standardHeaders:true, legacyHeaders:false});
app.use("/api/",apiLimiter);

function clean(v){return String(v||"").trim().toLowerCase()}
function cleanText(v,m=500){return String(v||"").trim().slice(0,m)}
function isValidEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)}
function safeNumber(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f}
function sendError(res,s,m){return res.status(s).json({ok:false,error:m})}
function sendSuccess(res,d={}){return res.json({ok:true,...d})}
const SAFE_HOTEL_FIELDS="id,hotel_id,hotel_name,name,email,phone,location,city,hotel_type,plan,price,status,created_at,whatsapp_kitchen,whatsapp_house,whatsapp_housekeeping,whatsapp_laundry,whatsapp_spa,whatsapp_taxi,whatsapp_tours,whatsapp_media,whatsapp_front";
function createToken(p){return jwt.sign(p,JWT_SECRET,{expiresIn:"12h"})}
function getBearer(req){const h=req.headers.authorization; if(h&&h.startsWith("Bearer ")) return h.slice(7); return req.headers["x-admin-token"]||req.headers["x-auth-token"]||null}
function verifyToken(req){const t=getBearer(req); if(!t) return null; try{return jwt.verify(t,JWT_SECRET)}catch{return null}}
function requireAdmin(req,res,next){const d=verifyToken(req); if(!d||d.role!=="admin") return sendError(res,401,"Admin required"); req.user=d; next();}
function requireHotel(req,res,next){const d=verifyToken(req); if(!d||d.role!=="hotel") return sendError(res,401,"Hotel login required"); req.user=d; next();}
function requireVendor(req,res,next){const d=verifyToken(req); if(!d||d.role!=="vendor") return sendError(res,401,"Vendor login required"); req.user=d; next();}

// ====== AUTH ROUTES ======
app.post("/api/admin/login",loginLimiter, async(req,res)=>{ try{const pw=String(req.body.password||""); if(!pw) return sendError(res,400,"Password required"); const valid=await bcrypt.compare(pw,ADMIN_PASSWORD).catch(()=>false); if(!(valid||pw===ADMIN_PASSWORD)) return sendError(res,401,"Wrong password"); const token=createToken({role:"admin",scope:"full"}); return sendSuccess(res,{token}); }catch(e){return sendError(res,500,"Server error");}});
app.post("/api/hotels/signup",signupLimiter, async(req,res)=>{ try{const {hotel_name,name,manager_name,location,city,hotel_type,rooms,website,email,phone,password}=req.body; const finalName=cleanText(hotel_name||name,100); const finalEmail=clean(email); if(!finalName||finalName.length<3) return sendError(res,400,"Hotel name min 3 chars"); if(!isValidEmail(finalEmail)) return sendError(res,400,"Invalid email"); if(!password||String(password).length<8) return sendError(res,400,"Password min 8 chars"); let baseId=finalName.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,20); if(!baseId) baseId="hotel"; let hotelId=baseId, suf=1; while(true){const {data}=await supa.from("hotels").select("id").or(`id.eq.${hotelId},hotel_id.eq.${hotelId}`).limit(1); if(!data||!data.length) break; hotelId=`${baseId}${suf++}`; if(suf>999) return sendError(res,500,"ID gen failed");} const hash=await bcrypt.hash(String(password),12); const payload={id:hotelId,hotel_id:hotelId,name:finalName,hotel_name:finalName,location:cleanText(location||city,100),city:cleanText(city,80),hotel_type:cleanText(hotel_type||"Hotel",30),manager_name:cleanText(manager_name,100),rooms:safeNumber(rooms),website:cleanText(website,200),email:finalEmail,phone:cleanText(phone,30),password:hash,password_hash:hash,status:"PENDING",plan:"Upendo",price:6500}; const {error}=await supa.from("hotels").insert([payload]); if(error){ if(error.code==="23505") return sendError(res,409,"Hotel exists"); throw error; } return sendSuccess(res,{hotel_id:hotelId,status:"PENDING",message:"Pending approval"});}catch(e){console.error(e); return sendError(res,500,"Unable to register");}});
app.post("/api/hotel/login",loginLimiter, async(req,res)=>{ try{const {hotelId,hotel_id,password}=req.body; if(!password) return sendError(res,400,"Password required"); const id=clean(hotelId||hotel_id); if(!id) return sendError(res,400,"Hotel ID required"); const {data:hotel,error}=await supa.from("hotels").select("*").or(`id.eq.${id},hotel_id.eq.${id}`).limit(1).maybeSingle(); if(error) throw error; if(!hotel) return sendError(res,404,"Hotel not found"); const hash=hotel.password_hash||hotel.password; const valid=await bcrypt.compare(String(password),hash); if(!valid) return sendError(res,401,"Wrong password"); const st=String(hotel.status||"").toUpperCase(); if(st!=="APPROVED") return sendError(res,403,`Not approved: ${st}. Wait for admin.`); const token=createToken({role:"hotel",hotel_id:hotel.hotel_id||hotel.id}); const safe={...hotel}; delete safe.password; delete safe.password_hash; return sendSuccess(res,{token,hotel:safe}); }catch(e){return sendError(res,500,"Server error");}});
app.post("/api/vendor/login",loginLimiter, async(req,res)=>{ try{const {email}=req.body; if(!email) return sendError(res,400,"Email required"); const {data:v,error}=await supa.from("vendors").select("*").eq("email",clean(email)).maybeSingle(); if(error) throw error; if(!v) return sendError(res,404,"Vendor not found"); if(String(v.status||"").toLowerCase()==="pending") return sendError(res,403,"Pending approval"); if(String(v.status||"").toLowerCase()==="rejected") return sendError(res,403,"Rejected"); const token=createToken({role:"vendor",vendor_id:v.id,email:v.email}); return sendSuccess(res,{token,vendor:v}); }catch(e){return sendError(res,500,"Server error");}});

// ====== GUEST ORDERS ======
app.post("/api/orders", async(req,res)=>{ try{const {hotel_id,room,guest_name,guest_phone,service_id,service_title,service,amount,notes,category}=req.body; const hotelId=clean(hotel_id); if(!hotelId) return sendError(res,400,"Hotel ID required"); if(!room) return sendError(res,400,"Room required"); const finalTitle=cleanText(service_title||service,150); if(!finalTitle) return sendError(res,400,"Service required"); const amt=safeNumber(amount); const payload={hotel_id:hotelId,room:cleanText(room,30),guest_name:cleanText(guest_name||"Guest",100),guest_phone:cleanText(guest_phone,30),service_id:service_id||null,service_title:finalTitle,service:finalTitle,amount:amt,notes:cleanText(notes,500),category:cleanText(category||"service",30),status:"new"}; const {data,error}=await supa.from("orders").insert([payload]).select("*").single(); if(error) throw error; return sendSuccess(res,{order:data}); }catch(e){console.error(e); return sendError(res,500,"Unable to create order");}});

// ====== DASHBOARDS API ======
app.get("/api/auth/me", async(req,res)=>{ const d=verifyToken(req); if(!d) return sendError(res,401,"Invalid token"); if(d.role==="hotel"){ const {data:h}=await supa.from("hotels").select(SAFE_HOTEL_FIELDS).or(`id.eq.${d.hotel_id},hotel_id.eq.${d.hotel_id}`).maybeSingle(); return sendSuccess(res,{user:d,hotel:h}); } if(d.role==="vendor"){ const {data:v}=await supa.from("vendors").select("*").eq("id",d.vendor_id).maybeSingle(); return sendSuccess(res,{user:d,vendor:v}); } return sendSuccess(res,{user:d}); });
app.get("/api/vendor/me", requireVendor, async(req,res)=>{ const {data:v}=await supa.from("vendors").select("*").eq("id",req.user.vendor_id).maybeSingle(); if(!v) return sendError(res,404,"Vendor not found"); return sendSuccess(res,{vendor:v}); });
app.get("/api/vendor/orders", requireVendor, async(req,res)=>{ const {data,error}=await supa.from("orders").select("*").order("created_at",{ascending:false}).limit(200); if(error) return sendError(res,500,error.message); return sendSuccess(res,{orders:data||[]}); });
app.patch("/api/vendor/availability", requireVendor, async(req,res)=>{ const {available}=req.body; const {error}=await supa.from("vendors").update({available:!!available,is_available:!!available}).eq("id",req.user.vendor_id); if(error) return sendError(res,500,error.message); return sendSuccess(res,{available:!!available}); });
app.post("/api/vendor/orders/:id/accept", requireVendor, async(req,res)=>{ const id=clean(req.params.id); const vendorId=req.user.vendor_id; const {data:v}=await supa.from("vendors").select("full_name,phone").eq("id",vendorId).maybeSingle(); const {error}=await supa.from("orders").update({status:"accepted",vendor_id:vendorId,vendor_name:v?.full_name,vendor_phone:v?.phone}).eq("id",id).eq("status","new"); if(error) return sendError(res,500,error.message); return sendSuccess(res,{message:"Accepted"}); });
app.post("/api/vendor/orders/:id/decline", requireVendor, async(req,res)=>{ const id=clean(req.params.id); const {error}=await supa.from("orders").update({status:"declined",vendor_id:req.user.vendor_id}).eq("id",id).eq("status","new"); if(error) return sendError(res,500,error.message); return sendSuccess(res,{message:"Declined"}); });
app.patch("/api/vendor/orders/:id/status", requireVendor, async(req,res)=>{ const id=clean(req.params.id); const {status}=req.body; const allowed=["in_progress","completed","cancelled"]; if(!allowed.includes(status)) return sendError(res,400,"Invalid status"); const {error}=await supa.from("orders").update({status}).eq("id",id).eq("vendor_id",req.user.vendor_id); if(error) return sendError(res,500,error.message); return sendSuccess(res,{status}); });
app.get("/api/gm/dashboard", requireHotel, async(req,res)=>{ const hotelId=req.user.hotel_id; const [hotelR,ordersR,servicesR,vendorsR]=await Promise.all([ supa.from("hotels").select(SAFE_HOTEL_FIELDS).or(`id.eq.${hotelId},hotel_id.eq.${hotelId}`).maybeSingle(), supa.from("orders").select("*").eq("hotel_id",hotelId).order("created_at",{ascending:false}).limit(500), supa.from("hotel_services").select("*").eq("hotel_id",hotelId).order("created_at",{ascending:false}), supa.from("vendors").select("*").eq("status","approved").limit(100) ]); const orders=ordersR.data||[]; const revenue=orders.reduce((s,o)=>s+safeNumber(o.amount||0),0); return sendSuccess(res,{hotel:hotelR.data,orders,services:servicesR.data||[],items:servicesR.data||[],revenue,todayOrders:orders.length,activeVendors:(vendorsR.data||[]).length}); });
app.get("/api/gm/orders", requireHotel, async(req,res)=>{ const {data,error}=await supa.from("orders").select("*").eq("hotel_id",req.user.hotel_id).order("created_at",{ascending:false}).limit(500); if(error) return sendError(res,500,error.message); return sendSuccess(res,{orders:data||[]}); });
app.get("/api/gm/services", requireHotel, async(req,res)=>{ const {data,error}=await supa.from("hotel_services").select("*").eq("hotel_id",req.user.hotel_id).order("created_at",{ascending:false}); if(error) return sendError(res,500,error.message); return sendSuccess(res,{services:data||[]}); });
app.patch("/api/gm/whatsapp", requireHotel, async(req,res)=>{ const fields=["whatsapp_kitchen","whatsapp_house","whatsapp_housekeeping","whatsapp_laundry","whatsapp_spa","whatsapp_taxi","whatsapp_tours","whatsapp_media","whatsapp_front"]; const payload={}; fields.forEach(f=>{ if(req.body[f]!==undefined) payload[f]=cleanText(req.body[f],30); }); if(!Object.keys(payload).length) return sendError(res,400,"No fields"); const {data,error}=await supa.from("hotels").update(payload).or(`id.eq.${req.user.hotel_id},hotel_id.eq.${req.user.hotel_id}`).select(SAFE_HOTEL_FIELDS).maybeSingle(); if(error) return sendError(res,500,error.message); return sendSuccess(res,{hotel:data}); });
app.patch("/api/orders/:id/status", requireHotel, async(req,res)=>{ const id=clean(req.params.id); const {status}=req.body; const {error}=await supa.from("orders").update({status:cleanText(status,30)}).eq("id",id).eq("hotel_id",req.user.hotel_id); if(error) return sendError(res,500,error.message); return sendSuccess(res,{status}); });

// ADMIN
app.get("/api/hotels", requireAdmin, async(req,res)=>{ const {data,error}=await supa.from("hotels").select(SAFE_HOTEL_FIELDS).order("created_at",{ascending:false}).limit(1000); if(error) return sendError(res,500,error.message); return res.json(data||[]); });
app.get("/api/admin/vendors", requireAdmin, async(req,res)=>{ const {data,error}=await supa.from("vendors").select("*").order("created_at",{ascending:false}).limit(1000); if(error) return sendError(res,500,error.message); return res.json(data||[]); });
app.patch("/api/admin/vendors/:id", requireAdmin, async(req,res)=>{ const id=clean(req.params.id); const status=cleanText(req.body.status,30).toLowerCase(); if(!["pending","approved","rejected","blocked"].includes(status)) return sendError(res,400,"Invalid status"); const {data,error}=await supa.from("vendors").update({status}).eq("id",id).select("*").maybeSingle(); if(error) return sendError(res,500,error.message); return sendSuccess(res,{vendor:data}); });
async function approveHotel(req,res){ try{ const id=clean(req.params.id); const plan=cleanText(req.body.plan||"Upendo",30); const price=plan==="Bahari"?12000:plan==="Karibu"?25000:6500; const {data,error}=await supa.from("hotels").update({status:"APPROVED",plan,price}).or(`id.eq.${id},hotel_id.eq.${id}`).select(SAFE_HOTEL_FIELDS).maybeSingle(); if(error) throw error; return sendSuccess(res,{hotel:data}); }catch(e){return sendError(res,500,e.message);} }
app.post("/api/hotels/:id/approve", requireAdmin, approveHotel);
app.post("/api/admin/approve/:id", requireAdmin, approveHotel);
app.delete("/api/hotels/:id", requireAdmin, async(req,res)=>{ try{ const id=clean(req.params.id); await supa.from('hotel_services').delete().eq('hotel_id', id); await supa.from('hotel_items').delete().eq('hotel_id', id); await supa.from('rooms').delete().eq('hotel_id', id); await supa.from('orders').delete().eq('hotel_id', id); const {error}=await supa.from("hotels").delete().or(`id.eq.${id},hotel_id.eq.${id}`); if(error) throw error; return sendSuccess(res); }catch(e){return sendError(res,500,e.message);} });
app.get("/api/admin/stats", requireAdmin, async(req,res)=>{ try{ const [hotels,vendors,services,orders]=await Promise.all([ supa.from("hotels").select("id,status",{count:"exact"}), supa.from("vendors").select("id,status",{count:"exact"}), supa.from("hotel_services").select("id",{count:"exact"}), supa.from("orders").select("id,amount,status") ]); const orderData=orders.data||[]; const gmv=orderData.reduce((s,o)=>s+safeNumber(o.amount||0),0); const commission=Math.floor(gmv*0.15); return sendSuccess(res,{hotels:hotels.count||0,vendors:vendors.count||0,pendingVendors:(vendors.data||[]).filter(v=>String(v.status).toLowerCase()==="pending").length,pendingHotels:(hotels.data||[]).filter(h=>String(h.status).toUpperCase()==="PENDING").length,services:services.count||0,orders:orderData.length,gmv,commission}); }catch(e){return sendError(res,500,"Stats error");} });
app.get("/api/admin/services", requireAdmin, async(req,res)=>{ const {data,error}=await supa.from("hotel_services").select("*").order("created_at",{ascending:false}).limit(1000); if(error) return sendError(res,500,error.message); return res.json(data||[]); });
app.post("/api/admin/services", requireAdmin, async(req,res)=>{ const {hotel_id,title,price,category,description,active}=req.body; if(!hotel_id||!title) return sendError(res,400,"Hotel and title required"); const p=Number(price); if(!Number.isFinite(p)||p<0) return sendError(res,400,"Invalid price"); const payload={hotel_id:clean(hotel_id),title:cleanText(title,120),price:p,category:cleanText(category||"other",30),description:cleanText(description,500),active:active!==false}; const {data,error}=await supa.from("hotel_services").insert([payload]).select("*").single(); if(error) return sendError(res,500,error.message); return sendSuccess(res,{service:data}); });
app.delete("/api/admin/services/:id", requireAdmin, async(req,res)=>{ const id=clean(req.params.id); const {error}=await supa.from("hotel_services").delete().eq("id",id); if(error) return sendError(res,500,error.message); return sendSuccess(res); });
app.patch("/api/admin/hotels/:id", requireAdmin, async(req,res)=>{ const id=clean(req.params.id); const allowed=["name","hotel_name","city","location","email","phone","hotel_type","plan","status","whatsapp_kitchen","whatsapp_house","whatsapp_housekeeping","whatsapp_laundry","whatsapp_spa","whatsapp_taxi","whatsapp_tours","whatsapp_media","whatsapp_front"]; const payload={}; for(const f of allowed){ if(req.body[f]!==undefined) payload[f]=typeof req.body[f]==="string"?cleanText(req.body[f],300):req.body[f]; } if(payload.plan) payload.price=payload.plan==="Bahari"?12000:payload.plan==="Karibu"?25000:6500; if(!Object.keys(payload).length) return sendError(res,400,"No fields"); const {data,error}=await supa.from("hotels").update(payload).or(`id.eq.${id},hotel_id.eq.${id}`).select(SAFE_HOTEL_FIELDS).maybeSingle(); if(error) return sendError(res,500,error.message); return sendSuccess(res,{hotel:data}); });

// FIXED REPORTS - USE supa NOT supabase
app.get('/api/services', async (req,res)=>{
  const {hotel_id}=req.query;
  const {data}=await supa.from('hotel_services').select('*').eq('hotel_id',hotel_id).order('created_at',{ascending:false});
  res.json({data:data||[]});
});
app.get('/api/reports', async (req,res)=>{
  const {hotel_id}=req.query;
  const {data:orders}=await supa.from('orders').select('*').eq('hotel_id',hotel_id);
  const {data:tables}=await supa.from('table_orders').select('*').eq('hotel_id',hotel_id);
  const all=[...(orders||[]),...(tables||[])];
  const today=new Date().toISOString().slice(0,10);
  const todayRev=all.filter(o=>o.created_at?.startsWith(today)).reduce((s,o)=>s+parseFloat(o.total||o.amount||0),0);
  const weekRev=all.reduce((s,o)=>s+parseFloat(o.total||o.amount||0),0);
  res.json({today:todayRev, week:weekRev, month:weekRev, totalOrders:all.length});
});
app.get('/api/table-orders', async (req,res)=>{
  const {hotel_id}=req.query;
  const {data}=await supa.from('table_orders').select('*').eq('hotel_id',hotel_id).order('created_at',{ascending:false});
  res.json({data:data||[]});
});
app.get('/api/orders', async (req,res)=>{
  const {hotel_id}=req.query;
  const {data}=await supa.from('orders').select('*').eq('hotel_id',hotel_id).order('created_at',{ascending:false});
  res.json({data:data||[]});
});

// HEALTH
app.get("/api/health", (req,res)=> res.json({ok:true, time:new Date(), service:"GuestHub OS 14.0 Ultimate - Fixed"}));

// FRONTEND ROUTES
const sendPublic = (file) => (req,res) => {
  const full = path.join(publicPath, file);
  res.sendFile(full, (err)=>{
    if(err){
      res.sendFile(path.join(__dirname, file), (e2)=>{
        if(e2) res.status(404).send(`File ${file} not found - put it in public/ folder`);
      });
    }
  });
};

app.get("/guest", sendPublic("guest.html"));
app.get("/guest.html", sendPublic("guest.html"));
app.get("/admin", sendPublic("admin.html"));
app.get("/admin.html", sendPublic("admin.html"));
app.get("/gm-dashboard", sendPublic("gm-dashboard.html"));
app.get("/gm-dashboard.html", sendPublic("gm-dashboard.html"));
app.get("/hotel", sendPublic("hotel-dashboard.html"));
app.get("/vendor", sendPublic("vendor-dashboard.html"));
app.get("/", sendPublic("index.html"));

app.get("*", (req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({ok:false, error:"API Not Found: "+req.path});
  return res.sendFile(path.join(publicPath,"index.html"), (err)=>{
    if(err) res.status(404).send("GuestHub OS - File not found. Ensure public/index.html exists");
  });
});

app.listen(PORT, ()=>console.log(`👑 GuestHub OS 14.0 ULTIMATE running on ${PORT} - trust proxy fixed ✅`));
