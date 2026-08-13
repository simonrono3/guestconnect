const express=require('express');
const cors=require('cors');
const {createClient}=require('@supabase/supabase-js');
const app=express();
app.use(cors());
app.use(express.json());
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY);
function api(t){
 app.get(`/api/${t}`,async(r,s)=>{
  try{const{data}=await supabase.from(t).select('*');s.json((data||[]).map(x=>x.data))}catch(e){s.json([])}
 });
 app.post(`/api/${t}`,async(r,s)=>{
  try{const id=r.body.id||Date.now().toString();await supabase.from(t).upsert({id,data:r.body});s.json({ok:true,id})}catch(e){s.json({ok:true})}
 });
}
['hotels','vendors','services','bookings','requests','messages','notifications','users'].forEach(api);
app.get('/',(r,s)=>s.send('GuestConnect Kenya LIVE! 🇰🇪 Narok 2026 - Full System'));
app.listen(process.env.PORT||10000,()=>console.log('Full Live'));
