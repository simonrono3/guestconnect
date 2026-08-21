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

// SIGNUP
app.post('/api/hotels/signup', async (req,res)=>{
  try{
    const { hotel_name, name, location, hotel_type, email, phone, password } = req.body;
    const finalName = hotel_name || name;
    const hotel_id = finalName.toLowerCase().replace(/[^a-z0-9]/g,'');
    const hash = await bcrypt.hash(password, 10);
    const { error } = await supa.from('hotels').insert([{
      id: hotel_id, hotel_id, name: finalName, hotel_name: finalName,
      location, hotel_type, email: email.toLowerCase().trim(),
      phone, password: hash, password_hash: hash,
      status: 'PENDING', plan: 'Upendo', price: 6500
    }]);
    if(error){
      if(error.code==='23505') return res.status(400).json({error:'Hotel already exists'});
      throw error;
    }
    res.json({ok:true, hotel_id});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// LOGIN
app.post('/api/hotel/login', async (req,res)=>{
  try{
    const {hotelId, hotel_id, password} = req.body;
    const id = (hotelId || hotel_id || '').toLowerCase().trim();
    const {data:hotel} = await supa.from('hotels').select('*').or(`id.eq.${id},hotel_id.eq.${id}`).single();
    if(!hotel) return res.status(404).json({ok:false, message:'Hotel not found'});
    const ok = await bcrypt.compare(password, hotel.password_hash || hotel.password);
    if(!ok) return res.status(401).json({ok:false, message:'Wrong password'});
    if(hotel.status !== 'APPROVED') return res.status(403).json({ok:false, message:`Not approved yet. Status: ${hotel.status}`});
    res.json({ok:true, hotel});
  }catch(e){ res.status(500).json({ok:false, message:e.message}); }
});

// ===== ADMIN APIS - FIXES YOUR SCREENSHOT =====
app.get('/api/hotels', async (req,res)=>{
  const {data} = await supa.from('hotels').select('*').order('created_at',{ascending:false});
  res.json(data||[]);
});
app.get('/api/admin/hotels', async (req,res)=>{
  const {data} = await supa.from('hotels').select('*').order('created_at',{ascending:false});
  res.json(data||[]);
});
app.get('/api/admin/stats', async (req,res)=>{
  const {data} = await supa.from('hotels').select('*');
  res.json({hotels:data||[]});
});

// APPROVE - WORKS WITH YOUR BUTTONS
app.post('/api/hotels/:id/approve', async (req,res)=>{
  const id = req.params.id.toLowerCase();
  const {error} = await supa.from('hotels').update({status:'APPROVED'}).or(`id.eq.${id},hotel_id.eq.${id}`);
  if(error) return res.status(500).json({error:error.message});
  res.json({ok:true});
});
app.post('/api/admin/approve/:id', async (req,res)=>{
  const id = req.params.id.toLowerCase();
  await supa.from('hotels').update({status:'APPROVED'}).or(`id.eq.${id},hotel_id.eq.${id}`);
  res.json({ok:true});
});
app.post('/api/approve', async (req,res)=>{
  const id = (req.body.id||req.body.hotel_id||'').toLowerCase();
  await supa.from('hotels').update({status:'APPROVED'}).or(`id.eq.${id},hotel_id.eq.${id}`);
  res.json({ok:true});
});

// BLOCK
app.post('/api/hotels/:id/block', async (req,res)=>{
  const id = req.params.id.toLowerCase();
  await supa.from('hotels').update({status:'BLOCKED'}).or(`id.eq.${id},hotel_id.eq.${id}`);
  res.json({ok:true});
});

// DELETE
app.delete('/api/hotels/:id', async (req,res)=>{
  const id = req.params.id.toLowerCase();
  await supa.from('hotels').delete().or(`id.eq.${id},hotel_id.eq.${id}`);
  res.json({ok:true});
});
app.post('/api/hotels/:id/delete', async (req,res)=>{
  const id = req.params.id.toLowerCase();
  await supa.from('hotels').delete().or(`id.eq.${id},hotel_id.eq.${id}`);
  res.json({ok:true});
});

// GM ADD ITEM
app.post('/api/gm/add-item', async (req,res)=>{
  const {hotel_id, type, name, price} = req.body;
  await supa.from('hotel_items').insert({hotel_id: hotel_id.toLowerCase(), type, name, price});
  res.json({ok:true});
});

app.listen(process.env.PORT||10000, ()=>console.log('LIVE 8.5 - APPROVE FIXED'));
