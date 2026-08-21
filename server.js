import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
// SECURE: Only serve public folder
app.use(express.static(path.join(__dirname, 'public')));

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// HTML ROUTES
app.get('/', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/signup.html', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/login.html', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin.html', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/vendor-dashboard.html', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'vendor-dashboard.html')));

// 1. HOTEL SIGNUP - NEW SECURE ONE (for your new signup.html)
app.post('/api/hotels/signup', async (req,res)=>{
  try{
    const { hotel_name, location, hotel_type, email, phone, password, hotel_id, name } = req.body;
    const finalName = hotel_name || name;
    if(!finalName || !email || !password) return res.status(400).json({error: 'Missing fields'});
    
    const final_hotel_id = (hotel_id || finalName).toLowerCase().replace(/[^a-z0-9]/g,'');
    const hash = await bcrypt.hash(password, 10);
    
    const { data, error } = await supa.from('hotels').insert([{
      hotel_id: final_hotel_id,
      id: final_hotel_id,
      name: finalName,
      hotel_name: finalName,
      location, hotel_type, email, phone,
      password: hash,
      password_hash: hash,
      status: 'PENDING',
      plan: 'Upendo',
      price: 6500
    }]).select().single();
    
    if(error) throw error;
    res.json({ok:true, message: 'Application sent!'});
  }catch(e){
    console.error(e);
    if(e.code === '23505') return res.status(400).json({error: 'Hotel ID or Email already exists'});
    res.status(500).json({error: e.message});
  }
});

// 2. HOTEL SIGNUP - OLD ONE (keep for compatibility)
app.post('/api/hotel/register', async (req,res)=>{
  try{
    const {name, hotelId, email, password, plan, location, hotel_type, phone} = req.body;
    const hash = await bcrypt.hash(password, 10);
    const finalId = (hotelId || name).toLowerCase().replace(/[^a-z0-9]/g,'');
    const {error} = await supa.from('hotels').insert({
      id: finalId, hotel_id: finalId, name, hotel_name: name, email, 
      password: hash, password_hash: hash, plan, price: 6500,
      location, hotel_type, phone, status: 'Pending'
    });
    if(error) throw error;
    res.json({ok:true});
  }catch(e){ res.status(500).json({error: e.message}); }
});

// 3. HOTEL LOGIN - FIXED
app.post('/api/hotel/login', async (req,res)=>{
  try{
    const {hotelId, password, hotel_id} = req.body;
    const idToFind = (hotelId || hotel_id || '').toLowerCase();
    const {data:hotel, error} = await supa.from('hotels').select('*').or(`hotel_id.eq.${idToFind},id.eq.${idToFind}`).single();
    if(error || !hotel) return res.status(404).json({ok:false, message:'Hotel not found'});
    const match = await bcrypt.compare(password, hotel.password_hash || hotel.password);
    if(!match) return res.status(401).json({ok:false, message:'Wrong password'});
    if(hotel.status !== 'Approved' && hotel.status !== 'APPROVED') return res.status(403).json({ok:false, message:'Hotel not approved yet. Status: ' + hotel.status});
    res.json({ok:true, hotel});
  }catch(e){ res.status(500).json({ok:false, message:e.message}); }
});

// 4. GM: ADD ITEMS
app.post('/api/gm/add-item', async (req,res)=>{
  try{
    const {hotel_id, type, name, price, desc, img, dept_whatsapp} = req.body;
    const cleanHotelId = hotel_id.toLowerCase();
    const {error} = await supa.from('hotel_items').insert({
      hotel_id: cleanHotelId, type, name, price, description:desc, image_url:img, dept_whatsapp
    });
    if(error) throw error;
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// 5. GUEST: ORDER FOOD
app.post('/api/guest/order', async (req,res)=>{
  try{
    const {hotel_id, room, guest, item_id, notes, phone} = req.body;
    const {data:item} = await supa.from('hotel_items').select('*').eq('id', item_id).single();
    const {data:order} = await supa.from('orders').insert({
      hotel_id: hotel_id.toLowerCase(), room, guest_name:guest, item_id, status:'New', notes, phone
    }).select().single();
    res.json({ok:true, order_id: order.id});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// 6. GUEST: BOOK VENDOR
app.post('/api/guest/book-vendor', async (req,res)=>{
  try{
    const {hotel_id, vendor_id, service, price, room, guest} = req.body;
    const commission = price * 0.15;
    await supa.from('bookings').insert({
      hotel_id: hotel_id.toLowerCase(), vendor_id, service, amount:price, 
      commission, our_cut:commission, hotel_earning:0, guest_name:guest, room, status:'Confirmed'
    });
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// 7. AI CONCIERGE
app.post('/api/guest/ai-chat', async (req,res)=>{
  try{
    const {message, hotel_id, room, lang='en'} = req.body;
    let reply = "Karibu! How can I help you today?";
    const msg = message.toLowerCase();
    if(lang==='sw'){
      if(msg.includes('chakula')) reply = "Tuna Nyama Choma, Ugali, Pilau. Agiza kutoka kwenye tab ya Huduma ya Chumba.";
      else reply = "Karibu! Naweza kukusaidiaje leo?";
    } else {
      if(msg.includes('food')) reply = "We have Nyama Choma, Ugali, Pilau. Order from Room Service tab.";
      if(msg.includes('taxi')) reply = "I can book you a taxi. Visit Taxi tab.";
    }
    await supa.from('chat_logs').insert({hotel_id: hotel_id.toLowerCase(), room, message, reply, lang});
    res.json({reply});
  }catch(e){ res.json({reply: "Sorry, I am offline"}); }
});

// 8. M-PESA, REVIEWS, VENDOR
app.post('/api/guest/pay', async (req,res)=>{
  const {phone, amount, order_id} = req.body;
  await supa.from('payments').insert({order_id, amount, phone, status:'Pending'});
  res.json({ok:true, message:`STK Push sent to ${phone}`});
});
app.post('/api/guest/review', async (req,res)=>{
  const {item_id, guest, rating, comment} = req.body;
  await supa.from('reviews').insert({item_id, guest_name:guest, rating, comment});
  res.json({ok:true});
});
app.post('/api/vendor/register', async (req,res)=>{
  try{
    const {name, owner, phone, email, type} = req.body;
    const hash = await bcrypt.hash('temp123', 10);
    await supa.from('vendors').insert({id: email.toLowerCase(), name, owner, phone, email: email.toLowerCase(), password:hash, type, status:'Pending'});
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// 9. GM DASHBOARD - THE FIX FOR MGENI/PRIDEINN BUG
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

// 10. ADMIN
app.get('/api/admin/stats', async (req,res)=>{
  const [hotels, bookings] = await Promise.all([supa.from('hotels').select('*'), supa.from('bookings').select('*')]);
  const mrr = hotels.data.filter(h=>h.status==='Approved' || h.status==='APPROVED').reduce((a,b)=>a+Number(b.price||6500),0);
  const commission = bookings.data.reduce((a,b)=>a+Number(b.our_cut||0),0);
  res.json({mrr, commission, total:mrr+commission, hotels:hotels.data.length, hotelsData:hotels.data});
});
app.post('/api/admin/approve/:type/:id', async (req,res)=>{
  await supa.from(req.params.type).update({status:'Approved'}).eq('id', req.params.id);
  res.json({ok:true});
});

app.listen(process.env.PORT||10000, ()=>console.log('GUESTHUB V8.5 LIVE ON PORT', process.env.PORT||10000));
