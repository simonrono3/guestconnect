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

// GM: ADD ITEMS
app.post('/api/gm/add-item', async (req,res)=>{
  const {hotel_id, type, name, price, desc, img, dept_whatsapp} = req.body;
  await supa.from('hotel_items').insert({hotel_id, type, name, price, description:desc, image_url:img, dept_whatsapp});
  res.json({ok:true});
});

// GUEST: ORDER FOOD/SERVICE - 0% COMMISSION
app.post('/api/guest/order', async (req,res)=>{
  const {hotel_id, room, guest, item_id, notes} = req.body;
  const {data:item} = await supa.from('hotel_items').select('*').eq('id', item_id).single();
  await supa.from('orders').insert({hotel_id, room, guest_name:guest, item_id, status:'New', notes});
  
  const message = `🚨 NEW ORDER - Room ${room}\n${item.name} - KES ${item.price}\nGuest: ${guest}\nNotes: ${notes||'None'}`;
  if(item.dept_whatsapp) await axios.post(`https://graph.facebook.com/v20.0/${item.dept_whatsapp}/messages`, {
    messaging_product: "whatsapp", to: item.dept_whatsapp, text: { body: message }
  }, { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` }});
  
  res.json({ok:true});
});

// GUEST: BOOK VENDOR - 15% COMMISSION
app.post('/api/guest/book-vendor', async (req,res)=>{
  const {hotel_id, vendor_id, service, price, room, guest} = req.body;
  const commission = price * 0.15;
  await supa.from('bookings').insert({
    hotel_id, vendor_id, service, amount:price, commission, our_cut:commission, 
    hotel_earning:0, guest_name:guest, room, status:'Confirmed'
  });
  res.json({ok:true});
});

// VENDOR: FREE SIGNUP
app.post('/api/vendor/register', async (req,res)=>{
  const {name, owner, phone, email, type} = req.body;
  const hash = await bcrypt.hash('temp123', 10);
  await supa.from('vendors').insert({id:email, name, owner, phone, email, password:hash, type, status:'Pending'});
  res.json({ok:true});
});

// HOTEL: SIGNUP
app.post('/api/hotel/register', async (req,res)=>{
  const {name, hotelId, email, password} = req.body;
  const hash = await bcrypt.hash(password, 10);
  await supa.from('hotels').insert({id:hotelId, name, email, password:hash, status:'Pending'});
  res.json({ok:true});
});

// GM DASHBOARD
app.get('/api/gm/dashboard/:hotel_id', async (req,res)=>{
  const hotel_id = req.params.hotel_id;
  const [orders, bookings] = await Promise.all([
    supa.from('orders').select('*, hotel_items(*)').eq('hotel_id', hotel_id),
    supa.from('bookings').select('*').eq('hotel_id', hotel_id)
  ]);
  const foodRevenue = orders.data.reduce((a,b)=>a+Number(b.hotel_items?.price||0),0);
  const vendorRevenue = bookings.data.reduce((a,b)=>a+Number(b.our_cut||0),0);
  res.json({orders:orders.data, bookings:bookings.data, foodRevenue, vendorRevenue});
});

// ADMIN STATS
app.get('/api/admin/stats', async (req,res)=>{
  const [hotels, bookings] = await Promise.all([supa.from('hotels').select('*'), supa.from('bookings').select('*')]);
  const mrr = hotels.data.filter(h=>h.status==='Approved').length * 15000;
  const commission = bookings.data.reduce((a,b)=>a+Number(b.our_cut||0),0);
  res.json({mrr, commission, total:mrr+commission});
});

// GET ALL DATA
app.get('/api/data', async (req,res)=>{
  const [hotels,vendors,items] = await Promise.all([
    supa.from('hotels').select('*'), supa.from('vendors').select('*'), supa.from('hotel_items').select('*')
  ]);
  res.json({hotels:hotels.data,vendors:vendors.data,items:items.data});
});

// ADMIN APPROVE
app.post('/api/admin/approve/:type/:id', async (req,res)=>{
  await supa.from(req.params.type).update({status:'Approved'}).eq('id', req.params.id);
  res.json({ok:true});
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(process.env.PORT||3000, ()=>console.log('GUESTSHUB V7.0 LIVE'));
