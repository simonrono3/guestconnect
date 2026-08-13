require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
console.log('GUESTSHUB™ OS v1.0 RUNNING...');

// ===== PAGES =====
app.get('/', (req,res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/guest', (req,res) => res.sendFile(path.join(__dirname, 'public/guest.html')));
app.get('/vendor-register', (req,res) => res.sendFile(path.join(__dirname, 'public/vendor-register.html')));
app.get('/vendor-dashboard', (req,res) => res.sendFile(path.join(__dirname, 'public/vendor-dashboard.html')));
app.get('/gsh-dashboard', (req,res) => res.sendFile(path.join(__dirname, 'public/gsh-dashboard.html')));
app.get('/admin', (req,res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

// ===== VENDOR OS =====
app.post('/api/gsh/vendor/register', async (req,res) => {
  const {data, error} = await supabase.from('vendors').insert([{...req.body, status:'pending'}]).select();
  if(error) return res.status(400).json({error: error.message});
  res.json({success:true, message:"Application received. Approval in 24Hrs"});
});
app.post('/api/gsh/vendor/listing', async (req,res) => {
  const {data, error} = await supabase.from('vendor_listings').insert([req.body]).select();
  if(error) return res.status(400).json({error: error.message});
  res.json({success:true, data});
});
app.get('/api/gsh/vendor/bookings/:vendor_id', async (req,res) => {
  const {data} = await supabase.from('bookings').select('*, vendor_listings(name)').eq('vendor_id', req.params.vendor_id).order('created_at', {ascending:false});
  res.json(data||[]);
});

// ===== HOTEL & MARKETPLACE OS =====
app.post('/api/gsh/hotel/register', async (req,res) => {
  const {data} = await supabase.from('hotels').insert([req.body]).select();
  res.json({success:true, hotel_id: data[0].id});
});
app.get('/api/gsh/hotels', async (req,res) => {
  const {data} = await supabase.from('hotels').select('*').order('created_at', {ascending:false});
  res.json(data||[]);
});
app.get('/api/gsh/listings', async (req,res) => {
  const {data} = await supabase.from('vendor_listings').select('*, vendors(company_name, phone), hotels(name)').eq('is_available', true);
  res.json(data||[]);
});
app.get('/api/gsh/listings/:hotel_id/:department', async (req,res) => {
  const {data} = await supabase.from('vendor_listings').select('*, vendors(company_name)').eq('hotel_id', req.params.hotel_id).eq('department', req.params.department).eq('is_available', true);
  res.json(data||[]);
});

// ===== GUEST ORDERS & BOOKINGS (Your 2nd code integrated) =====
app.post('/api/request', async (req,res) => {
  const {room, hotel, service, guest_phone} = req.body;
  const {data} = await supabase.from('orders').insert([{room_number: room, guest_phone: guest_phone||'254700000000', department: service, item_name: service, status:'pending', hotel_id: 1}]).select();
  res.json({success:true, data});
});
app.post('/api/gsh/booking/create', async (req,res) => {
  const {data} = await supabase.from('bookings').insert([req.body]).select();
  res.json({success:true, message:"Booking Confirmed"});
});
app.post('/api/gsh/order/create', async (req,res) => {
  const {data} = await supabase.from('orders').insert([req.body]).select();
  res.json({success:true, data});
});
app.get('/api/requests', async (req,res) => {
  const {data} = await supabase.from('orders').select('*').order('created_at', {ascending:false}).limit(100);
  res.json(data||[]);
});
app.get('/api/gsh/bookings', async (req,res) => {
  const {data} = await supabase.from('bookings').select('*, vendor_listings(name), hotels(name)').order('created_at', {ascending:false}).limit(100);
  res.json(data||[]);
});
app.get('/api/gsh/orders', async (req,res) => {
  const {data} = await supabase.from('orders').select('*').order('created_at', {ascending:false});
  res.json(data||[]);
});

// ===== ADMIN OS =====
function checkAdmin(req,res,next){
  if((req.headers['x-admin-key']||req.query.key)!== process.env.ADMIN_KEY) return res.status(403).json({error:"Unauthorized"});
  next();
}
app.get('/api/admin/stats', checkAdmin, async (req,res) => {
  const {count: hotels} = await supabase.from('hotels').select('*', {count:'exact', head:true});
  const {count: pending} = await supabase.from('vendors').select('*', {count:'exact', head:true}).eq('status','pending');
  const {count: bookings} = await supabase.from('bookings').select('*', {count:'exact', head:true});
  const {count: orders} = await supabase.from('orders').select('*', {count:'exact', head:true});
  res.json({hotels, pending_vendors: pending, bookings, orders});
});
app.get('/api/admin/vendors/pending', checkAdmin, async (req,res) => {
  const {data} = await supabase.from('vendors').select('*').eq('status','pending').order('created_at', {ascending:false});
  res.json(data||[]);
});
app.post('/api/admin/vendor/approve/:id', checkAdmin, async (req,res) => {
  await supabase.from('vendors').update({status:'approved'}).eq('id', req.params.id);
  res.json({success:true});
});

// ===== WHATSAPP OS - CORE =====
app.get('/webhook/whatsapp', (req,res) => {
  if(req.query['hub.verify_token'] === "GUESTSHUB123") res.send(req.query['hub.challenge']);
  else res.send('GUESTSHUB OS Webhook Active');
});
app.post('/webhook/whatsapp', async (req,res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if(!msg) return res.sendStatus(200);
  const from = msg.from; const body = msg.text?.body?.trim() || '';
  if(body.startsWith('GSH_ROOM')) {
    await sendWhatsApp(from, `Welcome to GUESTSHUB™ 👋\n${body}\n\n1. FOOD & BAR\n2. LAUNDRY\n3. TAXI\n4. SPA\n5. MAINTENANCE\n6. BILL\n7. TOURS & SAFARIS\n8. CONCIERGE`);
    return res.sendStatus(200);
  }
  if(body === '7'){
    const {data} = await supabase.from('vendor_listings').select('*, vendors(company_name)').eq('department','TOURS').eq('is_available', true).limit(5);
    let reply="🌍 TOURS & SAFARIS:\n\n"; data?.forEach((l,i)=> reply+=`${i+1}. ${l.name} - KES ${l.price} by ${l.vendors?.company_name}\n`);
    reply+="\nReply BOOK 1"; await sendWhatsApp(from, reply); return res.sendStatus(200);
  }
  if(body.startsWith('BOOK')){
    await supabase.from('bookings').insert([{guest_phone:from, status:'pending', hotel_id:1, booking_date: new Date().toISOString().split('T')[0]}]);
    await sendWhatsApp(from, "✅ Booking Confirmed! Vendor will WhatsApp you shortly.");
    return res.sendStatus(200);
  }
  res.sendStatus(200);
});
async function sendWhatsApp(to, text){
  if(!process.env.WHATSAPP_TOKEN) return;
  try{ await axios.post(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`,{messaging_product:"whatsapp", to, text:{body:text}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}}); }catch(e){}
}
const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log(`GUESTSHUB OS LIVE on ${PORT}`));
