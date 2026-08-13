const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req,res)=>res.send('GuestConnect Kenya LIVE! 🇰🇪 Narok 2026'));

app.get('/api/hotels', (req,res)=>res.json([]));
app.post('/api/hotels', (req,res)=>res.json({ok:true}));

app.get('/api/:table', (req,res)=>res.json([]));
app.post('/api/:table', (req,res)=>res.json({ok:true, id: Date.now().toString()}));

app.listen(process.env.PORT||10000, ()=>console.log('Live on', process.env.PORT||10000));
