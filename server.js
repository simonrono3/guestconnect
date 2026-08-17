import { WebSocket } from 'ws';
global.WebSocket = WebSocket;


require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 1. GM: ADD ITEMS
app.post('/api/gm/add-item', async (req,res)=>{
  const {hotel_id, type, name, price, desc, img, dept_whatsapp} = req.body;
  await supa.from('hotel_items').insert({hotel_id, type, name, price, description:desc, image_url:img, dept_whatsapp});
  res.json({ok:true});
});

// 2. GUEST: ORDER FOOD
app.post('/api/guest/order', async (req,res)=>{
  const {hotel_id, room, guest, item_id, notes, phone} = req.body;
  const {data:item} = await supa.from('hotel_items').select('*').eq('id', item_id).single();
  const {data:order} = await supa.from('orders').insert({hotel_id, room, guest_name:guest, item_id, status:'New', notes, phone}).select().single();
  const message = `🚨 NEW ORDER - Room ${room}\n${item.name} - KES ${item.price}\nGuest: ${guest}\nNotes: ${notes||'None'}`;
  if(item.dept_whatsapp) await axios.post(`https://graph.facebook.com/v20.0/${item.dept_whatsapp}/messages`, {
    messaging_product: "whatsapp", to: item.dept_whatsapp, text: { body: message }
  }, { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` }}).catch(()=>{});
  res.json({ok:true, order_id: order.id});
});

// 3. GUEST: BOOK VENDOR - SERVICE/TOUR/TAXI
app.post('/api/guest/book-vendor', async (req,res)=>{
  const {hotel_id, vendor_id, service, price, room, guest} = req.body;
  const commission = price * 0.15;
  await supa.from('bookings').insert({
    hotel_id, vendor_id, service, amount:price, commission, our_cut:commission,
    hotel_earning:0, guest_name:guest, room, status:'Confirmed'
  });
  res.json({ok:true});
});

// 4. AI CONCIERGE - MULTI LANGUAGE
app.post('/api/guest/ai-chat', async (req,res)=>{
  const {message, hotel_id, room, lang='en'} = req.body;
  let reply = "Karibu! How can I help you today?";
  if(lang==='sw'){
    if(message.toLowerCase().includes('chakula')) reply = "Tuna Nyama Choma, Ugali, Pilau. Agiza kutoka kwenye tab ya Huduma ya Chumba.";
    else reply = "Karibu! Naweza kukusaidiaje leo?";
  }
  else if(lang==='fr'){
    if(message.toLowerCase().includes('nourriture')) reply = "Nous avons Nyama Choma, Ugali, Pilau.";
    else reply = "Bienvenue! Comment puis-je vous aider aujourd'hui?";
  }
  else {
    if(message.toLowerCase().includes('food')) reply = "We have Nyama Choma, Ugali, Pilau. Order from Room Service tab.";
    if(message.toLowerCase().includes('taxi')) reply = "I can book you a taxi. Visit Taxi tab.";
  }
  await supa.from('chat_logs').insert({hotel_id, room, message, reply, lang});
  res.json({reply});
});

// 5. M-PESA
app.post('/api/guest/pay', async (req,res)=>{
  const {phone, amount, order_id} = req.body;
  await supa.from('payments').insert({order_id, amount, phone, status:'Pending'});
  res.json({ok:true, message:`STK Push sent to ${phone}`});
});

// 6. REVIEWS
app.post('/api/guest/review', async (req,res)=>{
  const {item_id, guest, rating, comment} = req.body;
  await supa.from('reviews').insert({item_id, guest_name:guest, rating, comment});
  res.json({ok:true});
});

// 7. VENDOR: SIGNUP
app.post('/api/vendor/register', async (req,res)=>{
  const {name, owner, phone, email, type} = req.body;
  const hash = await bcrypt.hash('temp123', 10);
  await supa.from('vendors').insert({id:email, name, owner, phone, email, password:hash, type, status:'Pending'});
  res.json({ok:true});
});

// 8. HOTEL: SIGNUP
app.post('/api/hotel/register', async (req,res)=>{
  const {name, hotelId, email, password, plan} = req.body;
  const hash = await bcrypt.hash(password, 10);
  const price = plan==='Starter'?6500:plan==='Professional'?19500:0;
  await supa.from('hotels').insert({id:hotelId, name, email, password:hash, plan, price, status:'Pending'});
  res.json({ok:true});
});

// 9. HOTEL LOGIN
app.post('/api/hotel/login', async (req,res)=>{
  const {hotelId, password} = req.body;
  const {data:hotel} = await supa.from('hotels').select('*').eq('id', hotelId).single();
  if(!hotel) return res.json({ok:false, message:'Hotel not found'});
  const match = await bcrypt.compare(password, hotel.password);
  if(!match) return res.json({ok:false, message:'Wrong password'});
  res.json({ok:true, hotel});
});

// 10. GM DASHBOARD DATA
app.get('/api/gm/dashboard/:hotel_id', async (req,res)=>{
  const hotel_id = req.params.hotel_id;
  const [orders, bookings, items] = await Promise.all([
    supa.from('orders').select('*, hotel_items(*)').eq('hotel_id', hotel_id),
    supa.from('bookings').select('*').eq('hotel_id', hotel_id),
    supa.from('hotel_items').select('*').eq('hotel_id', hotel_id)
  ]);
  const foodRevenue = orders.data.filter(o=>o.hotel_items?.type!=='tour' && o.hotel_items?.type!=='taxi').reduce((a,b)=>a+Number(b.hotel_items?.price||0),0);
  const vendorRevenue = bookings.data.reduce((a,b)=>a+Number(b.our_cut||0),0);
  res.json({orders:orders.data, bookings:bookings.data, items:items.data, foodRevenue, vendorRevenue});
});

// 11. ADMIN STATS
app.get('/api/admin/stats', async (req,res)=>{
  const [hotels, bookings] = await Promise.all([supa.from('hotels').select('*'), supa.from('bookings').select('*')]);
  const mrr = hotels.data.filter(h=>h.status==='Approved').reduce((a,b)=>a+Number(b.price||15000),0);
  const commission = bookings.data.reduce((a,b)=>a+Number(b.our_cut||0),0);
  res.json({mrr, commission, total:mrr+commission, hotels:hotels.data.length});
});

// 12. GET ALL DATA FOR HOMEPAGE + GUEST
app.get('/api/data', async (req,res)=>{
  const [hotels,vendors,items,reviews] = await Promise.all([
    supa.from('hotels').select('*'), supa.from('vendors').select('*'),
    supa.from('hotel_items').select('*'), supa.from('reviews').select('*')
  ]);
  res.json({hotels:hotels.data,vendors:vendors.data,items:items.data,reviews:reviews.data});
});

// 13. ADMIN APPROVE
app.post('/api/admin/approve/:type/:id', async (req,res)=>{
  await supa.from(req.params.type).update({status:'Approved'}).eq('id', req.params.id);
  res.json({ok:true});
});

app.listen(process.env.PORT||3000, ()=>console.log('GUESTHUB V8.5 LIVE ON PORT', process.env.PORT||3000));
