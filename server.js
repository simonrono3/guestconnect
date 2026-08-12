const http = require('http'); const fs = require('fs'); const url = require('url'); const querystring = require('querystring');
const { MongoClient } = require('mongodb');
const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.DATABASE_URL || "mongodb+srv://guesthub:Simon2024%21@cluster0.mongodb.net/guesthub?retryWrites=true&w=majority";
let db, hotelsCol, vendorsCol, servicesCol, requestsCol, bookingsCol, activitiesCol;
async function initDB(){
  const client = new MongoClient(MONGO_URL); await client.connect();
  db = client.db('guesthub');
  hotelsCol = db.collection('hotels'); vendorsCol = db.collection('vendors'); servicesCol = db.collection('services');
  requestsCol = db.collection('requests'); bookingsCol = db.collection('bookings'); activitiesCol = db.collection('activities');
  if(await hotelsCol.countDocuments()===0){
    await hotelsCol.insertOne({id:'savannah', name:'Savannah Hotel', hotelId:'savannah', address:'Nandi Hills, Rift Valley', phone:'0700000000', email:'savannah@test.com', password:'1234', status:'Approved', logo:'https://i.imgur.com/8Km9tLL.png', description:'4-Star luxury', amenities:['Pool','Wifi'], commission:0.1, rating:4.8});
    await vendorsCol.insertMany([{id:'taxi@test.com', name:'Nandi Fast Taxi', owner:'Driver John', phone:'0712345678', email:'taxi@test.com', password:'1234', type:'Taxi', status:'Approved', logo:'https://i.imgur.com/3Z6i6jv.png', description:'24/7 Taxi', rating:4.9},{id:'safari@test.com', name:'Safari Adventures', owner:'Mike', phone:'0711111', email:'safari@test.com', password:'1234', type:'Tours', status:'Approved', logo:'https://i.imgur.com/3Z6i6jv.png', description:'10 years', rating:4.7}]);
    await servicesCol.insertMany([{id:1, hotelId:'savannah', vendorId:'safari@test.com', name:'Maasai Mara Day Tour', price:15000, img:'https://picsum.photos/300/150?safari', status:'Approved', category:'Tours', desc:'See Big 5'},{id:2, hotelId:'savannah', vendorId:'savannah', name:'Spa Treatment', price:4000, img:'https://picsum.photos/300/150?spa', status:'Approved', category:'Wellness', desc:'Massage'},{id:3, hotelId:'savannah', vendorId:'taxi@test.com', name:'Airport Transfer', price:2500, img:'https://picsum.photos/300/150?taxi', status:'Approved', category:'Taxi', desc:'To Eldoret', phone:'0712345678', eta:'15 mins'}]);
  }
  console.log('MongoDB Connected');
}
function sendJSON(res, data){ res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(data)); }
function serveFile(res, file){ fs.readFile(file, (err,data)=>{ if(err){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end('Not Found')}else{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(data)}}); }
const server = http.createServer(async (req,res)=>{
  const parsedUrl = url.parse(req.url,true); const path = parsedUrl.pathname;
  if(req.method==='POST'){
    let body=''; req.on('data',chunk=>body+=chunk); req.on('end',async()=>{
      const data = querystring.parse(body);
      if(path==='/api/hotel/register'){ await hotelsCol.insertOne({...data, id:data.hotelId, status:'Pending', commission:0.1, rating:0}); await activitiesCol.insertOne({time:new Date().toLocaleString(), entity:'Hotel', entityId:data.hotelId, action:'New Application'}); sendJSON(res,{ok:true}); }
      if(path==='/api/vendor/register'){ await vendorsCol.insertOne({...data, id:data.email, status:'Pending', rating:0}); await activitiesCol.insertOne({time:new Date().toLocaleString(), entity:'Vendor', entityId:data.email, action:'New Application'}); sendJSON(res,{ok:true}); }
      if(path==='/api/request'){ await requestsCol.insertOne({...data, id:Date.now(), status:'Pending', time:new Date()}); await activitiesCol.insertOne({time:new Date().toLocaleString(), entity:'Guest', entityId:data.hotelId, action:`Request: ${data.service}`}); sendJSON(res,{ok:true}); }
      if(path==='/api/book'){ const hotel = await hotelsCol.findOne({id:data.hotelId}); const commission = parseFloat(data.price) * (hotel?hotel.commission:0.1); const ourCut = commission/2; const hotelEarning = commission/2; await bookingsCol.insertOne({...data, id:Date.now(), commission, ourCut, hotelEarning, status:'Confirmed', time:new Date()}); await activitiesCol.insertOne({time:new Date().toLocaleString(), entity:'Guest', entityId:data.hotelId, action:`Booked: ${data.serviceName}`}); sendJSON(res,{ok:true}); }
      if(path==='/api/hotel/add-service'){ await servicesCol.insertOne({...data, id:Date.now(), status:'Approved'}); sendJSON(res,{ok:true}); }
      if(path==='/api/admin/approve-hotel'){ await hotelsCol.updateOne({id:data.id}, {$set:{status:'Approved'}}); sendJSON(res,{ok:true}); }
      if(path==='/api/admin/approve-vendor'){ await vendorsCol.updateOne({id:data.id}, {$set:{status:'Approved'}}); sendJSON(res,{ok:true}); }
    });
  } else {
    if(path==='/'||path==='/guest.html'||path==='/index.html') serveFile(res,'guest.html');
    if(path==='/hotel-signup.html') serveFile(res,'hotel-signup.html');
    if(path==='/hotel-dashboard.html') serveFile(res,'hotel-dashboard.html');
    if(path==='/vendor-signup.html') serveFile(res,'vendor-signup.html');
    if(path==='/vendor-dashboard.html') serveFile(res,'vendor-dashboard.html');
    if(path==='/admin.html') serveFile(res,'admin.html');
    if(path==='/api/data'){ const hotels = await hotelsCol.find().toArray(); const vendors = await vendorsCol.find().toArray(); const services = await servicesCol.find().toArray(); const requests = await requestsCol.find().toArray(); const bookings = await bookingsCol.find().toArray(); const activities = await activitiesCol.find().sort({_id:-1}).limit(50).toArray(); sendJSON(res,{hotels,vendors,services,requests,bookings,activities}); }
  }
});
initDB().then(()=>{ server.listen(PORT,()=>console.log(`GUESTHUB v4.2 on ${PORT}`)); });
