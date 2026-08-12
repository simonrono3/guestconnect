const http = require('http'); const fs = require('fs'); const url = require('url'); const querystring = require('querystring');
const PORT = process.env.PORT || 3000;
let hotels = [{id:'leopardbeach', name:'Leopard Beach Resort', hotelId:'leopardbeach', address:'Diani Beach Rd, Ukunda', phone:'0700111000', email:'leopard@test.com', password:'1234', status:'Approved', logo:'https://i.imgur.com/8Km9tLL.png', cover:'https://images.unsplash.com/photo-1507525428034-b723cf961d3e', description:'5-Star All Inclusive on Diani Beach', commission:0.1, rating:4.9, subscription:'Professional'}];
let vendors = [{id:'diani@taxi.com', name:'Diani Beach Cabs', type:'Taxi', phone:'0711111', email:'diani@taxi.com', password:'1234', status:'Approved', rating:4.9, description:'24/7 Airport & Nightlife transfers'},{id:'dolphin@tours.com', name:'Diani Dolphin & Dhow', type:'Tours', phone:'0722222222', email:'dolphin@tours.com', password:'1234', status:'Approved', rating:4.9, description:'Dolphin, Snorkeling, Lunch'},{id:'serenity@spa.com', name:'Serenity Spa', type:'Spa', phone:'0733333', email:'serenity@spa.com', password:'1234', status:'Approved', rating:5.0, description:'Beachside Massage'}];
let services = [{id:1, hotelId:'leopardbeach', vendorId:'dolphin@tours.com', name:'Dolphin Tour + Dhow Cruise', price:6500, category:'Tours', desc:'4hrs. Pick up 8AM. Lunch included', img:'https://images.unsplash.com/photo-1544551763-46a013bb70d5', status:'Approved'},{id:2, hotelId:'leopardbeach', vendorId:'diani@taxi.com', name:'Airport Transfer to UKIA', price:2000, category:'Taxi', desc:'Ukunda Airport - 15min', phone:'0711111111', eta:'10 mins', img:'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d', status:'Approved'},{id:3, hotelId:'leopardbeach', vendorId:'serenity@spa.com', name:'Beach Massage 60min', price:5000, category:'Wellness', desc:'Massage with ocean sound', img:'https://images.unsplash.com/photo-1544161515-4ab6ce6db874', status:'Approved'}];
let requests = []; let bookings = []; let activities = []; let precheckins = [];
function logActivity(entity, entityId, action){ activities.unshift({time:new Date().toLocaleString(), entity, entityId, action}); }
function sendJSON(res, data){ res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(data)); }
function serveFile(res, file){ fs.readFile(file, (err,data)=>{ if(err){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end('Not Found: '+file)}else{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(data)}}); }
const server = http.createServer((req,res)=>{
  const parsedUrl = url.parse(req.url,true); const path = parsedUrl.pathname;
  if(req.method==='POST'){
    let body=''; req.on('data',chunk=>body+=chunk); req.on('end',()=>{
      const data = querystring.parse(body);
      if(path==='/api/hotel/register'){ hotels.push({...data, id:data.hotelId, status:'Pending', commission:0.1, rating:0, subscription:'Starter'}); logActivity('Hotel', data.hotelId, 'New Application'); sendJSON(res,{ok:true}); }
      if(path==='/api/vendor/register'){ vendors.push({...data, id:data.email, status:'Pending', rating:0}); logActivity('Vendor', data.email, 'New Application'); sendJSON(res,{ok:true}); }
      if(path==='/api/precheckin'){ precheckins.push({...data, id:Date.now()}); logActivity('Guest', data.hotelId, 'Completed Pre-Checkin'); sendJSON(res,{ok:true}); }
      if(path==='/api/request'){ requests.push({...data, id:Date.now(), status:'Pending', time:new Date()}); logActivity('Guest', data.hotelId, `Request: ${data.service}`); sendJSON(res,{ok:true}); }
      if(path==='/api/book'){ const hotel = hotels.find(h=>h.id===data.hotelId); const commission = parseInt(data.price) * (hotel?hotel.commission:0.1); const ourCut = commission/2; const hotelEarning = commission/2; bookings.push({...data, id:Date.now(), commission, ourCut, hotelEarning, status:'Confirmed', time:new Date()}); logActivity('Guest', data.hotelId, `Booked: ${data.serviceName}`); sendJSON(res,{ok:true, aiTip: getAITip(data.serviceName)}); }
      if(path==='/api/hotel/add-service'){ services.push({...data, id:Date.now(), status:'Pending'}); sendJSON(res,{ok:true}); }
      if(path==='/api/admin/approve-hotel'){ let h=hotels.find(h=>h.id===data.id); if(h) h.status='Approved'; sendJSON(res,{ok:true}); }
      if(path==='/api/admin/approve-vendor'){ let v=vendors.find(v=>v.id===data.id); if(v) v.status='Approved'; sendJSON(res,{ok:true}); }
    });
  } else {
    if(path==='/'||path==='/index.html') serveFile(res,'index.html');
    if(path==='/guest.html') serveFile(res,'guest.html');
    if(path==='/precheckin.html') serveFile(res,'precheckin.html');
    if(path==='/hotel-signup.html') serveFile(res,'hotel-signup.html');
    if(path==='/hotel-dashboard.html') serveFile(res,'hotel-dashboard.html');
    if(path==='/vendor-signup.html') serveFile(res,'vendor-signup.html');
    if(path==='/admin.html') serveFile(res,'admin.html');
    if(path==='/api/data') sendJSON(res,{hotels,vendors,services,requests,bookings,activities,precheckins});
  }
});
function getAITip(service){ if(!service) return 'AI: Karibu Diani! Powered by GUESTCONNECT'; if(service.includes('Spa')||service.includes('Massage')) return 'AI CONCIERGE: Guest who booked Spa also likes Dhow Sunset Cruise tomorrow. Offer via GUESTCONNECT'; if(service.includes('Tour')||service.includes('Dolphin')) return 'AI CONCIERGE: Suggest Airport Transfer for departure + Beach Towel request.'; return 'AI CONCIERGE: Perfect upsell - Wasini Dolphin Tour, 87% love it.'; }
server.listen(PORT,()=>console.log(`GUESTCONNECT v5.1 FIXED on ${PORT}`));
