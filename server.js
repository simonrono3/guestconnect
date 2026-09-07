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
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_Secured_OS_18_Clean_Change_In_Render";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if(!SUPABASE_URL||!SUPABASE_KEY){ console.error("❌ Missing SUPABASE env"); process.exit(1); }

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY||SUPABASE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});

// ====== MIDDLEWARE ======
app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:false, crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:"200kb"}));
app.use(express.urlencoded({extended:true,limit:"200kb"}));
app.use(cors({origin:(o,cb)=>{ if(!o) return cb(null,true); return cb(null,true); },credentials:true}));

const publicPath = path.join(__dirname,"public");
app.use(express.static(publicPath, { maxAge: '1d', etag: true }));
app.use(express.static(__dirname, { maxAge: '1d' }));

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

// ====== NEW OS 18.0 - WHATSAPP AUTO ROUTING HELPER (GM SETUP) ======
async function routeOrderToDepartment(order) {
  try {
    const hotel_id = order.hotel_id || 'BAOBAB';
    const dept = (order.department || 'kitchen').toLowerCase();
    const { data: deptData } = await supa.schema('guesthub_os').from('departments').select('*').eq('hotel_id', hotel_id).eq('name', dept).maybeSingle();
    let waNumber = deptData?.whatsapp_number;
    if (!waNumber) {
      const { data: hotel } = await supa.from('hotels').select('*').eq('hotel_id', hotel_id).maybeSingle();
      waNumber = hotel?.phone || '254700000000';
    }
    const itemsStr = Array.isArray(order.items) ? order.items.map(i=>`${i.name||i.title} x${i.qty||1}`).join(', ') : (order.service_title||'Service');
    const msg = `🔔 *NEW ORDER - ${dept.toUpperCase()}* - ${hotel_id}\n\n👤 Guest: ${order.guest_name}\n🏨 Room: ${order.room_number} - ${order.table_id||''}\n📞 Phone: ${order.guest_phone}\n📋 Order: ${itemsStr}\n💰 Total: Ksh ${order.total||order.amount||0}\n📍 ${order.location_label||''}\n⏰ ${new Date().toLocaleString()}\n\n_GuestHub Auto Routing - GM Setup_`;
    if(order.id){
      await supa.schema('guesthub_os').from('orders').update({ whatsapp_sent_to: waNumber }).eq('id', order.id);
    }
    const waLink = `https://wa.me/${String(waNumber).replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`;
    console.log(`📱 AUTO ROUTED ${dept} -> ${waNumber}`);
    return { sent: true, to: waNumber, dept, msg, waLink };
  } catch (e) {
    console.error('Route error', e);
    return { sent: false, error: e.message };
  }
}

// ====== AUTH ROUTES (YAKO YA ZAMANI) ======
app.post("/api/admin/login",loginLimiter, async(req,res)=>{ try{const pw=String(req.body.password||""); if(!pw) return sendError(res,400,"Password required"); const valid=await bcrypt.compare(pw,ADMIN_PASSWORD).catch(()=>false); if(!(valid||pw===ADMIN_PASSWORD)) return sendError(res,401,"Wrong password"); const token=createToken({role:"admin",scope:"full"}); return sendSuccess(res,{token}); }catch(e){return sendError(res,500,"Server error");}});
app.post("/api/hotels/signup",signupLimiter, async(req,res)=>{ try{const {hotel_name,name,manager_name,location,city,hotel_type,rooms,website,email,phone,password}=req.body; const finalName=cleanText(hotel_name||name,100); const finalEmail=clean(email); if(!finalName||finalName.length<3) return sendError(res,400,"Hotel name min 3 chars"); if(!isValidEmail(finalEmail)) return sendError(res,400,"Invalid email"); if(!password||String(password).length<8) return sendError(res,400,"Password min 8 chars"); let baseId=finalName.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,20); if(!baseId) baseId="hotel"; let hotelId=baseId, suf=1; while(true){const {data}=await supa.from("hotels").select("id").or(`id.eq.${hotelId},hotel_id.eq.${hotelId}`).limit(1); if(!data||!data.length) break; hotelId=`${baseId}${suf++}`; if(suf>999) return sendError(res,500,"ID gen failed");} const hash=await bcrypt.hash(String(password),12); const payload={id:hotelId,hotel_id:hotelId,name:finalName,hotel_name:finalName,location:cleanText(location||city,100),city:cleanText(city,80),hotel_type:cleanText(hotel_type||"Hotel",30),manager_name:cleanText(manager_name,100),rooms:safeNumber(rooms),website:cleanText(website,200),email:finalEmail,phone:cleanText(phone,30),password:hash,password_hash:hash,status:"PENDING",plan:"Upendo",price:6500}; const {error}=await supa.from("hotels").insert([payload]); if(error){ if(error.code==="23505") return sendError(res,409,"Hotel exists"); throw error; } return sendSuccess(res,{hotel_id:hotelId,status:"PENDING",message:"Pending approval"});}catch(e){console.error(e); return sendError(res,500,"Unable to register");}});
app.post("/api/hotel/login",loginLimiter, async(req,res)=>{ try{const {hotelId,hotel_id,password}=req.body; if(!password) return sendError(res,400,"Password required"); const id=clean(hotelId||hotel_id); if(!id) return sendError(res,400,"Hotel ID required"); const {data:hotel,error}=await supa.from("hotels").select("*").or(`id.eq.${id},hotel_id.eq.${id}`).limit(1).maybeSingle(); if(error) throw error; if(!hotel) return sendError(res,404,"Hotel not found"); const hash=hotel.password_hash||hotel.password; const valid=await bcrypt.compare(String(password),hash); if(!valid) return sendError(res,401,"Wrong password"); const st=String(hotel.status||"").toUpperCase(); if(st!=="APPROVED") return sendError(res,403,`Not approved: ${st}. Wait for admin.`); const token=createToken({role:"hotel",hotel_id:hotel.hotel_id||hotel.id}); const safe={...hotel}; delete safe.password; delete safe.password_hash; return sendSuccess(res,{token,hotel:safe}); }catch(e){return sendError(res,500,"Server error");}});
app.post("/api/vendor/login",loginLimiter, async(req,res)=>{ try{const {email}=req.body; if(!email) return sendError(res,400,"Email required"); const {data:v,error}=await supa.from("vendors").select("*").eq("email",clean(email)).maybeSingle(); if(error) throw error; if(!v) return sendError(res,404,"Vendor not found"); if(String(v.status||"").toLowerCase()==="pending") return sendError(res,403,"Pending approval"); if(String(v.status||"").toLowerCase()==="rejected") return sendError(res,403,"Rejected"); const token=createToken({role:"vendor",vendor_id:v.id,email:v.email}); return sendSuccess(res,{token,vendor:v}); }catch(e){return sendError(res,500,"Server error");}});

// ====== NEW OS 18.0 ROUTES - GM + GUEST SYNCED =====
// DEPARTMENTS - GM SETUP WHATSAPP PER DEPARTMENT
app.get("/api/departments", async (req,res)=>{
  const hotel_id = clean(req.query.hotel_id||'BAOBAB');
  const { data } = await supa.schema('guesthub_os').from('departments').select('*').eq('hotel_id', hotel_id.toUpperCase());
  res.json(data||[]);
});
app.post("/api/departments", async (req,res)=>{
  const { hotel_id, name, whatsapp_number } = req.body;
  if(!name||!whatsapp_number) return sendError(res,400,"Name and whatsapp_number required");
  const { data, error } = await supa.schema('guesthub_os').from('departments').upsert({ hotel_id: (hotel_id||'BAOBAB').toUpperCase(), name: clean(name), whatsapp_number: cleanText(whatsapp_number,20) }, { onConflict: 'hotel_id,name' }).select().single();
  if(error) return sendError(res,500,error.message);
  res.json(data);
});

// MENU - GM ADD, GUEST SEE (guesthub_os)
app.get("/api/menu", async (req,res)=>{
  const hotel_id = (req.query.hotel_id||'BAOBAB').toString().toUpperCase();
  const { data } = await supa.schema('guesthub_os').from('menu_items').select('*').eq('hotel_id', hotel_id).eq('is_active', true).order('created_at',{ascending:false});
  res.json(data||[]);
});
app.post("/api/menu", async (req,res)=>{
  const { hotel_id, name, price, category, description, added_by_gm } = req.body;
  if(!name||price===undefined) return sendError(res,400,"Name and price required");
  const { data, error } = await supa.schema('guesthub_os').from('menu_items').insert([{ hotel_id: (hotel_id||'BAOBAB').toUpperCase(), name: cleanText(name,100), price: safeNumber(price), category: cleanText(category||'Food',30), description: cleanText(description,300), added_by_gm }]).select().single();
  if(error) return sendError(res,500,error.message);
  res.json(data);
});
app.delete("/api/menu/:id", async (req,res)=>{
  await supa.schema('guesthub_os').from('menu_items').delete().eq('id', req.params.id);
  res.json({ok:true});
});

// SERVICES - GM ADD SERVICES LIKE TAXI, TOURS (guesthub_os)
app.get("/api/services", async (req,res)=>{
  const hotel_id = (req.query.hotel_id||'BAOBAB').toString().toUpperCase();
  const { data } = await supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id', hotel_id).eq('is_active', true).order('created_at',{ascending:false});
  res.json({ data: data||[] });
});
app.post("/api/services", async (req,res)=>{
  const { hotel_id, title, department, price, icon, description } = req.body;
  if(!title) return sendError(res,400,"Title required");
  const { data, error } = await supa.schema('guesthub_os').from('hotel_services').insert([{ hotel_id: (hotel_id||'BAOBAB').toUpperCase(), title: cleanText(title,100), department: clean(department||'kitchen'), price: safeNumber(price), icon: cleanText(icon||'🏨',10), description: cleanText(description,300) }]).select().single();
  if(error) return sendError(res,500,error.message);
  res.json(data);
});
app.delete("/api/services/:id", async (req,res)=>{
  await supa.schema('guesthub_os').from('hotel_services').delete().eq('id', req.params.id);
  res.json({ok:true});
});

// ORDERS - GUEST ORDER + AUTO ROUTE TO DEPT WHATSAPP (CORE)
app.get("/api/orders", async (req,res)=>{
  const hotel_id = (req.query.hotel_id||'BAOBAB').toString().toUpperCase();
  // Try guesthub_os first (new OS)
  const { data } = await supa.schema('guesthub_os').from('orders').select('*').eq('hotel_id', hotel_id).order('created_at',{ascending:false}).limit(200);
  res.json({ data: data||[] });
});
app.post("/api/orders", async (req,res)=>{
  try{
    const { hotel_id, room, room_number, table_id, guest_name, guest_phone, items, service_title, service, amount, total, notes, category, department } = req.body;
    const hotelId = (hotel_id||'BAOBAB').toString().toUpperCase();
    if(!room && !room_number) return sendError(res,400,"Room required");
    const finalItems = items || [{ name: service_title||service||'Service', qty: 1, price: amount||total||0 }];
    const finalTotal = safeNumber(total||amount|| (Array.isArray(finalItems)? finalItems.reduce((s,i)=>s+safeNumber(i.price*i.qty,0),0):0));
    const finalDept = clean(department||category||'kitchen');
    const payload = {
      hotel_id: hotelId,
      room_number: cleanText(room||room_number,30),
      table_id: cleanText(table_id||`T${cleanText(room||room_number,30)}`,30),
      guest_name: cleanText(guest_name||'Guest',100),
      guest_phone: cleanText(guest_phone,30),
      items: finalItems,
      total: finalTotal,
      amount: finalTotal,
      status: 'pending',
      department: finalDept,
      location_label: `Room ${room||room_number} - ${guest_name} - ${guest_phone} ${notes? '- '+notes:''}`.slice(0,500),
      service_title: cleanText(service_title||service,150)
    };
    const { data, error } = await supa.schema('guesthub_os').from('orders').insert([payload]).select('*').single();
    if(error) throw error;
    // AUTO ROUTE TO WHATSAPP SET BY GM!
    const routing = await routeOrderToDepartment(data);
    return sendSuccess(res,{ order: data, routing });
  }catch(e){ console.error(e); return sendError(res,500,"Unable to create order: "+e.message); }
});
app.post("/api/orders/auto-route", async (req,res)=>{
  const routing = await routeOrderToDepartment(req.body);
  res.json({ok:true,...routing});
});

// ====== YOUR EXISTING DASHBOARD APIS (UPDATED TO USE guesthub_os) ======
app.get("/api/auth/me", async(req,res)=>{ const d=verifyToken(req); if(!d) return sendError(res,401,"Invalid token"); if(d.role==="hotel"){ const {data:h}=await supa.from("hotels").select(SAFE_HOTEL_FIELDS).or(`id.eq.${d.hotel_id},hotel_id.eq.${d.hotel_id}`).maybeSingle(); return sendSuccess(res,{user:d,hotel:h}); } if(d.role==="vendor"){ const {data:v}=await supa.from("vendors").select("*").eq("id",d.vendor_id).maybeSingle(); return sendSuccess(res,{user:d,vendor:v}); } return sendSuccess(res,{user:d}); });
app.get("/api/gm/dashboard", requireHotel, async(req,res)=>{ const hotelId=req.user.hotel_id.toUpperCase(); const [hotelR,ordersR,servicesR,menuR]=await Promise.all([ supa.from("hotels").select(SAFE_HOTEL_FIELDS).or(`id.eq.${hotelId},hotel_id.eq.${hotelId}`).maybeSingle(), supa.schema('guesthub_os').from('orders').select('*').eq('hotel_id',hotelId).order('created_at',{ascending:false}).limit(200), supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id',hotelId).order('created_at',{ascending:false}), supa.schema('guesthub_os').from('menu_items').select('*').eq('hotel_id',hotelId).order('created_at',{ascending:false}) ]); const orders=ordersR.data||[]; const revenue=orders.reduce((s,o)=>s+safeNumber(o.total||o.amount||0),0); return sendSuccess(res,{hotel:hotelR.data,orders,services:servicesR.data||[],items:menuR.data||[],revenue,todayOrders:orders.length,activeVendors:0}); });
app.get("/api/gm/orders", requireHotel, async(req,res)=>{ const {data,error}=await supa.schema('guesthub_os').from('orders').select('*').eq('hotel_id',req.user.hotel_id.toUpperCase()).order('created_at',{ascending:false}).limit(500); if(error) return sendError(res,500,error.message); return sendSuccess(res,{orders:data||[]}); });
app.get("/api/gm/services", requireHotel, async(req,res)=>{ const {data,error}=await supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id',req.user.hotel_id.toUpperCase()).order('created_at',{ascending:false}); if(error) return sendError(res,500,error.message); return sendSuccess(res,{services:data||[]}); });
app.patch("/api/gm/whatsapp", requireHotel, async(req,res)=>{ 
  const hotelId=req.user.hotel_id.toUpperCase();
  const fields=["whatsapp_kitchen","whatsapp_house","whatsapp_housekeeping","whatsapp_laundry","whatsapp_spa","whatsapp_taxi","whatsapp_tours","whatsapp_media","whatsapp_front","whatsapp_frontdesk"];
  const payload={}; 
  const deptMap={ whatsapp_kitchen:'kitchen', whatsapp_house:'housekeeping', whatsapp_housekeeping:'housekeeping', whatsapp_laundry:'laundry', whatsapp_spa:'spa', whatsapp_taxi:'taxi', whatsapp_tours:'tours', whatsapp_media:'frontdesk', whatsapp_front:'frontdesk', whatsapp_frontdesk:'frontdesk' };
  for(const f of fields){ if(req.body[f]!==undefined){ payload[f]=cleanText(req.body[f],30); const dept=deptMap[f]; if(dept && payload[f]){ await supa.schema('guesthub_os').from('departments').upsert({ hotel_id: hotelId, name: dept, whatsapp_number: payload[f] }, { onConflict: 'hotel_id,name' }); } } }
  if(!Object.keys(payload).length) return sendError(res,400,"No fields");
  const {data,error}=await supa.from("hotels").update(payload).or(`id.eq.${req.user.hotel_id},hotel_id.eq.${req.user.hotel_id}`).select(SAFE_HOTEL_FIELDS).maybeSingle(); if(error) return sendError(res,500,error.message); return sendSuccess(res,{hotel:data}); 
});
app.patch("/api/orders/:id/status", requireHotel, async(req,res)=>{ const id=clean(req.params.id); const {status}=req.body; const {error}=await supa.schema('guesthub_os').from('orders').update({status:cleanText(status,30)}).eq('id',id).eq('hotel_id',req.user.hotel_id.toUpperCase()); if(error) return sendError(res,500,error.message); return sendSuccess(res,{status}); });

// ADMIN
app.get("/api/hotels", requireAdmin, async(req,res)=>{ const {data,error}=await supa.from("hotels").select(SAFE_HOTEL_FIELDS).order("created_at",{ascending:false}).limit(1000); if(error) return sendError(res,500,error.message); return res.json(data||[]); });
app.get("/api/admin/vendors", requireAdmin, async(req,res)=>{ const {data,error}=await supa.from("vendors").select("*").order("created_at",{ascending:false}).limit(1000); if(error) return sendError(res,500,error.message); return res.json(data||[]); });
app.patch("/api/admin/vendors/:id", requireAdmin, async(req,res)=>{ const id=clean(req.params.id); const status=cleanText(req.body.status,30).toLowerCase(); if(!["pending","approved","rejected","blocked"].includes(status)) return sendError(res,400,"Invalid status"); const {data,error}=await supa.from("vendors").update({status}).eq("id",id).select("*").maybeSingle(); if(error) return sendError(res,500,error.message); return sendSuccess(res,{vendor:data}); });
async function approveHotel(req,res){ try{ const id=clean(req.params.id); const plan=cleanText(req.body.plan||"Upendo",30); const price=plan==="Bahari"?12000:plan==="Karibu"?25000:6500; const {data,error}=await supa.from("hotels").update({status:"APPROVED",approved_by_admin:true,plan,price}).or(`id.eq.${id},hotel_id.eq.${id}`).select(SAFE_HOTEL_FIELDS).maybeSingle(); if(error) throw error; return sendSuccess(res,{hotel:data}); }catch(e){return sendError(res,500,e.message);} }
app.post("/api/hotels/:id/approve", requireAdmin, approveHotel);
app.post("/api/admin/approve/:id", requireAdmin, approveHotel);
app.delete("/api/hotels/:id", requireAdmin, async(req,res)=>{ try{ const id=clean(req.params.id); await supa.schema('guesthub_os').from('hotel_services').delete().eq('hotel_id', id.toUpperCase()); await supa.schema('guesthub_os').from('menu_items').delete().eq('hotel_id', id.toUpperCase()); await supa.schema('guesthub_os').from('orders').delete().eq('hotel_id', id.toUpperCase()); const {error}=await supa.from("hotels").delete().or(`id.eq.${id},hotel_id.eq.${id}`); if(error) throw error; return sendSuccess(res); }catch(e){return sendError(res,500,e.message);} });
app.get("/api/admin/stats", requireAdmin, async(req,res)=>{ try{ const [hotels,vendors,services,orders]=await Promise.all([ supa.from("hotels").select("id,status",{count:"exact"}), supa.from("vendors").select("id,status",{count:"exact"}), supa.schema('guesthub_os').from('hotel_services').select("id",{count:"exact"}), supa.schema('guesthub_os').from('orders').select("id,total,status") ]); const orderData=orders.data||[]; const gmv=orderData.reduce((s,o)=>s+safeNumber(o.total||0),0); const commission=Math.floor(gmv*0.15); return sendSuccess(res,{hotels:hotels.count||0,vendors:vendors.count||0,pendingVendors:(vendors.data||[]).filter(v=>String(v.status).toLowerCase()==="pending").length,pendingHotels:(hotels.data||[]).filter(h=>String(h.status).toUpperCase()==="PENDING").length,services:services
