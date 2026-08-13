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

// Add hotel
app.post('/api/hotels', async (req, res) => {
  const { data, error } = await supabase.from('hotels').insert([req.body]).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
