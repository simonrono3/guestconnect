/*const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve all html files from main folder
app.use(express.static(__dirname));

// Supabase connect
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("WARNING: Supabase keys missing!");
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ===== PAGE ROUTES =====

app.get('/api/vendors/pending', async (req,res)=>{
  const {data}=await supabase.from('vendors').select('*').eq('status','pending');
  res.json(data||[]);
});
app.post('/api/vendors/approve/:id', async (req,res)=>{
  await supabase.from('vendors').update({status:'approved'}).eq('id',req.params.id);
  res.json({ok:true});
});
app.get('/api/hotels', async (req,res)=>{
  const {data}=await supabase.from('hotels').select('*');
  res.json(data||[]);
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/guest', (req, res) => res.sendFile(path.join(__dirname, 'guest.html')));
app.get('/gsh-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'gsh-dashboard.html')));
app.get('/vendor-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'vendor-dashboard.html')));
app.get('/hotel-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'hotel-dashboard.html')));
app.get('/hotel-signup', (req, res) => res.sendFile(path.join(__dirname, 'hotel-signup.html')));
app.get('/vendor-register', (req, res) => res.sendFile(path.join(__dirname, 'vendor-register.html')));
app.get('/precheckin', (req, res) => res.sendFile(path.join(__dirname, 'precheckin.html')));

// ===== API ROUTES =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Get all guests
app.get('/api/guests', async (req, res) => {
  const { data, error } = await supabase.from('guests').select('*').order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Add guest
app.post('/api/guests', async (req, res) => {
  const { data, error } = await supabase.from('guests').insert([req.body]).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Get vendors
app.get('/api/vendors', async (req, res) => {
  const { data, error } = await supabase.from('vendors').select('*');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Add vendor
app.post('/api/vendors', async (req, res) => {
  const { data, error } = await supabase.from('vendors').insert([req.body]).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Get hotels
app.get('/api/hotels', async (req, res) => {
  const { data, error } = await supabase.from('hotels').select('*');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ===== MY HOTEL ONLY - REPORT API =====
app.get('/api/report/:hotel_id', async (req, res) => {
  const { hotel_id, from, to } = req.params;
  const hotelId = req.params.hotel_id;
  
  let q1 = supabase.from('bookings').select('*').eq('hotel_id', hotelId);
  let q2 = supabase.from('guests').select('*').eq('hotel_id', hotelId);
  let q3 = supabase.from('requests').select('*').eq('hotel_id', hotelId);

  const { data: bookings } = await q1;
  const { data: guests } = await q2;
  const { data: requests } = await q3;

  const revenue = bookings?.reduce((s,b)=> s + (b.amount||0),0) || 0;

  res.json({
    hotel_id: hotelId,
    total_bookings: bookings?.length || 0,
    total_guests: guests?.length || 0,
    total_requests: requests?.length || 0,
    total_revenue: revenue,
    bookings: bookings || []
  });
});

// ===== When guest books, SAVE hotel_id =====
app.post('/api/bookings', async (req, res) => {
  const { guest_name, service, hotel_id, amount } = req.body;
  const { data, error } = await supabase.from('bookings').insert([{ guest_name, service, hotel_id, amount }]).select();
  if(error) return res.status(400).json(error);
  res.json(data);
});


// Add hotel
app.post('/api/hotels', async (req, res) => {
  const { data, error } = await supabase.from('hotels').insert([req.body]).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});*/

const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve all html files from main folder
app.use(express.static(__dirname));

// Supabase connect
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("WARNING: Supabase keys missing!");
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ===== PAGE ROUTES =====

app.get('/api/vendors/pending', async (req,res)=>{
  const {data}=await supabase.from('vendors').select('*').eq('status','pending');
  res.json(data||[]);
});
app.post('/api/vendors/approve/:id', async (req,res)=>{
  await supabase.from('vendors').update({status:'approved'}).eq('id',req.params.id);
  res.json({ok:true});
});
app.get('/api/hotels', async (req,res)=>{
  const {data}=await supabase.from('hotels').select('*');
  res.json(data||[]);
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/guest', (req, res) => res.sendFile(path.join(__dirname, 'guest.html')));
app.get('/gsh-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'gsh-dashboard.html')));
app.get('/vendor-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'vendor-dashboard.html')));
app.get('/hotel-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'hotel-dashboard.html')));
app.get('/hotel-signup', (req, res) => res.sendFile(path.join(__dirname, 'hotel-signup.html')));
app.get('/vendor-register', (req, res) => res.sendFile(path.join(__dirname, 'vendor-register.html')));
app.get('/precheckin', (req, res) => res.sendFile(path.join(__dirname, 'precheckin.html')));

// ===== API ROUTES =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Get all guests
app.get('/api/guests', async (req, res) => {
  const { data, error } = await supabase.from('guests').select('*').order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Add guest
app.post('/api/guests', async (req, res) => {
  const { data, error } = await supabase.from('guests').insert([req.body]).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Get vendors
app.get('/api/vendors', async (req, res) => {
  const { data, error } = await supabase.from('vendors').select('*');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Add vendor
app.post('/api/vendors', async (req, res) => {
  const { data, error } = await supabase.from('vendors').insert([req.body]).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Get hotels
app.get('/api/hotels', async (req, res) => {
  const { data, error } = await supabase.from('hotels').select('*');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ===== MY HOTEL ONLY - REPORT API =====
app.get('/api/report/:hotel_id', async (req, res) => {
  const { hotel_id, from, to } = req.params;
  const hotelId = req.params.hotel_id;
  
  let q1 = supabase.from('bookings').select('*').eq('hotel_id', hotelId);
  let q2 = supabase.from('guests').select('*').eq('hotel_id', hotelId);
  let q3 = supabase.from('requests').select('*').eq('hotel_id', hotelId);

  const { data: bookings } = await q1;
  const { data: guests } = await q2;
  const { data: requests } = await q3;

  const revenue = bookings?.reduce((s,b)=> s + (b.amount||0),0) || 0;

  res.json({
    hotel_id: hotelId,
    total_bookings: bookings?.length || 0,
    total_guests: guests?.length || 0,
    total_requests: requests?.length || 0,
    total_revenue: revenue,
    bookings: bookings || []
  });
});

// ===== When guest books, SAVE hotel_id =====
app.post('/api/bookings', async (req, res) => {
  const { guest_name, service, hotel_id, amount } = req.body;
  const { data, error } = await supabase.from('bookings').insert([{ guest_name, service, hotel_id, amount }]).select();
  if(error) return res.status(400).json(error);
  res.json(data);
});


// Add hotel
app.post('/api/hotels', async (req, res) => {
  const { data, error } = await supabase.from('hotels').insert([req.body]).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
