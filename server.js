import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ========== 1. SIGNUP - FIXED FOR TEXT ID (Baobab, etc) ==========
app.post('/api/hotels/signup', async (req,res)=>{
  try{
    const { hotel_name, name, location, hotel_type, email, phone, password } = req.body;
    const finalName = hotel_name || name;
    if(!finalName || !email || !password) return res.status(400).json({error:'Missing fields: name, email, password required'});
    const hotel_id = finalName.toLowerCase().replace(/[^a-z0-9]/g,'');
    const hash = await bcrypt.hash(password, 10);
    const { error } = await supa.from('hotels').insert([{
      id: hotel_id,
      hotel_id: hotel_id,
      name: finalName,
      hotel_name: finalName,
      location: location || null,
      hotel_type: hotel_type || null,
      email: email.toLowerCase().trim(),
      phone: phone || null,
      password: hash,
      password_hash: hash,
      status: 'PENDING',
      plan: 'Upendo',
      price: 6500
    }]);
    if(error){
      if(error.code==='23505') return res.status(400).json({error:'Hotel already exists - name or email used'});
      throw error;
    }
    res.json({ok:true, message:'Application sent! Wait for approval', hotel_id});
  }catch(e){
    console.error('SIGNUP ERROR:', e);
    res.status(500).json({error:e.message});
  }
});

// ========== 2. LOGIN - FOR ALL HOTELS ==========
app.post('/api/hotel/login', async (req,res)=>{
  try{
    const {hotelId, hotel_id, password} = req.body;
    const id = (hotelId || hotel_id || '').toLowerCase().trim();
    if(!id || !password) return res.status(400).json({ok:false, message:'Missing hotelId or password'});
    const {data:hotel, error} = await supa.from('hotels').select('*').or(`id.eq.${id},hotel_id.eq.${id}`).single();
    if(error || !hotel) return res.status(404).json({ok:false, message:'Hotel not found. Check your Hotel ID'});
    const ok = await bcrypt.compare(password, hotel.password_hash || hotel.password);
    if(!ok) return res.status(401).json({ok:false, message:'Wrong password'});
    res.json({ok:true, hotel});
  }catch(e){ res.status(500).json({ok:false, message:e.message}); }
});

// Legacy register route
app.post('/api/hotel/register', async (req,res)=>{
  try{
    const {name, hotelId, email, password} = req.body;
    const finalId = (hotelId || name).toLowerCase().replace(/[^a-z0-9]/g,'');
    const hash = await bcrypt.hash(password, 10);
    const {error} = await supa.from('hotels').insert({id: finalId, hotel_id: finalId, name, hotel_name: name, email: email.toLowerCase(), password: hash, password_hash: hash, status: 'PENDING', plan: 'Upendo'});
    if(error) throw error;
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ========== 3. GM ADD ITEM (Isolated by hotel_id) ==========
app.post('/api/gm/add-item', async (req,res)=>{
  try{
    const {hotel_id, type, name, price, desc, description, img, image_url} = req.body;
    if(!hotel_id) return res.status(400).json({error:'hotel_id missing'});
    const {error} = await supa.from('hotel_items').insert({
      hotel_id: hotel_id.toLowerCase(),
      type, name, price,
      description: desc || description,
      image_url: img || image_url
    });
    if(error) throw error;
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ========== 4. GM DASHBOARD - ONLY HIS HOTEL DATA ==========
app.get('/api/gm/dashboard/:hotel_id', async (req,res)=>{
  try{
    const hotel_id = req.params.hotel_id.toLowerCase();
    const [orders, bookings, items] = await Promise.all([
      supa.from('orders').select('*, hotel_items(*)').eq('hotel_id', hotel_id),
      supa.from('bookings').select('*').eq('hotel_id', hotel_id),
      supa.from('hotel_items').select('*').eq('hotel_id', hotel_id)
    ]);
    res.json({orders:orders.data||[], bookings:bookings.data||[], items:items.data||[]});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ========== 5. ADMIN ==========
app.get('/api/admin/stats', async (req,res)=>{
  try{
    const [hotels, bookings] = await Promise.all([supa.from('hotels').select('*'), supa.from('bookings').select('*')]);
    res.json({hotels: hotels.data||[], bookings: bookings.data||[]});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/admin/approve/:type/:id', async (req,res)=>{
  try{
    const id = req.params.id.toLowerCase();
    const table = req.params.type;
    await supa.from(table).update({status:'Approved'}).eq('id', id);
    await supa.from(table).update({status:'Approved'}).eq('hotel_id', id);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=>console.log(`GUESTHUB 8.5 LIVE ON ${PORT} - BAOBAB READY`));
