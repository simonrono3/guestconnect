const express=require('express');
const cors=require('cors');
const path=require('path');
const {createClient}=require('@supabase/supabase-js');
const app=express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let supabase=null;
try{
 if(process.env.SUPABASE_URL){
  supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY);
 }
}catch(e){console.log('No supabase yet')}

function api(t){
 app.get(`/api/${t}`,async(req,res)=>{
  try{
   if(!supabase) return res.json([]);
   const{data}=await supabase.from(t).select('*');
   res.json((data||[]).map(x=>x.data));
  }catch(e){res.json([])}
 });
 app.post(`/api/${t}`,async(req,res)=>{
  try{
   if(!supabase) return res.json({ok:true,id:Date.now().toString()});
   const id=req.body.id||Date.now().toString();
   await supabase.from(t).upsert({id,data:req.body});
   res.json({ok:true,id});
  }catch(e){res.json({ok:true})}
 });
}
['hotels','vendors','services','bookings','requests','messages','notifications','users'].forEach(api);

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));

app.listen(process.env.PORT||10000,()=>console.log('GuestConnect Full App Live'));
