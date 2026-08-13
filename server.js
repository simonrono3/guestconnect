const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function api(table){
  app.get(`/api/${table}`, async (req,res)=>{
    const {data} = await supabase.from(table).select('*');
    res.json((data||[]).map(r=>r.data));
  });
  app.post(`/api/${table}`, async (req,res)=>{
    const id = req.body.id || Date.now().toString();
    await supabase.from(table).upsert({id, data:req.body});
    res.json({ok:true,id});
  });
}
['hotels','vendors','services','bookings','requests','messages','notifications','users'].forEach(api);

app.get('/', (req,res)=>res.send('GuestConnect Kenya LIVE! 🇰🇪'));
app.listen(process.env.PORT||10000, ()=>console.log('Live'));
