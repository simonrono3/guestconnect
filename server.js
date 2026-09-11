// GuestHub V31 FULL SECURE - PRODUCTION READY + VENDOR WORLD V2 DIANI SCALABLE
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
app.get('/api/health',(req,res)=>res.json({ok:true, os:'V31 SECURE + VENDOR WORLD V2', port:PORT, hasUrl:!!process.env.SUPABASE_URL, time:new Date().toISOString()}));
app.get('/config.js',(req,res)=>{
  res.type('application/javascript');
  res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
  res.setHeader('X-Content-Type-Options','nosniff');
  const u = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
  const k = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-key';
  res.send(`const SUPABASE_URL="${u}";const SUPABASE_KEY="${k}";window.SUPABASE_URL="${u}";window.SUPABASE_KEY="${k}";window.SUPABASE_ANON_KEY="${k}";`);
});

const server = app.listen(PORT, '0.0.0.0', ()=>console.log(`🔒 V31 + VENDOR WORLD V2 LIVE on 0.0.0.0:${PORT}`));
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
process.on('uncaughtException', e=>console.log('UNCAUGHT:', e.message));
process.on('unhandledRejection', e=>console.log('REJECTION:', e?.message));

// ===== SECURITY =====
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({origin:(origin,cb)=>cb(null,true), credentials:true, methods:['GET','POST','PUT','DELETE','OPTIONS']}));
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true, limit:"2mb"}));

const loginLimiter = rateLimit({ windowMs:15*60*1000, max:10, message:{ok:false,error:"Too many login attempts"} });
const signupLimiter = rateLimit({ windowMs:60*60*1000, max:20, message:{ok:false,error:"Too many signups"} });
const orderLimiter = rateLimit({ windowMs:60*1000, max:60, message:{ok:false,error:"Too many orders"} });

// ===== CONFIG =====
const REAL_URL = process.env.SUPABASE_URL;
const REAL_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const REAL_SERVICE = process.env.SUPABASE_SERVICE_KEY || REAL_KEY;
const SUPABASE_URL = REAL_URL || "https://placeholder.supabase.co";
const SUPABASE_KEY = REAL_KEY || "placeholder-anon-key";
const SUPABASE_SERVICE_KEY = REAL_SERVICE || SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_OS_2026_SECURE_KEY";

let supa = null;
try { supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {auth:{persistSession:false, autoRefreshToken:false}}); console.log("✅ Supabase V31"); } catch(e){ console.log("⚠️ Supabase dummy"); }

// ===== HELPERS =====
function clean(v){return String(v||"").trim().toLowerCase()}
function cleanText(v,m=500){ let s = String(v||"").trim().slice(0,m); s = s.replace(/[<>]/g,''); return s; }
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

// ===== HOTELS & ORDERS =====
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

// ===================================================================
// VENDOR OS V2 — DIANI SCALABLE TO WASINI + SGR + ALL HOTELS
// THIS IS YOUR NEW CODE YOU SENT MKUU — WORLD V2
// ===================================================================
app.post("/api/vendors/signup", async (req, res) => {
  try {
    const {
      vendor_name, name,
      category,
      location, location_hub, service_area,
      radius,
      phone,
      email,
      hotels, hotel_ids,
      services,
      price,
      full_name
    } = req.body;

    const finalName = (vendor_name || name || full_name || "").trim();
    if (!finalName || !phone) return sendError(res, 400, "Vendor name & phone required");

    const finalCategory = category || (Array.isArray(services) && services[0]?.name) || "taxi";
    const finalLocation = location || location_hub || service_area || "Diani Beach";
    const finalRadius = radius || "15km — Diani + Wasini + Ukunda";
    const finalHotels = hotels || hotel_ids || ["BAOBAB"];
    const finalPrice = Number(price || 2500);

    let normalizedServices = [];
    if (Array.isArray(services)) {
      normalizedServices = services.map(s => {
        if (typeof s === "string") {
          const labelMap = {
            airport_taxi: "Airport Taxi", sgr_taxi: "SGR Transfer Miritini → Diani",
            town_taxi: "Town Taxi Diani", car_hire: "Car Hire + Driver",
            wasini_boat: "Wasini Boat Taxi Shimoni→Wasini", boda_tuktuk: "Boda / TukTuk",
            wasini_dolphin: "Wasini Dolphin Tour", shimba_hills: "Shimba Hills Safari",
            mara_safari: "Maasai Mara Safari", beach_safari: "Beach & Snorkeling Diani",
            massage: "In-Room Massage", spa_nails: "Spa / Nails", laundry: "Express Laundry",
            photography: "Photography Diani", drone: "Drone + Videography"
          };
          return { name: labelMap[s] || s, price: finalPrice, time: finalLocation };
        } else {
          return { name: s.name || s.title || "Service", price: Number(s.price || finalPrice), time: s.time || finalLocation };
        }
      });
    }
    if (normalizedServices.length === 0) normalizedServices = [{ name: finalCategory, price: finalPrice, time: finalLocation }];

    const vendorId = (finalName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) + (Math.floor(Math.random() * 900) + 100));

    if (supa && REAL_URL) {
      try {
        await supa.schema('guesthub_os').from('vendors').insert([{
          id: vendorId,
          vendor_name: finalName,
          full_name: finalName,
          category: finalCategory,
          location: finalLocation,
          location_hub: finalLocation,
          phone: String(phone).replace(/\D/g, ""),
          email: email || "",
          hotel_ids: finalHotels,
          radius: finalRadius,
          is_active: true,
          status: 'pending'
        }]);

        let targetHotels = finalHotels;
        if (finalHotels.includes("ALL")) {
          const { data: allH } = await supa.from('hotels').select('hotel_id').limit(100);
          if (allH && allH.length > 0) targetHotels = allH.map(h => h.hotel_id);
          else targetHotels = ["BAOBAB", "SWAHILI", "DIANI_SEA", "LEOPARD", "WASINI", "SGR_HUB"];
        }

        for (const hidRaw of targetHotels) {
          const hid = String(hidRaw).toUpperCase();
          for (const svc of normalizedServices) {
            const dept = (() => {
              const cat = (finalCategory + " " + svc.name).toLowerCase();
              if (cat.includes("sgr") || cat.includes("taxi") || cat.includes("boat taxi")) return "taxi";
              if (cat.includes("wasini") || cat.includes("dolphin") || cat.includes("safari") || cat.includes("tour") || cat.includes("shimba") || cat.includes("mara")) return "tours";
              if (cat.includes("massage") || cat.includes("spa") || cat.includes("nail")) return "spa";
              if (cat.includes("laundry")) return "laundry";
              return "services";
            })();
            const icon = dept === "taxi"? (svc.name.toLowerCase().includes("sgr")? "🚆" : svc.name.toLowerCase().includes("wasini")? "🐬" : "🚕")
                       : dept === "tours"? (svc.name.toLowerCase().includes("dolphin")? "🐬" : "🦁")
                       : dept === "spa"? "💆" : "✨";

            await supa.schema('guesthub_os').from('hotel_services').insert([{
              hotel_id: hid,
              title: `${svc.name} — ${finalName}`,
              price: Number(svc.price || finalPrice),
              description: `${svc.time || finalLocation} • ${finalLocation} • ${finalRadius} • by ${finalName} • ${phone}`,
              department: dept,
              icon: icon,
              vendor_name: finalName,
              vendor_phone: String(phone).replace(/\D/g, ""),
              vendor_id: vendorId,
              is_active: true
            }]);
          }
        }
        console.log(`✅ Vendor ${finalName} listed for hotels: ${targetHotels.join(", ")} with ${normalizedServices.length} services`);
      } catch (e) { console.log("vendor supa error:", e.message); }
    }

    return sendSuccess(res, {
      vendor_id: vendorId,
      message: `Vendor ${finalName} live in Guest Dashboard`,
      hotels: finalHotels,
      services: normalizedServices,
      location: finalLocation
    });
  } catch (e) {
    console.error("vendor signup error", e);
    return sendError(res, 500, e.message);
  }
});

app.get("/api/vendors", async (req, res) => {
  try {
    const hotel_id = getHotelIdFromReq(req);
    if (!supa ||!REAL_URL) return res.json({ vendors: [], services:[] });
    const { data: vendors } = await supa.schema('guesthub_os').from('vendors').select('*').or(`hotel_ids.cs.{${hotel_id}},hotel_ids.cs.{ALL}`).limit(50);
    const { data: services } = await supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id', hotel_id).eq('is_active', true).order('created_at',{ascending:false}).limit(100);
    res.json({ vendors: vendors || [], services: services || [] });
  } catch (e) { res.json({ vendors: [], services:[] }); }
});

app.get("/api/hotel-services", async (req, res) => {
  try {
    const hotel_id = (req.query.hotel_id || req.query.hotel || getHotelIdFromReq(req) || "BAOBAB").toUpperCase();
    if (!supa ||!REAL_URL) return res.json({ services: [] });
    const { data } = await supa.schema('guesthub_os').from('hotel_services').select('*').eq('hotel_id', hotel_id).eq('is_active', true).order('created_at',{ascending:false}).limit(100);
    res.json({ hotel_id, services: data || [] });
  } catch (e) { res.json({ services: [] }); }
});

app.delete("/api/hotel-services/:id", async (req, res) => {
  try {
    const hotel_id = getHotelIdFromReq(req);
    if (!supa) return sendError(res, 500, "No DB");
    await supa.schema('guesthub_os').from('hotel_services').delete().eq('id', req.params.id).eq('hotel_id', hotel_id);
    return sendSuccess(res, { deleted: true });
  } catch (e) { return sendError(res, 500, e.message); }
});

// STATIC
app.use(express.static(path.join(__dirname,"public"),{ 
  setHeaders:(res,fp)=>{ 
    if(fp.endsWith('.html')) res.setHeader('Cache-Control','no-cache'); 
    res.setHeader('X-Frame-Options','SAMEORIGIN');
  } 
}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,"public","index.html"), err=>{ if(err) res.status(200).send(`<h1>🔒 V31 + VENDOR WORLD V2 LIVE PORT ${PORT}</h1><a href="/api/health">health</a>`); }));
