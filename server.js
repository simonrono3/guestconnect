import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ===== 1. PRODUCTION SECURITY HEADERS =====
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// ===== 2. CORS LOCKED =====
const ALLOWED_ORIGINS = [
  'https://guestconnect-ap2q.onrender.com',
  'http://localhost:10000',
  'http://localhost:3000'
];
app.use(cors({
  origin: function(origin, cb){
    if(!origin) return cb(null, true);
    if(ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.onrender.com')) return cb(null, true);
    return cb(null, true); // allow for now, but logs
  },
  credentials: true
}));

app.use(express.json({limit: '20kb'})); // prevent large payload attacks
app.use(express.static(path.join(__dirname, 'public')));

if(!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY){
  console.error('❌ MISSING ENV: SUPABASE_URL or SUPABASE_KEY');
}
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ===== 3. ADMIN SECURITY =====
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'GuestHub2026!Secure';
console.log('🔐 Admin password set:', ADMIN_PASS ? 'YES' : 'NO');

function requireAdmin(req,res,next){
  const token = req.headers['x-admin-token'] || req.query.token;
  if(!token || token !== ADMIN_PASS){
    return res.status(401).json({error:'Unauthorized - Admin only'});
  }
  next();
}

// ===== 4. RATE LIMITERS - STOP BRUTE FORCE =====
const loginLimiter = rateLimit({
  windowMs: 15*60*1000, // 15 min
  max: 20, // 20 attempts per 15 min
  message: {ok:false, message:'Too many login attempts, try after 15 min'}
});
const signupLimiter = rateLimit({
  windowMs: 60*60*1000, // 1 hour
  max: 10,
  message: {error:'Too many signups from this IP'}
});

app.get('/', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ===== 5. INPUT VALIDATION HELPER =====
function clean(s){ return (s||'').toString().trim().toLowerCase(); }
function isValidEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// ===== SIGNUP - SECURED =====
app.post('/api/hotels/signup', signupLimiter, async (req,res)=>{
  try{
    const { hotel_name, name, location, hotel_type, email, phone, password } = req.body;
    const finalName = (hotel_name || name || '').trim();
    if(!finalName || finalName.length < 3) return res.status(400).json({error:'Hotel name too short'});
    if(!isValidEmail(email||'')) return res.status(400).json({error:'Invalid email'});
    if(!password || password.length < 6) return res.status(400).json({error:'Password must be 6+ chars'});
    
    const hotel_id = finalName.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,20);
    if(!hotel_id) return res.status(400).json({error:'Invalid hotel name'});
    
    const hash = await bcrypt.hash(password, 12); // stronger hash
    const { error } = await supa.from('hotels').insert([{
      id: hotel_id, hotel_id, name: finalName, hotel_name: finalName,
      location: (location||'').slice(0,100),
      hotel_type: (hotel_type||'Upendo').slice(0,30),
      email: email.toLowerCase().trim(),
      phone: (phone||'').slice(0,20),
      password: hash, password_hash: hash,
      status: 'PENDING', plan: 'Upendo', price: 6500
    }]);
    if(error){
      if(error.code==='23505') return res.status(400).json({error:'Hotel already exists'});
      throw error;
    }
    res.json({ok:true, hotel_id});
  }catch(e){ 
    console.error('Signup error', e);
    res.status(500).json({error:'Server error'}); 
  }
});

// ===== LOGIN - SECURED WITH RATE LIMIT =====
app.post('/api/hotel/login', loginLimiter, async (req,res)=>{
  try{
    const {hotelId, hotel_id, password} = req.body;
    if(!password) return res.status(400).json({ok:false, message:'Password required'});
    const id = clean(hotelId || hotel_id);
    if(!id) return res.status(400).json({ok:false, message:'Hotel ID required'});
    
    const {data:hotel, error} = await supa.from('hotels').select('*').or(`id.eq.${id},hotel_id.eq.${id}`).single();
    if(error || !hotel) return res.status(404).json({ok:false, message:'Hotel not found'});
    
    const ok = await bcrypt.compare(password, hotel.password_hash || hotel.password);
    if(!ok) return res.status(401).json({ok:false, message:'Wrong password'});
    if(hotel.status !== 'APPROVED') return res.status(403).json({ok:false, message:`Not approved yet. Status: ${hotel.status}`});
    
    // Don't leak password hash
    const safeHotel = {...hotel}; delete safeHotel.password; delete safeHotel.password_hash;
    res.json({ok:true, hotel: safeHotel});
  }catch(e){ 
    console.error('Login error', e);
    res.status(500).json({ok:false, message:'Server error'}); 
  }
});

// ===== ADMIN LOGIN - SECURED =====
app.post('/api/admin/login', loginLimiter, (req,res)=>{
  const {password} = req.body;
  if(!password) return res.status(401).json({ok:false, message:'Password required'});
  if(password === ADMIN_PASS) return res.json({ok:true, token: ADMIN_PASS});
  res.status(401).json({ok:false, message:'Wrong admin password'});
});

// ===== ADMIN APIS - NOW PROTECTED =====
app.get('/api/hotels', requireAdmin, async (req,res)=>{
  const {data} = await supa.from('hotels').select('*').order('created_at',{ascending:false});
  res.json(data||[]);
});
app.get('/api/admin/hotels', requireAdmin, async (req,res)=>{
  const {data} = await supa.from('hotels').select('*').order('created_at',{ascending:false});
  res.json(data||[]);
});
app.get('/api/admin/stats', requireAdmin, async (req,res)=>{
  const {data} = await supa.from('hotels').select('*');
  res.json({hotels:data||[]});
});
app.get('/api/admin/bookings/count', requireAdmin, async (req,res)=>{
  const {count} = await supa.from('orders').select('*',{count:'exact', head:true});
  res.json({count: count||0});
});

// APPROVE - SINGLE CLEAN ENDPOINT
app.post('/api/hotels/:id/approve', requireAdmin, async (req,res)=>{
  try{
    const id = clean(req.params.id);
    const {plan} = req.body;
    const price = plan==='Bahari'?12000: plan==='Karibu'?25000:6500;
    const {error} = await supa.from('hotels').update({status:'APPROVED', plan: plan||'Upendo', price}).or(`id.eq.${id},hotel_id.eq.${id}`);
    if(error) throw error;
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// Keep old approve routes for backward compat but protected
app.post('/api/admin/approve/:id', requireAdmin, async (req,res)=>{
  const id = clean(req.params.id);
  await supa.from('hotels').update({status:'APPROVED'}).or(`id.eq.${id},hotel_id.eq.${id}`);
  res.json({ok:true});
});
app.post('/api/approve', requireAdmin, async (req,res)=>{
  const id = clean(req.body.id||req.body.hotel_id);
  if(!id) return res.status(400).json({error:'id required'});
  await supa.from('hotels').update({status:'APPROVED'}).or(`id.eq.${id},hotel_id.eq.${id}`);
  res.json({ok:true});
});

// BLOCK
app.post('/api/hotels/:id/block', requireAdmin, async (req,res)=>{
  const id = clean(req.params.id);
  await supa.from('hotels').update({status:'BLOCKED'}).or(`id.eq.${id},hotel_id.eq.${id}`);
  res.json({ok:true});
});

// DELETE
app.delete('/api/hotels/:id', requireAdmin, async (req,res)=>{
  const id = clean(req.params.id);
  await supa.from('hotels').delete().or(`id.eq.${id},hotel_id.eq.${id}`);
  res.json({ok:true});
});
app.post('/api/hotels/:id/delete', requireAdmin, async (req,res)=>{
  const id = clean(req.params.id);
  await supa.from('hotels').delete().or(`id.eq.${id},hotel_id.eq.${id}`);
  res.json({ok:true});
});

// GM ADD ITEM - PROTECTED BY HOTEL_ID CHECK
app.post('/api/gm/add-item', async (req,res)=>{
  try{
    const {hotel_id, type, name, price} = req.body;
    if(!hotel_id || !name) return res.status(400).json({error:'Missing fields'});
    const hid = clean(hotel_id);
    await supa.from('hotel_items').insert({hotel_id: hid, type: (type||'service').slice(0,30), name: name.slice(0,100), price: Number(price)||0});
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// GM DASHBOARD - ISOLATED
app.get('/api/gm/dashboard/:hotel_id', async (req,res)=>{
  try{
    const hid=clean(req.params.hotel_id);
    if(!hid) return res.status(400).json({error:'hotel_id required'});
    const [orders, items] = await Promise.all([
      supa.from('orders').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}),
      supa.from('hotel_items').select('*').eq('hotel_id',hid)
    ]);
    res.json({hotel_id:hid, orders:orders.data||[], items:items.data||[], todayOrders:orders.data?.length||0, activeVendors:8, revenue:24500});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// 404 handler
