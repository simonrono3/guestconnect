// ============================================================
// GuestHub V2.1 — Guest Love Edition
// Adds: push notifications, ETA, kitchen state, cancel window,
// rate+tip, SSE kitchen channel, extended bootstrap, vendor
// hours/gallery, dietary tags, item availability & images.
// ============================================================

import express from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import multer from "multer";
import webpush from "web-push";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 10000;

const REQUIRED = ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_KEY", "JWT_SECRET", "ADMIN_PASSWORD"];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.warn("⚠️  Missing env vars:", missing.join(", "));
}

const SUPABASE_URL     = process.env.SUPABASE_URL || "";
const SUPABASE_ANON    = process.env.SUPABASE_KEY || "";
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || "";
const JWT_SECRET       = process.env.JWT_SECRET || "dev_only_change_me";
const ADMIN_PASSWORD   = process.env.ADMIN_PASSWORD || "admin123";

// ---------- Web Push (FIX #1) ----------
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || "mailto:admin@guesthub.app";
const PUSH_ENABLED  = !!(VAPID_PUBLIC && VAPID_PRIVATE);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  console.log("✅ Web Push VAPID configured");
} else {
  console.log("ℹ️  Web Push disabled — set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY to enable");
}

let supa = null;
if (SUPABASE_URL && SUPABASE_SERVICE) {
  supa = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  console.log("✅ Supabase client ready");
} else {
  console.error("❌ Supabase client NOT created — missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
}

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

const ALLOWED_ORIGINS = [
  "https://guestconnect-ap2q.onrender.com",
  "https://ap2q.onrender.com",
  "http://localhost:10000",
  "http://localhost:3000"
];
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    try { if (new URL(origin).hostname.endsWith(".onrender.com")) return cb(null, true); } catch {}
    return cb(new Error("CORS"));
  },
  credentials: true
}));

const loginLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true });
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true });
const orderLimiter  = rateLimit({ windowMs: 60 * 1000,      max: 30, standardHeaders: true });
app.use("/api/", rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true }));

app.get("/healthz", (req, res) => res.status(200).send("ok"));
app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    os: "GuestHub V2.1",
    time: new Date().toISOString(),
    supabase: !!supa,
    push: PUSH_ENABLED,
    missing_env: missing
  })
);

app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.setHeader("Cache-Control", "no-cache");
  const u = JSON.stringify(SUPABASE_URL || "");
  const k = JSON.stringify(SUPABASE_ANON || "");
  res.send(
    `window.SUPABASE_URL=${u};` +
    `window.SUPABASE_KEY=${k};` +
    `window.SUPABASE_ANON_KEY=${k};` +
    `window.GUESTHUB_SUPABASE_URL=${u};` +
    `window.GUESTHUB_SUPABASE_KEY=${k};`
  );
});

// ============================================================
// Helpers
// ============================================================
const clean     = v => String(v || "").trim().toLowerCase();
const cleanText = (v, m = 500) => String(v || "").trim().slice(0, m).replace(/[<>]/g, "");
const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));
const isValidId = id => /^[A-Za-z0-9_-]{1,100}$/.test(String(id || ""));
const isUUID = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));
const safeNumber = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
const cleanPhone = v => {
  const d = String(v || "").replace(/\D/g, "");
  if (d.startsWith("254")) return d;
  if (d.startsWith("0")) return "254" + d.slice(1);
  return d;
};
const sanitizeIdentifier = v => String(v || "").trim().replace(/[%_]/g, "");
const sendError = (res, s, m) => res.status(s).json({ ok: false, error: m });
const sendSuccess = (res, d = {}) => res.json({ ok: true, ...d });
const makeRef = () => "GH-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(100 + Math.random() * 900);
const makeBookingRef = () => "BK-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(100 + Math.random() * 900);

function requireSupabase(req, res, next) {
  if (!supa) return sendError(res, 503, "Server not configured. Contact admin.");
  next();
}

function isMissingColumnError(err) {
  return err && /column|schema cache|does not exist/i.test(err.message || "");
}

// ---------- Status model ----------
const ALLOWED_STATUSES = ["pending", "new", "accepted", "preparing", "on_the_way", "completed", "cancelled"];
const VALID_TRANSITIONS = {
  pending:    ["accepted", "preparing", "on_the_way", "completed", "cancelled"],
  new:        ["accepted", "preparing", "on_the_way", "completed", "cancelled"],
  accepted:   ["preparing", "on_the_way", "completed", "cancelled"],
  preparing:  ["on_the_way", "completed", "cancelled"],
  on_the_way: ["completed", "cancelled"],
  completed:  [],
  cancelled:  []
};
const normalizeStatusKey = v => String(v || "pending").toLowerCase().trim().replace(/\s+/g, "_");

// ---------- Payment model ----------
const PAYMENT_CHANNELS = ["paybill", "till", "send_money"];

function validatePayment(body, forcedChannel) {
  const channel = String(forcedChannel || body.payment_channel || "send_money").toLowerCase();
  if (!PAYMENT_CHANNELS.includes(channel))
    return { error: "Payment channel must be paybill, till, or send_money" };

  const patch = { payment_channel: channel };

  if (channel === "paybill") {
    const num = String(body.paybill_number || "").replace(/\D/g, "");
    const acc = cleanText(body.paybill_account, 40);
    if (!/^\d{4,10}$/.test(num)) return { error: "Paybill number must be 4–10 digits" };
    patch.paybill_number = num;
    patch.paybill_account = acc || null;
    patch.till_number = null;
    patch.mpesa = null;
  } else if (channel === "till") {
    const till = String(body.till_number || "").replace(/\D/g, "");
    if (!/^\d{4,10}$/.test(till)) return { error: "Till number must be 4–10 digits" };
    patch.till_number = till;
    patch.paybill_number = null;
    patch.paybill_account = null;
    patch.mpesa = null;
  } else {
    const phone = cleanPhone(body.mpesa || body.phone);
    if (!/^254\d{9}$/.test(phone))
      return { error: "Valid M-Pesa phone required (e.g., 0712 345 678)" };
    patch.mpesa = phone;
    patch.paybill_number = null;
    patch.paybill_account = null;
    patch.till_number = null;
  }
  return { patch };
}

// ---------- Auth ----------
const createToken = (payload, exp = "7d") => jwt.sign(payload, JWT_SECRET, { expiresIn: exp });
const verifyToken = req => {
  const h = req.headers.authorization || req.headers["x-auth-token"];
  if (!h) return null;
  const t = h.startsWith("Bearer ") ? h.slice(7) : h;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
};
function requireAdmin(req, res, next) {
  const t = verifyToken(req);
  if (!t || t.role !== "admin") return sendError(res, 401, "Admin access required");
  req.user = t; next();
}
function requireHotel(req, res, next) {
  const t = verifyToken(req);
  if (!t || t.role !== "hotel") return sendError(res, 401, "Hotel login required");
  req.user = t; next();
}
function requireVendor(req, res, next) {
  const t = verifyToken(req);
  if (!t || t.role !== "vendor") return sendError(res, 401, "Vendor login required");
  req.user = t; next();
}
function requireGuest(req, res, next) {
  const t = verifyToken(req);
  if (!t || t.role !== "guest") return sendError(res, 401, "Guest session required");
  req.user = t; next();
}

// ============================================================
// SAFE HOTEL LOOKUP
// ============================================================
async function findHotel(identifier) {
  if (!identifier) return { hotel: null };
  const id = sanitizeIdentifier(identifier);

  try {
    const { data, error } = await supa
      .from("hotels")
      .select("id, hotel_id, name, hotel_name, status")
      .ilike("hotel_id", id)
      .maybeSingle();
    if (error) console.warn("⚠️ [findHotel] ilike hotel_id error:", error.message);
    if (data) return { hotel: data };
  } catch (e) {
    console.warn("⚠️ [findHotel] ilike exception:", e.message);
  }

  if (isUUID(id)) {
    try {
      const { data, error } = await supa
        .from("hotels")
        .select("id, hotel_id, name, hotel_name, status")
        .eq("id", id)
        .maybeSingle();
      if (error) console.warn("⚠️ [findHotel] eq id error:", error.message);
      if (data) return { hotel: data };
    } catch (e) {
      console.warn("⚠️ [findHotel] eq id exception:", e.message);
    }
  }

  return { hotel: null };
}

// ============================================================
// SUPABASE STORAGE — hotel images bucket
// ============================================================
const BUCKET = "hotel-images";

async function ensureBucket() {
  if (!supa) return;
  try {
    const { data: buckets, error } = await supa.storage.listBuckets();
    if (error) { console.warn("⚠️ listBuckets:", error.message); return; }
    if (!buckets?.some(b => b.name === BUCKET)) {
      const { error: cErr } = await supa.storage.createBucket(BUCKET, { public: true });
      if (cErr) console.warn("⚠️ createBucket:", cErr.message);
      else console.log(`✅ Created Supabase Storage bucket "${BUCKET}"`);
    } else {
      console.log(`✅ Supabase Storage bucket "${BUCKET}" ready`);
    }
  } catch (e) {
    console.warn("⚠️ ensureBucket:", e.message);
  }
}
ensureBucket();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG, PNG or WEBP allowed"), ok);
  }
});

// ============================================================
// PUSH HELPERS (FIX #1)
// ============================================================
async function pushToSession(sessionId, payload) {
  if (!PUSH_ENABLED || !supa) return { sent: 0, failed: 0 };
  const { data: subs } = await supa
    .from("guest_push_subscriptions")
    .select("*")
    .eq("guest_session_id", sessionId);

  let sent = 0, failed = 0;
  const stale = [];

  for (const s of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) stale.push(s.id);
    }
  }

  if (stale.length) {
    await supa.from("guest_push_subscriptions").delete().in("id", stale);
  }

  await supa.from("guest_push_subscriptions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("guest_session_id", sessionId);

  return { sent, failed };
}

async function pushOrderUpdate(order) {
  if (!order?.guest_session_id) return;
  const titles = {
    accepted:   "Order accepted",
    preparing:  "Being prepared",
    on_the_way: "On the way",
    completed:  "Order delivered",
    cancelled:  "Order cancelled"
  };
  const title = titles[order.status] || "Order update";
  await pushToSession(order.guest_session_id, {
    title,
    body: `${order.service_title || "Your order"} · ${order.reference || ""}`,
    url: `/?hotel=${order.hotel_id}&order=${order.id}`,
    tag: `order-${order.id}`,
    orderId: order.id,
    status: order.status
  });
}

async function pushBookingUpdate(booking) {
  if (!booking?.guest_session_id) return;
  const titles = {
    confirmed: "Booking confirmed",
    declined:  "Booking declined",
    completed: "Booking completed",
    cancelled: "Booking cancelled"
  };
  const title = titles[booking.status] || "Booking update";
  await pushToSession(booking.guest_session_id, {
    title,
    body: `${booking.service_title || "Your booking"} · ${new Date(booking.scheduled_for).toLocaleString()}`,
    url: `/?hotel=${booking.hotel_id}&booking=${booking.id}`,
    tag: `booking-${booking.id}`,
    bookingId: booking.id,
    status: booking.status
  });
}

// ============================================================
// SSE KITCHEN REGISTRY (FIX #13)
// ============================================================
const guestStreamsByHotel = new Map(); // hotelId -> Set of {send, sid}

function broadcastKitchen(hotelId, payload) {
  const set = guestStreamsByHotel.get(String(hotelId).toUpperCase());
  if (!set) return;
  for (const entry of set) {
    try { entry.send("kitchen", payload); } catch {}
  }
}

// ============================================================
// ADMIN
// ============================================================
app.post("/api/admin/login", loginLimiter, async (req, res) => {
  try {
    const pw = String(req.body.password || "");
    if (!pw) return sendError(res, 400, "Password required");
    const valid = ADMIN_PASSWORD.startsWith("$2")
      ? await bcrypt.compare(pw, ADMIN_PASSWORD)
      : pw === ADMIN_PASSWORD;
    if (!valid) return sendError(res, 401, "Wrong password");
    const token = createToken({ role: "admin" }, "12h");
    return sendSuccess(res, { token });
  } catch { return sendError(res, 500, "Server error"); }
});

app.get("/api/admin/stats", requireAdmin, requireSupabase, async (req, res) => {
  const [hotels, vendors, orders, services] = await Promise.all([
    supa.from("hotels").select("id,status", { count: "exact" }),
    supa.from("vendors").select("id,status", { count: "exact" }),
    supa.from("orders").select("id,amount,status"),
    supa.from("hotel_services").select("id", { count: "exact" })
  ]);
  const orderData = orders.data || [];
  const gmv = orderData.reduce((s, o) => s + safeNumber(o.amount), 0);
  return sendSuccess(res, {
    hotels: hotels.count || 0,
    pendingHotels: (hotels.data || []).filter(h => h.status === "PENDING").length,
    vendors: vendors.count || 0,
    pendingVendors: (vendors.data || []).filter(v => v.status === "pending").length,
    orders: orderData.length,
    services: services.count || 0,
    gmv,
    commission: Math.floor(gmv * 0.15)
  });
});

app.get("/api/admin/hotels", requireAdmin, requireSupabase, async (req, res) => {
  const { data } = await supa.from("hotels")
    .select("id,hotel_id,name,hotel_name,email,phone,city,location,hotel_type,plan,status,created_at")
    .order("created_at", { ascending: false }).limit(500);
  res.json({ hotels: data || [] });
});

app.post("/api/admin/hotels/:id/approve", requireAdmin, requireSupabase, async (req, res) => {
  try {
    const { hotel } = await findHotel(req.params.id);
    if (!hotel) return sendError(res, 404, "Hotel not found: " + req.params.id);
    const { data: updated, error } = await supa
      .from("hotels")
      .update({ status: "APPROVED" })
      .eq("id", hotel.id)
      .select()
      .single();
    if (error) return sendError(res, 500, "Update failed: " + error.message);
    return sendSuccess(res, { hotel: updated });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.post("/api/admin/hotels/:id/block", requireAdmin, requireSupabase, async (req, res) => {
  try {
    const { hotel } = await findHotel(req.params.id);
    if (!hotel) return sendError(res, 404, "Hotel not found: " + req.params.id);
    const { error } = await supa.from("hotels")
      .update({ status: "BLOCKED" }).eq("id", hotel.id);
    if (error) return sendError(res, 500, error.message);
    sendSuccess(res);
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.delete("/api/admin/hotels/:id", requireAdmin, requireSupabase, async (req, res) => {
  try {
    const { hotel } = await findHotel(req.params.id);
    if (!hotel) return sendError(res, 404, "Hotel not found: " + req.params.id);
    const { error } = await supa.from("hotels").delete().eq("id", hotel.id);
    if (error) return sendError(res, 500, error.message);
    sendSuccess(res);
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.get("/api/admin/vendors", requireAdmin, requireSupabase, async (req, res) => {
  const { data } = await supa.from("vendors").select("*")
    .order("created_at", { ascending: false }).limit(500);
  res.json({ vendors: data || [] });
});

app.post("/api/admin/vendors/:id/approve", requireAdmin, requireSupabase, async (req, res) => {
  try {
    const status = String(req.body.status || "approved").toLowerCase();
    if (!["approved", "rejected", "blocked"].includes(status))
      return sendError(res, 400, "Invalid status");

    const { data, error } = await supa
      .from("vendors")
      .update({ status, is_active: status === "approved" })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) return sendError(res, 500, error.message);
    sendSuccess(res, { vendor: data });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.delete("/api/admin/vendors/:id", requireAdmin, requireSupabase, async (req, res) => {
  try {
    const vid = req.params.id;
    const { error: e1 } = await supa.from("vendor_hotels").delete().eq("vendor_id", vid);
    if (e1) console.warn("⚠️ vendor_hotels delete warning:", e1.message);

    const { error: e2 } = await supa.from("vendors").delete().eq("id", vid);
    if (e2) return sendError(res, 500, e2.message);

    sendSuccess(res);
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.get("/api/admin/orders", requireAdmin, requireSupabase, async (req, res) => {
  const { data } = await supa.from("orders").select("*")
    .order("created_at", { ascending: false }).limit(200);
  res.json({ orders: data || [] });
});

app.get("/api/admin/commission", requireAdmin, requireSupabase, async (req, res) => {
  const status = String(req.query.status || "").toLowerCase();
  let q = supa.from("commission_ledger").select("*")
    .order("created_at", { ascending: false }).limit(500);
  if (["owed", "settled", "waived"].includes(status)) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return sendError(res, 500, error.message);

  const totals = (data || []).reduce((acc, r) => {
    acc.gross += Number(r.gross_amount) || 0;
    acc.commission += Number(r.commission) || 0;
    acc[r.status] = (acc[r.status] || 0) + Number(r.commission || 0);
    return acc;
  }, { gross: 0, commission: 0, owed: 0, settled: 0, waived: 0 });

  return sendSuccess(res, { ledger: data || [], totals });
});

app.patch("/api/admin/commission/:id", requireAdmin, requireSupabase, async (req, res) => {
  const status = String(req.body.status || "").toLowerCase();
  if (!["owed", "settled", "waived"].includes(status)) return sendError(res, 400, "Invalid status");
  const patch = { status };
  if (status === "settled") {
    patch.settled_at = new Date().toISOString();
    patch.settled_ref = cleanText(req.body.settled_ref, 100) || null;
  }
  const { data, error } = await supa.from("commission_ledger")
    .update(patch).eq("id", req.params.id).select().single();
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { entry: data });
});

// ============================================================
// HOTELS
// ============================================================
app.get("/api/data", requireSupabase, async (req, res) => {
  let { data, error } = await supa.from("hotels")
    .select("id,hotel_id,name,hotel_name,location,city,hotel_type,status,image_url,images")
    .eq("status", "APPROVED").limit(500);

  if (error && isMissingColumnError(error)) {
    const r2 = await supa.from("hotels")
      .select("id,hotel_id,name,hotel_name,location,city,hotel_type,status")
      .eq("status", "APPROVED").limit(500);
    data = r2.data || [];
  }

  const hotels = (data || []).map(h => ({
    ...h,
    image_url: h.image_url || (Array.isArray(h.images) && h.images[0]) || null
  }));

  res.json({ hotels });
});

app.get("/api/public/hotel/:id", requireSupabase, async (req, res) => {
  try {
    const { hotel } = await findHotel(req.params.id);
    if (!hotel) return sendError(res, 404, "Hotel not found");

    const status = String(hotel.status || "").toUpperCase();
    if (status && status !== "APPROVED") return sendError(res, 403, "Hotel not available");

    const { data: full } = await supa.from("hotels").select("*").eq("id", hotel.id).maybeSingle();
    const safe = { ...(full || hotel) };
    delete safe.password_hash;
    delete safe.manager_password;
    delete safe.manager_email;
    return sendSuccess(res, { hotel: safe });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.post("/api/hotels/signup", signupLimiter, requireSupabase, async (req, res) => {
  try {
    const { hotel_name, name, manager_name, location, city, hotel_type, rooms, website, email, phone, password } = req.body;
    const finalName = cleanText(hotel_name || name, 100);
    if (!finalName || finalName.length < 3) return sendError(res, 400, "Hotel name too short");
    const finalEmail = clean(email);
    if (!isValidEmail(finalEmail)) return sendError(res, 400, "Invalid email");
    if (!password || String(password).length < 8) return sendError(res, 400, "Password must be 8+");

    let baseId = finalName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "hotel";
    let hotelId = baseId.toUpperCase();
    let suffix = 1;
    while (true) {
      const { data: ex } = await supa.from("hotels").select("id").eq("hotel_id", hotelId).maybeSingle();
      if (!ex) break;
      hotelId = (baseId + suffix).toUpperCase();
      suffix++;
      if (suffix > 999) return sendError(res, 500, "Could not generate ID");
    }

    const hash = await bcrypt.hash(String(password), 12);
    const { error } = await supa.from("hotels").insert([{
      hotel_id: hotelId,
      name: finalName, hotel_name: finalName,
      manager_name: cleanText(manager_name, 100),
      city: cleanText(city || location || "Mombasa", 80),
      location: cleanText(location || city || "Mombasa", 100),
      hotel_type: cleanText(hotel_type || "Luxury Hotel", 40),
      rooms: safeNumber(rooms, 0),
      website: cleanText(website, 200),
      email: finalEmail,
      phone: cleanPhone(phone),
      status: "PENDING",
      password_hash: hash
    }]);
    if (error) {
      if (error.code === "23505") return sendError(res, 409, "Hotel already registered");
      throw error;
    }
    return sendSuccess(res, { hotel_id: hotelId, status: "PENDING" });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.post("/api/hotels/login", loginLimiter, requireSupabase, async (req, res) => {
  try {
    const { hotel_id, hotelId, email, password } = req.body;
    const id = clean(hotel_id || hotelId);
    if (!password) return sendError(res, 400, "Password required");
    if (!id && !email) return sendError(res, 400, "Hotel ID or email required");

    let hotel = null;
    if (id) {
      if (!isValidId(id)) return sendError(res, 400, "Invalid hotel ID");
      const found = await findHotel(id);
      hotel = found.hotel;
    } else {
      const { data } = await supa.from("hotels").select("*").eq("email", clean(email)).maybeSingle();
      hotel = data;
    }

    if (!hotel) return sendError(res, 404, "Hotel not found");

    const { data: fullHotel } = await supa.from("hotels").select("*").eq("id", hotel.id).maybeSingle();
    if (!fullHotel) return sendError(res, 404, "Hotel not found");

    const ok = await bcrypt.compare(String(password), fullHotel.password_hash);
    if (!ok) return sendError(res, 401, "Wrong password");
    if (String(fullHotel.status).toUpperCase() !== "APPROVED")
      return sendError(res, 403, "Hotel not approved. Status: " + fullHotel.status);

    const token = createToken({ role: "hotel", hotel_id: fullHotel.hotel_id, email: fullHotel.email }, "7d");
    delete fullHotel.password_hash;
    return sendSuccess(res, { token, hotel_id: fullHotel.hotel_id, hotel: fullHotel });
  } catch (e) { return sendError(res, 500, e.message); }
});

// ============================================================
// HOTEL IMAGES
// ============================================================
app.post(
  "/api/hotels/images",
  signupLimiter,
  requireSupabase,
  (req, res, next) => {
    const hotelId = String(req.body?.hotel_id || "").trim();
    if (!hotelId) return sendError(res, 400, "hotel_id required");
    const t = verifyToken(req);
    if (t && t.role === "hotel" && t.hotel_id !== hotelId.toUpperCase())
      return sendError(res, 403, "You can only upload images for your own hotel");
    next();
  },
  imageUpload.array("images", 8),
  async (req, res) => {
    try {
      const hotel_id = String(req.body.hotel_id || "").trim().toUpperCase();
      const coverIndex = Math.max(0, safeNumber(req.body.cover_index, 0));

      if (!hotel_id) return sendError(res, 400, "hotel_id required");
      if (!req.files?.length) return sendError(res, 400, "No images received");

      const { hotel } = await findHotel(hotel_id);
      if (!hotel) return sendError(res, 404, "Hotel not found: " + hotel_id);

      const uploaded = [];
      for (let i = 0; i < req.files.length; i++) {
        const f = req.files[i];
        const ext = f.mimetype === "image/png" ? "png"
                  : f.mimetype === "image/webp" ? "webp"
                  : "jpg";
        const fileName = `${hotel_id}_${Date.now()}_${i}.${ext}`;
        const filePath = `${hotel_id}/${fileName}`;

        const { error: upErr } = await supa.storage
          .from(BUCKET)
          .upload(filePath, f.buffer, {
            contentType: f.mimetype,
            cacheControl: "31536000",
            upsert: false
          });

        if (upErr) {
          console.warn("⚠️ upload failed:", fileName, upErr.message);
          continue;
        }

        const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(filePath);
        if (pub?.publicUrl) uploaded.push(pub.publicUrl);
      }

      if (!uploaded.length) return sendError(res, 500, "All uploads failed");

      const cover = uploaded[Math.min(coverIndex, uploaded.length - 1)];

      const patch = { image_url: cover, images: uploaded };
      let { error: dbErr } = await supa.from("hotels").update(patch).eq("id", hotel.id);

      if (dbErr && isMissingColumnError(dbErr)) {
        const r2 = await supa.from("hotels").update({ image_url: cover }).eq("id", hotel.id);
        dbErr = r2.error;
      }

      if (dbErr) {
        return sendSuccess(res, {
          images: uploaded, cover,
          warning: "Images uploaded but not saved to hotel record: " + dbErr.message
        });
      }

      return sendSuccess(res, { images: uploaded, cover });
    } catch (e) {
      console.error("Hotel image upload error:", e);
      return sendError(res, 500, e.message);
    }
  }
);

// ============================================================
// HOTEL PAYMENT
// ============================================================
app.patch("/api/gm/payment", requireHotel, requireSupabase, async (req, res) => {
  try {
    const check = validatePayment(req.body);
    if (check.error) return sendError(res, 400, check.error);

    if (req.body.mpesa_name !== undefined) {
      check.patch.mpesa_name = cleanText(req.body.mpesa_name, 100) || null;
    }

    const { hotel } = await findHotel(req.user.hotel_id);
    if (!hotel) return sendError(res, 404, "Hotel not found");

    let { data, error } = await supa
      .from("hotels")
      .update(check.patch)
      .eq("id", hotel.id)
      .select()
      .single();

    if (error && isMissingColumnError(error))
      return sendError(res, 501, "Payment columns missing on hotels table. Run SCHEMA.sql.");
    if (error) return sendError(res, 500, error.message);

    return sendSuccess(res, {
      payment: {
        channel:         data.payment_channel,
        paybill_number:  data.paybill_number,
        paybill_account: data.paybill_account,
        till_number:     data.till_number,
        mpesa_phone:     data.phone,
        mpesa_name:      data.mpesa_name,
        configured:      !!(data.paybill_number || data.till_number || data.phone)
      }
    });
  } catch (e) {
    console.error("GM payment save error:", e);
    return sendError(res, 500, e.message);
  }
});

app.get("/api/public/hotel/:hotelId/payment", requireSupabase, async (req, res) => {
  try {
    const hid = String(req.params.hotelId || "").trim().toUpperCase();
    if (!hid) return sendError(res, 400, "hotelId required");

    const { data, error } = await supa
      .from("hotels")
      .select("hotel_id, name, hotel_name, phone, payment_channel, paybill_number, paybill_account, till_number, mpesa_name")
      .ilike("hotel_id", hid)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error)) {
        return sendSuccess(res, {
          payment: {
            channel: "paybill", paybill_number: null, paybill_account: null,
            till_number: null, mpesa_name: null, mpesa_phone: null, configured: false
          }
        });
      }
      return sendError(res, 500, error.message);
    }
    if (!data) return sendError(res, 404, "Hotel not found");

    const channel = String(data.payment_channel || "").toLowerCase();
    const hasPaybill = channel === "paybill" && !!data.paybill_number;
    const hasTill    = channel === "till"    && !!data.till_number;
    const hasSend    = channel === "send_money" && !!data.phone;

    return sendSuccess(res, {
      payment: {
        channel:         channel || "paybill",
        paybill_number:  data.paybill_number  || null,
        paybill_account: data.paybill_account || null,
        till_number:     data.till_number     || null,
        mpesa_phone:     data.phone           || null,
        mpesa_name:      data.mpesa_name      || data.name || data.hotel_name || null,
        configured:      !!(hasPaybill || hasTill || hasSend)
      }
    });
  } catch (e) {
    console.error("Public hotel payment error:", e);
    return sendError(res, 500, e.message);
  }
});

// ============================================================
// VENDOR SIGNUP
// ============================================================
app.post("/api/vendors/signup", signupLimiter, requireSupabase, async (req, res) => {
  try {
    const {
      full_name, vendor_name, email, password, phone,
      id_number, city, location, location_hub,
      category, services, price, bio,
      hotels, hotel_ids,
      vehicle, plate, radius, country
    } = req.body;

    const finalName = cleanText(vendor_name || full_name, 100);
    if (!finalName || finalName.length < 2)
      return sendError(res, 400, "Vendor name too short");

    const finalEmail = clean(email);
    if (!isValidEmail(finalEmail)) return sendError(res, 400, "Invalid email");
    if (!password || String(password).length < 8)
      return sendError(res, 400, "Password must be 8+");
    if (!phone) return sendError(res, 400, "Phone required");
    if (!id_number) return sendError(res, 400, "ID number required");

    const payCheck = validatePayment(req.body);
    if (payCheck.error) return sendError(res, 400, payCheck.error);

    const { data: existing } = await supa
      .from("vendors").select("id").eq("email", finalEmail).maybeSingle();
    if (existing) return sendError(res, 409, "Vendor already registered with this email");

    const hash = await bcrypt.hash(String(password), 12);
    const serviceList = Array.isArray(services) ? services : [];

    const groupLabel = (() => {
      const c = String(category || serviceList[0] || "").toLowerCase();
      if (c.includes("transport") || c.includes("taxi")) return "transport";
      if (c.includes("tour") || c.includes("safari"))     return "tours";
      if (c.includes("wellness") || c.includes("spa") || c.includes("massage")) return "wellness";
      if (c.includes("media") || c.includes("photo"))     return "media";
      return "services";
    })();

    const insertPayload = {
      vendor_name: finalName,
      email: finalEmail,
      phone: cleanPhone(phone),
      password_hash: hash,
      category: cleanText(category || serviceList[0] || "services", 40),
      bio: cleanText(bio || "", 300),
      price: safeNumber(price, 0),
      city: cleanText(city || "", 80),
      status: "pending",
      is_active: false
    };

    const optional = {
      full_name: finalName,
      id_number: cleanText(id_number, 40),
      hub_location: cleanText(location_hub || location || "", 100),
      services: serviceList,
      payout_method: cleanText(req.body.payout_method || payCheck.patch.payment_channel, 20),
      mpesa_name: cleanText(req.body.mpesa_name || finalName, 100),
      vehicle: cleanText(vehicle, 80),
      plate:   cleanText(plate, 40),
      radius:  cleanText(radius, 40),
      country: cleanText(country, 40),
      group_label: groupLabel,
      ...payCheck.patch
    };

    let { data: vendor, error } = await supa
      .from("vendors").insert([{ ...insertPayload, ...optional }]).select().single();

    if (error && isMissingColumnError(error)) {
      console.warn("⚠️ Optional vendor columns missing, retrying minimal:", error.message);
      const retry = await supa.from("vendors").insert([{ ...insertPayload, ...payCheck.patch }]).select().single();
      vendor = retry.data;
      error = retry.error;
    }

    if (error) {
      if (error.code === "23505") return sendError(res, 409, "Vendor already registered");
      return sendError(res, 500, error.message);
    }

    const chosen = Array.isArray(hotels) && hotels.length ? hotels
                 : Array.isArray(hotel_ids) && hotel_ids.length ? hotel_ids
                 : [];

    let hotelIds = chosen.filter(h => isValidId(h) && h !== "ALL");
    if (chosen.includes("ALL")) {
      const { data: allHotels } = await supa.from("hotels").select("hotel_id").eq("status", "APPROVED");
      hotelIds = (allHotels || []).map(h => h.hotel_id).filter(Boolean);
    }

    if (hotelIds.length) {
      const links = hotelIds.map(hid => ({
        vendor_id: vendor.id,
        hotel_id: String(hid).toUpperCase(),
        is_active: false
      }));
      await supa.from("vendor_hotels").upsert(links, { onConflict: "vendor_id,hotel_id" });
    }

    return sendSuccess(res, {
      vendor_id: vendor.id,
      status: "pending",
      hotels_linked: hotelIds.length,
      payment_channel: payCheck.patch.payment_channel,
      message: "Signup received. Awaiting admin approval."
    });
  } catch (e) {
    console.error("Vendor signup error:", e);
    return sendError(res, 500, e.message);
  }
});

app.post("/api/vendors/login", loginLimiter, requireSupabase, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return sendError(res, 400, "Email and password required");

    const { data: vendor } = await supa
      .from("vendors").select("*").eq("email", clean(email)).maybeSingle();

    if (!vendor) return sendError(res, 404, "Vendor not found");

    const ok = await bcrypt.compare(String(password), vendor.password_hash);
    if (!ok) return sendError(res, 401, "Wrong password");

    if (String(vendor.status).toLowerCase() !== "approved")
      return sendError(res, 403, "Vendor not approved. Status: " + vendor.status);

    const token = createToken({ role: "vendor", vendor_id: vendor.id }, "7d");
    delete vendor.password_hash;
    return sendSuccess(res, { token, vendor });
  } catch (e) {
    console.error("Vendor login error:", e);
    return sendError(res, 500, e.message);
  }
});

// ============================================================
// GM endpoints
// ============================================================
app.get("/api/gm/me", requireHotel, requireSupabase, async (req, res) => {
  const hid = req.user.hotel_id;
  const { hotel } = await findHotel(hid);
  const { data: depts } = await supa.from("departments").select("*").eq("hotel_id", hid);
  return sendSuccess(res, { hotel, departments: depts || [] });
});

app.get("/api/gm/services", requireHotel, requireSupabase, async (req, res) => {
  const { data } = await supa.from("hotel_services")
    .select("*").eq("hotel_id", req.user.hotel_id)
    .order("created_at", { ascending: false });
  return sendSuccess(res, { services: data || [] });
});

app.post("/api/gm/services", requireHotel, requireSupabase, async (req, res) => {
  const { title, description, price, category, icon, kind, image_url, dietary_tags } = req.body;
  if (!title) return sendError(res, 400, "Title required");

  const finalKind = ["food", "hotel_service", "vendor_item"].includes(String(kind || "").toLowerCase())
    ? String(kind).toLowerCase()
    : "food";

  const payload = {
    hotel_id: req.user.hotel_id,
    title: cleanText(title, 120),
    description: cleanText(description, 300),
    price: safeNumber(price, 0),
    category: cleanText(category || "food", 30),
    icon: cleanText(icon || "🍔", 8),
    kind: finalKind,
    is_active: true
  };

  // FIX #3 & #6 — extend with image + dietary tags
  if (image_url) payload.image_url = cleanText(image_url, 500);
  if (Array.isArray(dietary_tags)) payload.dietary_tags = dietary_tags.slice(0, 10);

  let { data, error } = await supa.from("hotel_services").insert([payload]).select().single();
  if (error && isMissingColumnError(error)) {
    delete payload.image_url;
    delete payload.dietary_tags;
    const retry = await supa.from("hotel_services").insert([payload]).select().single();
    data = retry.data; error = retry.error;
  }
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { service: data });
});

app.patch("/api/gm/services/:id", requireHotel, requireSupabase, async (req, res) => {
  const { data: existing } = await supa.from("hotel_services")
    .select("hotel_id").eq("id", req.params.id).maybeSingle();
  if (!existing || existing.hotel_id !== req.user.hotel_id)
    return sendError(res, 403, "Not yours");

  const patch = {};
  if (req.body.title !== undefined) patch.title = cleanText(req.body.title, 120);
  if (req.body.description !== undefined) patch.description = cleanText(req.body.description, 300);
  if (req.body.price !== undefined) patch.price = safeNumber(req.body.price);
  if (req.body.category !== undefined) patch.category = cleanText(req.body.category, 30);
  if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active;
  // FIX #3 & #6 & #13
  if (req.body.image_url !== undefined) patch.image_url = cleanText(req.body.image_url, 500) || null;
  if (Array.isArray(req.body.dietary_tags)) patch.dietary_tags = req.body.dietary_tags.slice(0, 10);
  if (req.body.available !== undefined) patch.available = !!req.body.available;

  let { data, error } = await supa.from("hotel_services").update(patch).eq("id", req.params.id).select().single();
  if (error && isMissingColumnError(error)) {
    delete patch.image_url;
    delete patch.dietary_tags;
    delete patch.available;
    const retry = await supa.from("hotel_services").update(patch).eq("id", req.params.id).select().single();
    data = retry.data; error = retry.error;
  }
  if (error) return sendError(res, 500, error.message);
  sendSuccess(res, { service: data });
});

app.delete("/api/gm/services/:id", requireHotel, requireSupabase, async (req, res) => {
  const { data: existing } = await supa.from("hotel_services")
    .select("hotel_id").eq("id", req.params.id).maybeSingle();
  if (!existing || existing.hotel_id !== req.user.hotel_id)
    return sendError(res, 403, "Not yours");
  await supa.from("hotel_services").delete().eq("id", req.params.id);
  sendSuccess(res);
});

app.get("/api/gm/vendors-pool", requireHotel, requireSupabase, async (req, res) => {
  const hid = req.user.hotel_id;
  const { data: pool } = await supa.from("vendors").select("*").eq("status", "approved").limit(300);
  const { data: linked } = await supa.from("vendor_hotels")
    .select("vendor_id").eq("hotel_id", hid).eq("is_active", true);
  const myIds = (linked || []).map(l => l.vendor_id);
  sendSuccess(res, { pool: pool || [], myVendorIds: myIds });
});

app.post("/api/gm/vendors/:vendorId/add", requireHotel, requireSupabase, async (req, res) => {
  const hid = req.user.hotel_id;
  const vid = req.params.vendorId;
  if (!isValidId(vid)) return sendError(res, 400, "Invalid vendor");
  const { data: v } = await supa.from("vendors").select("*").eq("id", vid).maybeSingle();
  if (!v) return sendError(res, 404, "Vendor not found");

  await supa.from("vendor_hotels").upsert(
    [{ vendor_id: vid, hotel_id: hid, is_active: true }],
    { onConflict: "vendor_id,hotel_id" }
  );

  const { data: existing } = await supa.from("hotel_services")
    .select("id").eq("hotel_id", hid).eq("vendor_id", vid).maybeSingle();

  if (!existing) {
    const cat = String(v.category || "services").toLowerCase();
    const groupLabel =
      cat.includes("transport") || cat.includes("taxi") ? "transport"
    : cat.includes("tour")                            ? "tours"
    : cat.includes("wellness") || cat.includes("spa") || cat.includes("massage") ? "wellness"
    : cat.includes("media") || cat.includes("photo")  ? "media"
    : "services";

    const insertPayload = {
      hotel_id: hid,
      title: v.vendor_name,
      description: v.bio || "Available through GuestHub",
      price: safeNumber(v.price, 0),
      category: cat,
      icon: "🏪",
      vendor_id: vid,
      vendor_name: v.vendor_name,
      vendor_phone: v.phone,
      is_active: true,
      kind: "vendor_item",
      group_label: groupLabel
    };
    let { error } = await supa.from("hotel_services").insert([insertPayload]);
    if (error && isMissingColumnError(error)) {
      delete insertPayload.group_label;
      delete insertPayload.kind;
      const retry = await supa.from("hotel_services").insert([insertPayload]);
      error = retry.error;
    }
    if (error) return sendError(res, 500, error.message);
  } else {
    await supa.from("hotel_services").update({ is_active: true }).eq("id", existing.id);
  }
  sendSuccess(res, { message: v.vendor_name + " added" });
});

app.post("/api/gm/vendors/:vendorId/remove", requireHotel, requireSupabase, async (req, res) => {
  const hid = req.user.hotel_id;
  const vid = req.params.vendorId;
  await supa.from("vendor_hotels").update({ is_active: false }).eq("hotel_id", hid).eq("vendor_id", vid);
  await supa.from("hotel_services").update({ is_active: false }).eq("hotel_id", hid).eq("vendor_id", vid);
  sendSuccess(res);
});

app.get("/api/gm/departments", requireHotel, requireSupabase, async (req, res) => {
  const { data } = await supa.from("departments").select("*").eq("hotel_id", req.user.hotel_id);
  sendSuccess(res, { departments: data || [] });
});

app.post("/api/gm/departments", requireHotel, requireSupabase, async (req, res) => {
  const { name, whatsapp } = req.body;
  if (!name) return sendError(res, 400, "Department name required");
  const { data, error } = await supa.from("departments").upsert(
    [{ hotel_id: req.user.hotel_id, name: clean(name), whatsapp: cleanPhone(whatsapp) }],
    { onConflict: "hotel_id,name" }
  ).select().single();
  if (error) return sendError(res, 500, error.message);
  sendSuccess(res, { department: data });
});

app.get("/api/gm/orders", requireHotel, requireSupabase, async (req, res) => {
  const { data } = await supa.from("orders").select("*")
    .eq("hotel_id", req.user.hotel_id)
    .order("created_at", { ascending: false }).limit(200);
  sendSuccess(res, { orders: data || [] });
});

// FIX #1 — GM sets ETA + assigns staff
app.patch("/api/gm/orders/:id/eta", requireHotel, requireSupabase, async (req, res) => {
  try {
    const { data: existing } = await supa.from("orders")
      .select("hotel_id, guest_session_id, reference, service_title, status")
      .eq("id", req.params.id).maybeSingle();
    if (!existing || existing.hotel_id !== req.user.hotel_id)
      return sendError(res, 403, "Not yours");

    const patch = {};
    if (req.body.eta_minutes !== undefined)
      patch.eta_minutes = Math.max(0, Math.min(240, safeNumber(req.body.eta_minutes, 0)));
    if (req.body.assigned_to !== undefined)
      patch.assigned_to = cleanText(req.body.assigned_to, 80) || null;
    if (req.body.assigned_to_id !== undefined && isUUID(req.body.assigned_to_id))
      patch.assigned_to_id = req.body.assigned_to_id;

    if (!Object.keys(patch).length) return sendError(res, 400, "Nothing to update");

    const { data, error } = await supa.from("orders")
      .update(patch).eq("id", req.params.id).select().single();
    if (error && isMissingColumnError(error))
      return sendError(res, 501, "Run the migration SQL — missing eta/assigned_to columns");
    if (error) return sendError(res, 500, error.message);

    // Notify guest with new ETA
    if (data.guest_session_id && patch.eta_minutes !== undefined) {
      pushToSession(data.guest_session_id, {
        title: "ETA updated",
        body: `${data.service_title || "Your order"} — ready in ~${data.eta_minutes} min`,
        url: `/?hotel=${data.hotel_id}&order=${data.id}`,
        tag: `order-${data.id}`
      }).catch(() => {});
    }

    return sendSuccess(res, { order: data });
  } catch (e) { return sendError(res, 500, e.message); }
});

// FIX #13 — GM toggles kitchen busy
app.patch("/api/gm/kitchen/busy", requireHotel, requireSupabase, async (req, res) => {
  try {
    const busy = !!req.body.busy;
    const message = cleanText(req.body.message, 200) || null;
    const untilMin = Math.max(0, Math.min(240, safeNumber(req.body.until_minutes, 0)));
    const busyUntil = untilMin > 0 ? new Date(Date.now() + untilMin * 60000).toISOString() : null;

    let { data, error } = await supa.from("hotels")
      .update({ kitchen_busy: busy, busy_message: message, busy_until: busyUntil })
      .ilike("hotel_id", req.user.hotel_id)
      .select("hotel_id,kitchen_busy,busy_message,busy_until").single();

    if (error && isMissingColumnError(error))
      return sendError(res, 501, "Run the migration SQL — missing kitchen columns");
    if (error) return sendError(res, 500, error.message);

    broadcastKitchen(req.user.hotel_id, {
      busy: data.kitchen_busy,
      message: data.busy_message,
      until: data.busy_until
    });

    return sendSuccess(res, { kitchen: data });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.get("/api/gm/kitchen/busy", requireHotel, requireSupabase, async (req, res) => {
  const { data } = await supa.from("hotels")
    .select("hotel_id,kitchen_busy,busy_message,busy_until")
    .ilike("hotel_id", req.user.hotel_id).maybeSingle();
  return sendSuccess(res, { kitchen: data || { kitchen_busy: false } });
});

app.patch("/api/gm/orders/:id/status", requireHotel, requireSupabase, async (req, res) => {
  try {
    const next = normalizeStatusKey(req.body.status);
    if (!ALLOWED_STATUSES.includes(next)) return sendError(res, 400, "Invalid status");

    const { data: existing } = await supa.from("orders")
      .select("hotel_id, status, reference, guest_session_id, service_title, hotel_id")
      .eq("id", req.params.id).maybeSingle();
    if (!existing) return sendError(res, 404, "Order not found");
    if (existing.hotel_id !== req.user.hotel_id) return sendError(res, 403, "Not yours");

    const current = normalizeStatusKey(existing.status);
    if (next !== current) {
      const allowed = VALID_TRANSITIONS[current] || [];
      if (!allowed.includes(next)) return sendError(res, 400, `Cannot transition ${current} → ${next}`);
    }

    const now = new Date().toISOString();
    const patch = { status: next, updated_at: now };
    if (next === "accepted")   patch.accepted_at   = now;
    if (next === "on_the_way") patch.on_the_way_at = now;
    if (next === "completed")  patch.completed_at  = now;
    if (next === "cancelled")  patch.cancelled_at  = now;

    let { data, error } = await supa.from("orders").update(patch).eq("id", req.params.id).select().single();
    if (error && isMissingColumnError(error)) {
      const r2 = await supa.from("orders").update({ status: next }).eq("id", req.params.id).select().single();
      data = r2.data; error = r2.error;
    }
    if (error) return sendError(res, 500, error.message);

    // Push notification to guest (FIX #1)
    pushOrderUpdate(data).catch(() => {});

    return sendSuccess(res, { order: data });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.patch("/api/gm/orders/:id", requireHotel, requireSupabase, async (req, res) => {
  const { data: existing } = await supa.from("orders")
    .select("hotel_id, status").eq("id", req.params.id).maybeSingle();
  if (!existing || existing.hotel_id !== req.user.hotel_id)
    return sendError(res, 403, "Not yours");

  const patch = {};
  if (req.body.status !== undefined) {
    const next = normalizeStatusKey(req.body.status);
    if (!ALLOWED_STATUSES.includes(next)) return sendError(res, 400, "Invalid status");
    const current = normalizeStatusKey(existing.status);
    if (next !== current && !(VALID_TRANSITIONS[current] || []).includes(next)) {
      return sendError(res, 400, `Cannot transition ${current} → ${next}`);
    }
    patch.status = next;
    patch.updated_at = new Date().toISOString();
  }

  if (req.body.vendor_id) {
    const { data: v } = await supa.from("vendors")
      .select("vendor_name,phone").eq("id", req.body.vendor_id).maybeSingle();
    if (v) {
      patch.vendor_id = req.body.vendor_id;
      patch.vendor_name = v.vendor_name;
      patch.vendor_phone = v.phone;
    }
  }

  if (!Object.keys(patch).length) return sendError(res, 400, "Nothing to update");

  const { data, error } = await supa.from("orders").update(patch).eq("id", req.params.id).select().single();
  if (error) return sendError(res, 500, error.message);
  sendSuccess(res, { order: data });
});

app.get("/api/gm/bookings", requireHotel, requireSupabase, async (req, res) => {
  const { data, error } = await supa.from("bookings").select("*")
    .eq("hotel_id", req.user.hotel_id)
    .order("scheduled_for", { ascending: true }).limit(300);
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { bookings: data || [] });
});

app.patch("/api/gm/bookings/:id", requireHotel, requireSupabase, async (req, res) => {
  const { data: existing } = await supa.from("bookings")
    .select("hotel_id,status").eq("id", req.params.id).maybeSingle();
  if (!existing) return sendError(res, 404, "Not found");
  if (existing.hotel_id !== req.user.hotel_id) return sendError(res, 403, "Not yours");

  const next = String(req.body.status || "").toLowerCase();
  if (!["confirmed", "declined", "completed", "cancelled"].includes(next))
    return sendError(res, 400, "Invalid status");

  const patch = { status: next, updated_at: new Date().toISOString() };
  if (req.body.vendor_note !== undefined) patch.vendor_note = cleanText(req.body.vendor_note, 300);

  const { data, error } = await supa.from("bookings").update(patch).eq("id", req.params.id).select().single();
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { booking: data });
});

// ============================================================
// VENDOR endpoints
// ============================================================
app.get("/api/vendor/me", requireVendor, requireSupabase, async (req, res) => {
  const { data } = await supa.from("vendors").select("*").eq("id", req.user.vendor_id).maybeSingle();
  if (!data) return sendError(res, 404, "Vendor not found");
  delete data.password_hash;
  return sendSuccess(res, { vendor: data });
});

app.get("/api/vendor/orders", requireVendor, requireSupabase, async (req, res) => {
  const vid = req.user.vendor_id;
  const { data: links } = await supa.from("vendor_hotels")
    .select("hotel_id").eq("vendor_id", vid).eq("is_active", true);
  const hotelIds = (links || []).map(l => l.hotel_id);

  const { data: linksAll } = await supa.from("vendor_hotels")
    .select("hotel_id").eq("vendor_id", vid);
  const allHotelIds = (linksAll || []).map(l => l.hotel_id);
  const scopeIds = hotelIds.length ? hotelIds : allHotelIds;

  if (!scopeIds.length) return sendSuccess(res, { orders: [] });

  const { data: myServices } = await supa.from("hotel_services")
    .select("category").eq("vendor_id", vid);
  const categories = [...new Set(
    (myServices || []).map(s => String(s.category || "").toLowerCase()).filter(Boolean)
  )];

  const { data } = await supa.from("orders").select("*")
    .in("hotel_id", scopeIds)
    .or(`vendor_id.eq.${vid},vendor_id.is.null`)
    .order("created_at", { ascending: false }).limit(200);

  const filtered = (data || []).filter(o => {
    if (o.vendor_id && String(o.vendor_id) === String(vid)) return true;
    if (!o.vendor_id) {
      if (!categories.length) return false;
      const cat = String(o.category || "").toLowerCase();
      return categories.includes(cat);
    }
    return false;
  });

  return sendSuccess(res, { orders: filtered });
});

app.patch("/api/vendor/orders/:id", requireVendor, requireSupabase, async (req, res) => {
  try {
    const vid = req.user.vendor_id;
    const status = normalizeStatusKey(req.body.status);
    if (!["accepted", "on_the_way", "completed", "cancelled"].includes(status))
      return sendError(res, 400, "Invalid status");

    const { data: order } = await supa.from("orders")
      .select("id, status, vendor_id, hotel_id, reference, amount, guest_session_id, service_title")
      .eq("id", req.params.id).maybeSingle();
    if (!order) return sendError(res, 404, "Order not found");

    if (order.vendor_id && String(order.vendor_id) !== String(vid))
      return sendError(res, 403, "This order belongs to another vendor");

    const current = normalizeStatusKey(order.status);
    if (status !== current) {
      const allowed = VALID_TRANSITIONS[current] || [];
      if (!allowed.includes(status)) return sendError(res, 400, `Cannot transition ${current} → ${status}`);
    }

    const { data: v } = await supa.from("vendors")
      .select("vendor_name,phone").eq("id", vid).maybeSingle();

    const now = new Date().toISOString();
    const patch = {
      status,
      vendor_id: vid,
      vendor_name: v?.vendor_name || null,
      vendor_phone: v?.phone || null,
      updated_at: now
    };
    if (status === "accepted")   patch.accepted_at   = now;
    if (status === "on_the_way") patch.on_the_way_at = now;
    if (status === "completed")  patch.completed_at  = now;
    if (status === "cancelled")  patch.cancelled_at  = now;

    let { data, error } = await supa.from("orders").update(patch).eq("id", req.params.id).select().single();
    if (error && isMissingColumnError(error)) {
      const r2 = await supa.from("orders").update({
        status, vendor_id: vid,
        vendor_name: v?.vendor_name || null,
        vendor_phone: v?.phone || null
      }).eq("id", req.params.id).select().single();
      data = r2.data; error = r2.error;
    }
    if (error) return sendError(res, 500, error.message);

    if (status === "completed" && data && Number(data.amount) > 0) {
      try {
        await supa.from("commission_ledger").insert([{
          hotel_id: data.hotel_id,
          vendor_id: vid,
          order_id: data.id,
          gross_amount: Number(data.amount) || 0,
          commission: Math.floor((Number(data.amount) || 0) * 0.15),
          status: "owed"
        }]);
      } catch (e) { console.warn("⚠️ commission insert (order):", e.message); }
    }

    // Push to guest (FIX #1)
    pushOrderUpdate(data).catch(() => {});

    return sendSuccess(res, { order: data });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.get("/api/vendor/hotels", requireVendor, requireSupabase, async (req, res) => {
  const { data } = await supa.from("vendor_hotels")
    .select("hotel_id, is_active").eq("vendor_id", req.user.vendor_id);
  sendSuccess(res, { hotels: data || [] });
});

app.patch("/api/vendor/availability", requireVendor, requireSupabase, async (req, res) => {
  const isAvailable = !!req.body.available;
  let { data, error } = await supa.from("vendors")
    .update({ is_available: isAvailable })
    .eq("id", req.user.vendor_id).select().single();

  if (error) {
    if (isMissingColumnError(error))
      return sendError(res, 501, "Server not migrated. Run SCHEMA.sql (column: is_available).");
    return sendError(res, 500, error.message);
  }
  return sendSuccess(res, { available: !!data.is_available });
});

app.get("/api/vendor/availability", requireVendor, requireSupabase, async (req, res) => {
  const { data, error } = await supa.from("vendor_availability")
    .select("*").eq("vendor_id", req.user.vendor_id).order("dow");
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { slots: data || [] });
});

app.put("/api/vendor/availability", requireVendor, requireSupabase, async (req, res) => {
  try {
    const slots = Array.isArray(req.body.slots) ? req.body.slots : [];
    if (slots.length > 40) return sendError(res, 400, "Too many slots (max 40)");

    for (const s of slots) {
      const dow = Number(s.dow);
      if (!(dow >= 0 && dow <= 6)) return sendError(res, 400, "Invalid dow");
      if (!/^\d{1,2}:\d{2}/.test(String(s.open_time)))  return sendError(res, 400, "Invalid open_time");
      if (!/^\d{1,2}:\d{2}/.test(String(s.close_time))) return sendError(res, 400, "Invalid close_time");
    }

    await supa.from("vendor_availability").delete().eq("vendor_id", req.user.vendor_id);

    if (slots.length) {
      const rows = slots.map(s => ({
        vendor_id: req.user.vendor_id,
        dow: Number(s.dow),
        open_time: s.open_time,
        close_time: s.close_time,
        slot_minutes: Math.max(15, Math.min(480, Number(s.slot_minutes) || 60))
      }));
      const { error } = await supa.from("vendor_availability").insert(rows);
      if (error) return sendError(res, 500, error.message);
    }

    return sendSuccess(res, { saved: slots.length });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.post("/api/vendor/blackouts", requireVendor, requireSupabase, async (req, res) => {
  const { starts_at, ends_at, reason } = req.body;
  if (!starts_at || !ends_at) return sendError(res, 400, "starts_at and ends_at required");
  const s = new Date(starts_at), e = new Date(ends_at);
  if (isNaN(s) || isNaN(e) || e <= s) return sendError(res, 400, "Invalid date range");

  const { data, error } = await supa.from("vendor_blackouts").insert([{
    vendor_id: req.user.vendor_id,
    starts_at: s.toISOString(),
    ends_at: e.toISOString(),
    reason: cleanText(reason, 200)
  }]).select().single();
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { blackout: data });
});

app.delete("/api/vendor/blackouts/:id", requireVendor, requireSupabase, async (req, res) => {
  const { error } = await supa.from("vendor_blackouts")
    .delete().eq("id", req.params.id).eq("vendor_id", req.user.vendor_id);
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res);
});

app.patch("/api/vendor/services", requireVendor, requireSupabase, async (req, res) => {
  const patch = {};
  if (Array.isArray(req.body.services))
    patch.services = req.body.services.filter(s => typeof s === "string" && s.length < 60).slice(0, 50);
  if (req.body.price !== undefined)   patch.price = safeNumber(req.body.price, 0);
  if (req.body.bio !== undefined)     patch.bio = cleanText(req.body.bio, 300);
  if (req.body.category !== undefined) patch.category = cleanText(req.body.category, 40);
  // FIX #12 — vendor hours + gallery + cancellation policy
  if (req.body.hours_open !== undefined)  patch.hours_open  = cleanText(req.body.hours_open, 10) || null;
  if (req.body.hours_close !== undefined) patch.hours_close = cleanText(req.body.hours_close, 10) || null;
  if (Array.isArray(req.body.hours_closed_dow)) patch.hours_closed_dow = req.body.hours_closed_dow.filter(n => n >= 0 && n <= 6);
  if (Array.isArray(req.body.gallery)) patch.gallery = req.body.gallery.filter(u => typeof u === "string").slice(0, 12);
  if (req.body.logo_url !== undefined) patch.logo_url = cleanText(req.body.logo_url, 500) || null;
  if (req.body.cancellation_policy !== undefined) patch.cancellation_policy = cleanText(req.body.cancellation_policy, 300) || null;

  if (!Object.keys(patch).length) return sendError(res, 400, "Nothing to update");

  let { data, error } = await supa.from("vendors")
    .update(patch).eq("id", req.user.vendor_id).select().single();
  if (error && isMissingColumnError(error)) {
    // Retry with base fields only
    const base = {};
    ["services", "price", "bio", "category"].forEach(k => { if (patch[k] !== undefined) base[k] = patch[k]; });
    const r2 = await supa.from("vendors").update(base).eq("id", req.user.vendor_id).select().single();
    data = r2.data; error = r2.error;
  }
  if (error) return sendError(res, 500, error.message);
  delete data.password_hash;
  return sendSuccess(res, { vendor: data });
});

app.get("/api/vendor/payment", requireVendor, requireSupabase, async (req, res) => {
  const { data, error } = await supa.from("vendors")
    .select("payment_channel, paybill_number, paybill_account, till_number, mpesa, mpesa_name")
    .eq("id", req.user.vendor_id).maybeSingle();
  if (error && isMissingColumnError(error))
    return sendError(res, 501, "Payment columns missing. Run SCHEMA.sql.");
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { payment: data || {} });
});

app.patch("/api/vendor/payment", requireVendor, requireSupabase, async (req, res) => {
  const check = validatePayment(req.body);
  if (check.error) return sendError(res, 400, check.error);

  if (req.body.mpesa_name !== undefined) {
    check.patch.mpesa_name = cleanText(req.body.mpesa_name, 100);
  }

  let { data, error } = await supa.from("vendors")
    .update(check.patch).eq("id", req.user.vendor_id).select().single();

  if (error && isMissingColumnError(error))
    return sendError(res, 501, "Payment columns missing. Run SCHEMA.sql.");
  if (error) return sendError(res, 500, error.message);
  delete data.password_hash;
  return sendSuccess(res, { vendor: data });
});

app.get("/api/public/vendor/:vendorId/payment", requireSupabase, async (req, res) => {
  const vid = req.params.vendorId;
  if (!isValidId(vid)) return sendError(res, 400, "Invalid vendor");
  const { data } = await supa.from("vendors")
    .select("vendor_name, payment_channel, paybill_number, paybill_account, till_number, mpesa, mpesa_name")
    .eq("id", vid).maybeSingle();
  if (!data) return sendError(res, 404, "Vendor not found");
  return sendSuccess(res, { payment: data });
});

app.get("/api/public/vendor/:vendorId", requireSupabase, async (req, res) => {
  const vid = req.params.vendorId;
  if (!isValidId(vid)) return sendError(res, 400, "Invalid vendor");
  const { data } = await supa.from("vendors")
    .select("id,vendor_name,bio,category,group_label,phone,city,hub_location,price,services,vehicle,rating_avg,rating_count,is_available,payment_channel,paybill_number,paybill_account,till_number,mpesa,mpesa_name,status,hours_open,hours_close,hours_closed_dow,gallery,logo_url,cancellation_policy")
    .eq("id", vid).maybeSingle();
  if (!data) return sendError(res, 404, "Vendor not found");
  if (String(data.status).toLowerCase() !== "approved")
    return sendError(res, 403, "Vendor not available");
  return sendSuccess(res, { vendor: data });
});

app.get("/api/public/vendor/:vendorId/slots", requireSupabase, async (req, res) => {
  const vid = req.params.vendorId;
  if (!isValidId(vid)) return sendError(res, 400, "Invalid vendor");

  const date = String(req.query.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendError(res, 400, "date=YYYY-MM-DD required");

  const dayStart = new Date(date + "T00:00:00Z");
  const dayEnd   = new Date(date + "T23:59:59Z");
  const dow = dayStart.getUTCDay();

  const { data: avail } = await supa.from("vendor_availability")
    .select("*").eq("vendor_id", vid).eq("dow", dow);

  if (!avail || !avail.length) return sendSuccess(res, { slots: [], dow });

  const { data: existing } = await supa.from("bookings")
    .select("scheduled_for,duration_min,status")
    .eq("vendor_id", vid)
    .gte("scheduled_for", dayStart.toISOString())
    .lte("scheduled_for", dayEnd.toISOString())
    .in("status", ["requested", "confirmed"]);

  const { data: blackouts } = await supa.from("vendor_blackouts")
    .select("starts_at,ends_at").eq("vendor_id", vid)
    .lte("starts_at", dayEnd.toISOString())
    .gte("ends_at", dayStart.toISOString());

  const bookedRanges = (existing || []).map(b => {
    const start = new Date(b.scheduled_for).getTime();
    const end = start + (Number(b.duration_min) || 60) * 60000;
    return [start, end];
  });
  const blackRanges = (blackouts || []).map(b => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()]);

  const slots = [];
  const now = Date.now();

  avail.forEach(a => {
    const [oh, om] = String(a.open_time).split(":").map(Number);
    const [ch, cm] = String(a.close_time).split(":").map(Number);
    const step = Math.max(15, Number(a.slot_minutes) || 60);

    let cur = Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate(), oh, om);
    const end = Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate(), ch, cm);

    while (cur + step * 60000 <= end) {
      const slotEnd = cur + step * 60000;
      if (cur < now) { cur = slotEnd; continue; }

      const overlapBooked = bookedRanges.some(([s, e]) => cur < e && slotEnd > s);
      const overlapBlack  = blackRanges.some(([s, e]) => cur < e && slotEnd > s);

      if (!overlapBooked && !overlapBlack) {
        slots.push({ start: new Date(cur).toISOString(), end: new Date(slotEnd).toISOString() });
      }
      cur = slotEnd;
    }
  });

  return sendSuccess(res, { slots, dow });
});

// ============================================================
// GUEST SESSIONS
// ============================================================
app.post("/api/guest/session", orderLimiter, requireSupabase, async (req, res) => {
  try {
    const { hotel_id, guest_name, guest_phone, mode, number, language } = req.body;
    if (!hotel_id) return sendError(res, 400, "hotel_id required");

    const isTable = String(mode || "room").toLowerCase() === "table";
    const loc = cleanText(number, 30);
    if (!loc) return sendError(res, 400, "room/table number required");

    const payload = {
      hotel_id: String(hotel_id).toUpperCase(),
      guest_name: cleanText(guest_name, 100),
      guest_phone: cleanPhone(guest_phone),
      room_number: isTable ? null : loc,
      table_number: isTable ? loc : null,
      mode: isTable ? "table" : "room",
      language: cleanText(language || "en", 5),
      last_seen_at: new Date().toISOString()
    };

    if (payload.guest_phone) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: existing } = await supa.from("guest_sessions")
        .select("*").eq("hotel_id", payload.hotel_id)
        .eq("guest_phone", payload.guest_phone)
        .gte("last_seen_at", since).order("last_seen_at", { ascending: false })
        .limit(1).maybeSingle();

      if (existing) {
        const { data: updated } = await supa.from("guest_sessions")
          .update(payload).eq("id", existing.id).select().single();
        const token = createToken({ role: "guest", sid: updated.id, hid: payload.hotel_id }, "30d");
        return sendSuccess(res, { session: updated, token });
      }
    }

    const { data, error } = await supa.from("guest_sessions").insert([payload]).select().single();
    if (error) return sendError(res, 500, error.message);

    const token = createToken({ role: "guest", sid: data.id, hid: payload.hotel_id }, "30d");
    return sendSuccess(res, { session: data, token });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.get("/api/guest/me", requireSupabase, async (req, res) => {
  const t = verifyToken(req);
  if (!t || t.role !== "guest") return sendError(res, 401, "Guest session required");
  const { data } = await supa.from("guest_sessions").select("*").eq("id", t.sid).maybeSingle();
  if (!data) return sendError(res, 404, "Session not found");
  return sendSuccess(res, { session: data });
});

// ============================================================
// FIX #1 — Web Push subscription endpoints
// ============================================================
app.post("/api/guest/push-subscribe", requireSupabase, async (req, res) => {
  try {
    const t = verifyToken(req);
    if (!t || t.role !== "guest") return sendError(res, 401, "Guest session required");

    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth)
      return sendError(res, 400, "endpoint, keys.p256dh, keys.auth required");

    const { data, error } = await supa.from("guest_push_subscriptions").upsert({
      guest_session_id: t.sid,
      hotel_id: t.hid,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: cleanText(req.headers["user-agent"], 200),
      last_used_at: new Date().toISOString()
    }, { onConflict: "guest_session_id,endpoint" }).select().single();

    if (error) return sendError(res, 500, error.message);
    return sendSuccess(res, { subscription: { id: data.id } });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.delete("/api/guest/push-subscribe", requireSupabase, async (req, res) => {
  const t = verifyToken(req);
  if (!t || t.role !== "guest") return sendError(res, 401, "Guest session required");
  await supa.from("guest_push_subscriptions")
    .delete().eq("guest_session_id", t.sid).eq("endpoint", req.body?.endpoint || "");
  return sendSuccess(res);
});

app.get("/api/guest/vapid-public", (req, res) => {
  if (!PUSH_ENABLED) return sendError(res, 503, "Push not configured");
  return sendSuccess(res, { key: VAPID_PUBLIC });
});

// ============================================================
// FIX #1 — Service Worker (served from root)
// ============================================================
app.get("/sw.js", (req, res) => {
  res.type("application/javascript");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Service-Worker-Allowed", "/");
  res.send(`
/* GuestHub Service Worker — push notifications */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'GuestHub';
  const options = {
    body: data.body || '',
    tag: data.tag || 'guesthub',
    renotify: true,
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin)) return c.focus().then(() => c.navigate(url));
      }
      return clients.openWindow(url);
    })
  );
});
`);
});

// ============================================================
// BOOTSTRAP — one call for the guest app (FIX #3, #6, #12, #13)
// ============================================================
app.get("/api/public/hotel/:hotelId/bootstrap", requireSupabase, async (req, res) => {
  try {
    const hid = String(req.params.hotelId || "").toUpperCase();
    if (!hid) return sendError(res, 400, "hotelId required");

    // Try full select first; fall back if kitchen columns missing
    let hotel = null;
    {
      const r = await supa.from("hotels")
        .select("hotel_id,name,hotel_name,tagline,currency,service_charge,promo_title,promo_text,image_url,images,payment_channel,paybill_number,paybill_account,till_number,mpesa_name,phone,status,kitchen_busy,busy_message,busy_until")
        .ilike("hotel_id", hid).maybeSingle();
      if (r.error && isMissingColumnError(r.error)) {
        const r2 = await supa.from("hotels")
          .select("hotel_id,name,hotel_name,tagline,currency,service_charge,promo_title,promo_text,image_url,images,payment_channel,paybill_number,paybill_account,till_number,mpesa_name,phone,status")
          .ilike("hotel_id", hid).maybeSingle();
        hotel = r2.data;
      } else hotel = r.data;
    }

    if (!hotel) return sendError(res, 404, "Hotel not found");
    if (String(hotel.status || "").toUpperCase() !== "APPROVED")
      return sendError(res, 403, "Hotel not available");

    const [services, depts] = await Promise.all([
      supa.from("hotel_services").select("*").eq("hotel_id", hid).eq("is_active", true),
      supa.from("departments").select("name,whatsapp").eq("hotel_id", hid)
    ]);

    const rows = services.data || [];
    const food         = rows.filter(r => r.kind === "food" || (!r.kind && !r.vendor_id));
    const hotelService = rows.filter(r => r.kind === "hotel_service");
    const vendorItems  = rows.filter(r => r.kind === "vendor_item" || r.vendor_id);

    // Group vendor items
    const vendorMap = new Map();
    vendorItems.forEach(r => {
      if (!r.vendor_id) return;
      if (!vendorMap.has(r.vendor_id)) {
        vendorMap.set(r.vendor_id, {
          id: r.vendor_id,
          name: r.vendor_name || r.title,
          phone: r.vendor_phone,
          group: r.group_label || "services",
          items: []
        });
      }
      vendorMap.get(r.vendor_id).items.push({
        id: r.id,
        name: r.title,
        desc: r.description,
        price: Number(r.price) || 0,
        icon: r.icon || "🏪",
        image_url: r.image_url || null
      });
    });

    // Enrich vendors with payment + rating + hours + gallery
    const vendorList = [];
    for (const v of vendorMap.values()) {
      let vRow = null;
      {
        const r = await supa.from("vendors")
          .select("payment_channel,paybill_number,paybill_account,till_number,mpesa,mpesa_name,rating_avg,rating_count,bio,is_available,hours_open,hours_close,hours_closed_dow,gallery,logo_url,cancellation_policy")
          .eq("id", v.id).maybeSingle();
        if (r.error && isMissingColumnError(r.error)) {
          const r2 = await supa.from("vendors")
            .select("payment_channel,paybill_number,paybill_account,till_number,mpesa,mpesa_name,rating_avg,rating_count,bio,is_available")
            .eq("id", v.id).maybeSingle();
          vRow = r2.data;
        } else vRow = r.data;
      }

      vendorList.push({
        ...v,
        bio: vRow?.bio || "",
        rating: Number(vRow?.rating_avg) || 0,
        rating_count: Number(vRow?.rating_count) || 0,
        available: vRow?.is_available !== false,
        hours: vRow ? {
          open: vRow.hours_open || null,
          close: vRow.hours_close || null,
          closedDow: vRow.hours_closed_dow || []
        } : null,
        gallery: Array.isArray(vRow?.gallery) ? vRow.gallery : [],
        logo_url: vRow?.logo_url || null,
        cancellation_policy: vRow?.cancellation_policy || null,
        payment: {
          channel: vRow?.payment_channel || null,
          paybill_number: vRow?.paybill_number || null,
          paybill_account: vRow?.paybill_account || null,
          till_number: vRow?.till_number || null,
          mpesa_phone: vRow?.mpesa || null,
          mpesa_name: vRow?.mpesa_name || v.name,
          configured: !!(vRow?.paybill_number || vRow?.till_number || vRow?.mpesa)
        }
      });
    }

    return sendSuccess(res, {
      hotel: {
        hotel_id: hotel.hotel_id,
        name: hotel.name || hotel.hotel_name || hid,
        tagline: hotel.tagline || "",
        currency: hotel.currency || "Ksh",
        service_charge: Number(hotel.service_charge) || 0,
        promo_title: hotel.promo_title || "",
        promo_text: hotel.promo_text || "",
        image_url: hotel.image_url || (Array.isArray(hotel.images) && hotel.images[0]) || null,
        phone: hotel.phone || null,
        kitchen_busy: !!hotel.kitchen_busy,
        busy_message: hotel.busy_message || null,
        busy_until: hotel.busy_until || null,
        payment: {
          channel: hotel.payment_channel || "paybill",
          paybill_number: hotel.paybill_number || null,
          paybill_account: hotel.paybill_account || null,
          till_number: hotel.till_number || null,
          mpesa_name: hotel.mpesa_name || null,
          configured: !!(hotel.paybill_number || hotel.till_number)
        }
      },
      menu: food.map(r => ({
        id: r.id,
        name: r.title,
        desc: r.description,
        price: Number(r.price) || 0,
        icon: r.icon || "🍽️",
        image_url: r.image_url || null,
        category: r.category || "Menu",
        tags: Array.isArray(r.tags) ? r.tags : [],
        dietary_tags: Array.isArray(r.dietary_tags) ? r.dietary_tags : [],
        available: r.available !== false && r.is_active !== false,
        sold_today: Number(r.sold_today) || 0,
        rating: Number(r.rating_avg) || 0,
        rating_count: Number(r.rating_count) || 0
      })),
      services: hotelService.map(r => ({
        id: r.id,
        name: r.title,
        desc: r.description,
        price: Number(r.price) || 0,
        icon: r.icon || "🛎️",
        image_url: r.image_url || null,
        category: r.category || "service"
      })),
      vendors: vendorList,
      departments: depts.data || []
    });
  } catch (e) { return sendError(res, 500, e.message); }
});

// ============================================================
// PUBLIC HOTEL LEGACY ENDPOINTS
// ============================================================
app.get("/api/public/hotel/:hotelId/services", requireSupabase, async (req, res) => {
  const hid = String(req.params.hotelId || "").toUpperCase();
  const { data } = await supa.from("hotel_services").select("*")
    .eq("hotel_id", hid).eq("is_active", true)
    .order("created_at", { ascending: false }).limit(200);
  const { data: depts } = await supa.from("departments").select("name, whatsapp").eq("hotel_id", hid);
  res.json({ services: data || [], departments: depts || [] });
});

app.get("/api/public/hotel/:hotelId/menu", requireSupabase, async (req, res) => {
  try {
    const hid = String(req.params.hotelId || "").toUpperCase();
    const { data, error } = await supa.from("hotel_services").select("*")
      .eq("hotel_id", hid).eq("is_active", true)
      .order("created_at", { ascending: true }).limit(500);
    if (error) return sendError(res, 500, error.message);

    const foodServices = (data || []).filter(s => s.kind === "food" || (!s.kind && !s.vendor_id));

    const catMap = new Map();
    const items = foodServices.map(s => {
      const rawCat = String(s.category || "Menu").trim();
      const catKey = rawCat.toLowerCase() || "menu";
      if (!catMap.has(catKey)) {
        catMap.set(catKey, {
          id: catKey.replace(/\s+/g, "_"),
          name: rawCat || "Menu",
          emoji: s.icon || "🍽️",
          order: catMap.size + 1
        });
      }
      return {
        id: s.id,
        cat: catKey.replace(/\s+/g, "_"),
        name: s.title || "Item",
        desc: s.description || "",
        price: Number(s.price) || 0,
        emoji: s.icon || "🍽️",
        image_url: s.image_url || null,
        tags: Array.isArray(s.tags) ? s.tags : [],
        dietary_tags: Array.isArray(s.dietary_tags) ? s.dietary_tags : [],
        available: s.available !== false && s.is_active !== false,
        sold_today: Number(s.sold_today) || 0,
        vendor_id: s.vendor_id || null,
        vendor_name: s.vendor_name || null
      };
    });

    return sendSuccess(res, {
      menu: { categories: [...catMap.values()], items }
    });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.get("/api/public/hotel/:hotelId/settings", requireSupabase, async (req, res) => {
  const hid = String(req.params.hotelId || "").toUpperCase();
  const { data } = await supa.from("hotels")
    .select("name, hotel_name, tagline, currency, service_charge, promo_title, promo_text")
    .ilike("hotel_id", hid).maybeSingle();
  if (!data) return sendError(res, 404, "Hotel not found");
  return sendSuccess(res, {
    settings: {
      hotelName: data.name || data.hotel_name || hid,
      tagline: data.tagline || "",
      currency: data.currency || "Ksh",
      serviceCharge: Number(data.service_charge) || 0,
      promoTitle: data.promo_title || "",
      promoText: data.promo_text || ""
    }
  });
});

// ============================================================
// ORDER CREATION (FIX #2 — sets cancel window)
// ============================================================
app.post("/api/orders", orderLimiter, requireSupabase, async (req, res) => {
  try {
    const {
      hotel_id, mode,
      room_number, table_number,
      guest_name, guest_phone,
      service_id, service_title,
      category, details, amount, department, kind,
      items, subtotal, service_charge, total,
      guest_session_id
    } = req.body;

    if (!hotel_id) return sendError(res, 400, "hotel_id required");
    if (!guest_name) return sendError(res, 400, "Guest name required");
    if (!guest_phone) return sendError(res, 400, "Phone required");
    if (!service_title) return sendError(res, 400, "Service required");

    const isTable = String(mode || "").toLowerCase() === "table";
    const locValue = isTable
      ? cleanText(table_number || room_number, 30)
      : cleanText(room_number || table_number, 30);

    if (!locValue)
      return sendError(res, 400, isTable ? "Table number required" : "Room number required");

    const hid = String(hotel_id).toUpperCase();
    const ref = makeRef();

    const basePayload = {
      reference: ref,
      hotel_id: hid,
      room_number: isTable ? null : locValue,
      guest_name: cleanText(guest_name, 100),
      guest_phone: cleanPhone(guest_phone),
      service_id: cleanText(service_id, 60),
      service_title: cleanText(service_title, 120),
      category: cleanText(category || "food", 30),
      details: cleanText(details, 300),
      amount: safeNumber(amount, 0),
      department: cleanText(department || "services", 30),
      status: "pending"
    };

    const extendedPayload = { ...basePayload };

    if (isTable) {
      extendedPayload.mode = "table";
      extendedPayload.table_number = locValue;
    } else {
      extendedPayload.mode = "room";
    }

    if (guest_session_id && isUUID(guest_session_id)) {
      extendedPayload.guest_session_id = guest_session_id;
    }

    const finalKind = ["food", "hotel_service", "vendor_item"].includes(String(kind || "").toLowerCase())
      ? String(kind).toLowerCase()
      : "food";
    extendedPayload.kind = finalKind;

    if (Array.isArray(items) && items.length) {
      extendedPayload.items = items.map(i => ({
        id: cleanText(i.id, 60),
        name: cleanText(i.name, 120),
        price: safeNumber(i.price, 0),
        qty: Math.max(1, safeNumber(i.qty, 1)),
        notes: cleanText(i.notes, 200)
      }));
    }
    if (subtotal !== undefined)       extendedPayload.subtotal       = safeNumber(subtotal, 0);
    if (service_charge !== undefined) extendedPayload.service_charge = safeNumber(service_charge, 0);
    if (total !== undefined)          extendedPayload.total          = safeNumber(total, 0);

    // Set cancel window (FIX #2)
    extendedPayload.cancel_window_ends_at = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    let { data, error } = await supa.from("orders").insert([extendedPayload]).select().single();
    if (error && isMissingColumnError(error)) {
      console.warn("⚠️ orders extended insert failed, retrying base:", error.message);
      const retry = await supa.from("orders").insert([basePayload]).select().single();
      data = retry.data; error = retry.error;
    }

    if (error) return sendError(res, 500, error.message);
    return sendSuccess(res, { order: data });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.get("/api/orders/:id", requireSupabase, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return sendError(res, 400, "Order id required");

  let query = supa.from("orders").select("*");
  if (isUUID(id)) query = query.or(`id.eq.${id},reference.eq.${id}`);
  else query = query.eq("reference", id);

  const { data, error } = await query.maybeSingle();
  if (error) return sendError(res, 500, error.message);
  if (!data) return sendError(res, 404, "Order not found");
  return sendSuccess(res, { order: data });
});

// ============================================================
// FIX #2 — Guest cancels own order (2-min window)
// ============================================================
app.post("/api/orders/:id/cancel", orderLimiter, requireSupabase, async (req, res) => {
  try {
    const t = verifyToken(req);
    if (!t || t.role !== "guest") return sendError(res, 401, "Guest session required");

    const { data: order } = await supa.from("orders")
      .select("id, status, guest_session_id, created_at, cancel_window_ends_at, reference, hotel_id, service_title")
      .eq("id", req.params.id).maybeSingle();
    if (!order) return sendError(res, 404, "Order not found");
    if (String(order.guest_session_id) !== String(t.sid))
      return sendError(res, 403, "Not your order");

    const status = String(order.status || "").toLowerCase();
    if (!["pending", "new", "accepted"].includes(status))
      return sendError(res, 400, "Cannot cancel — kitchen already started");

    const windowEnd = order.cancel_window_ends_at
      ? new Date(order.cancel_window_ends_at).getTime()
      : new Date(order.created_at).getTime() + 2 * 60 * 1000;

    if (Date.now() > windowEnd)
      return sendError(res, 400, "Cancellation window has expired. Please ask reception.");

    const now = new Date().toISOString();
    const { data, error } = await supa.from("orders").update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by: "guest",
      cancelled_reason: cleanText(req.body.reason, 200) || "Guest cancelled",
      updated_at: now
    }).eq("id", req.params.id).select().single();

    if (error && isMissingColumnError(error)) {
      // Fallback: just status
      const r2 = await supa.from("orders").update({ status: "cancelled" })
        .eq("id", req.params.id).select().single();
      if (r2.error) return sendError(res, 500, r2.error.message);
      return sendSuccess(res, { order: r2.data });
    }
    if (error) return sendError(res, 500, error.message);

    return sendSuccess(res, { order: data });
  } catch (e) { return sendError(res, 500, e.message); }
});

// ============================================================
// FIX #11 — Rate order + tip
// ============================================================
app.post("/api/orders/:id/rate", requireSupabase, async (req, res) => {
  try {
    const t = verifyToken(req);
    if (!t || t.role !== "guest") return sendError(res, 401, "Guest session required");

    const stars = safeNumber(req.body.stars ?? req.body.rating, 0);
    const tip   = Math.max(0, safeNumber(req.body.tip, 0));

    if (stars < 1 || stars > 5) return sendError(res, 400, "Rating must be 1–5");
    if (tip > 100000) return sendError(res, 400, "Tip too large");

    const { data: order } = await supa.from("orders")
      .select("id, status, guest_session_id, amount")
      .eq("id", req.params.id).maybeSingle();
    if (!order) return sendError(res, 404, "Order not found");
    if (String(order.guest_session_id) !== String(t.sid))
      return sendError(res, 403, "Not your order");
    if (String(order.status).toLowerCase() !== "completed")
      return sendError(res, 400, "Only completed orders can be rated");

    const now = new Date().toISOString();
    let { data, error } = await supa.from("orders").update({
      rating: stars,
      tip_amount: tip,
      rating_note: cleanText(req.body.note, 300) || null,
      rated_at: now,
      updated_at: now
    }).eq("id", req.params.id).select().single();

    if (error && isMissingColumnError(error)) {
      const r2 = await supa.from("orders")
        .update({ rating: stars, rated_at: now })
        .eq("id", req.params.id).select().single();
      data = r2.data; error = r2.error;
    }

    if (error) return sendError(res, 500, error.message);
    return sendSuccess(res, { order: data });
  } catch (e) { return sendError(res, 500, e.message); }
});

// Rate-plus alias (for older client)
app.post("/api/orders/:id/rate-plus", requireSupabase, async (req, res) => {
  // Forward to /rate
  req.url = `/api/orders/${req.params.id}/rate`;
  app._router.handle(req, res, () => {});
});

app.get("/api/orders/:hotelId/:room", requireSupabase, async (req, res) => {
  try {
    const hotelId = String(req.params.hotelId || "").toUpperCase();
    const raw = String(req.params.room || "").trim();
    if (!hotelId || !raw || raw.toLowerCase() === "rate")
      return sendError(res, 400, "hotelId and room required");

    let { data, error } = await supa.from("orders")
      .select("*")
      .eq("hotel_id", hotelId)
      .ilike("room_number", raw)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return sendError(res, 500, error.message);

    if (!data || !data.length) {
      const t = await supa.from("orders")
        .select("*")
        .eq("hotel_id", hotelId)
        .ilike("table_number", raw)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!t.error) data = t.data || [];
    }

    return sendSuccess(res, { orders: data || [] });
  } catch (e) { return sendError(res, 500, e.message); }
});

// Guest order history
app.get("/api/guest/orders", requireSupabase, async (req, res) => {
  const t = verifyToken(req);
  const sid = t?.role === "guest" ? t.sid : null;
  const phone = cleanPhone(req.query.phone || "");
  const hotel_id = String(req.query.hotel_id || "").toUpperCase();

  if (!sid && !(phone && hotel_id))
    return sendError(res, 400, "Guest token or phone+hotel_id required");

  let q = supa.from("orders").select("*").order("created_at", { ascending: false }).limit(50);
  q = sid ? q.eq("guest_session_id", sid) : q.eq("guest_phone", phone).eq("hotel_id", hotel_id);

  const { data, error } = await q;
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { orders: data || [] });
});

// ============================================================
// BOOKINGS
// ============================================================
app.post("/api/bookings", orderLimiter, requireSupabase, async (req, res) => {
  try {
    const {
      hotel_id, vendor_id, service_id, service_title,
      scheduled_for, duration_min, guests_count,
      guest_name, guest_phone, room_number, table_number,
      amount, notes, guest_session_id
    } = req.body;

    if (!hotel_id || !vendor_id || !service_title || !scheduled_for)
      return sendError(res, 400, "hotel_id, vendor_id, service_title, scheduled_for are required");

    const when = new Date(scheduled_for);
    if (isNaN(when.getTime())) return sendError(res, 400, "Invalid scheduled_for");
    if (when.getTime() < Date.now() - 60_000)
      return sendError(res, 400, "Scheduled time is in the past");

    const ref = makeBookingRef();

    const payload = {
      reference: ref,
      hotel_id: String(hotel_id).toUpperCase(),
      vendor_id,
      service_id: service_id || null,
      service_title: cleanText(service_title, 120),
      scheduled_for: when.toISOString(),
      duration_min: safeNumber(duration_min, 60),
      guests_count: Math.max(1, safeNumber(guests_count, 1)),
      guest_name: cleanText(guest_name, 100),
      guest_phone: cleanPhone(guest_phone),
      room_number: cleanText(room_number, 30) || null,
      table_number: cleanText(table_number, 30) || null,
      amount: safeNumber(amount, 0),
      notes: cleanText(notes, 500),
      status: "requested"
    };

    if (guest_session_id && isUUID(guest_session_id))
      payload.guest_session_id = guest_session_id;

    const { data, error } = await supa.from("bookings").insert([payload]).select().single();
    if (error) return sendError(res, 500, error.message);

    return sendSuccess(res, { booking: data });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.get("/api/bookings/guest", requireSupabase, async (req, res) => {
  const t = verifyToken(req);
  const sid = t?.role === "guest" ? t.sid : null;
  const phone = cleanPhone(req.query.phone || "");
  if (!sid && !phone) return sendError(res, 400, "Guest token or phone required");

  let q = supa.from("bookings").select("*").order("created_at", { ascending: false }).limit(50);
  q = sid ? q.eq("guest_session_id", sid) : q.eq("guest_phone", phone);
  const { data, error } = await q;
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { bookings: data || [] });
});

app.get("/api/bookings/vendor", requireVendor, requireSupabase, async (req, res) => {
  const { data, error } = await supa.from("bookings").select("*")
    .eq("vendor_id", req.user.vendor_id)
    .order("scheduled_for", { ascending: true }).limit(200);
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { bookings: data || [] });
});

app.get("/api/bookings/hotel", requireHotel, requireSupabase, async (req, res) => {
  const { data, error } = await supa.from("bookings").select("*")
    .eq("hotel_id", req.user.hotel_id)
    .order("scheduled_for", { ascending: true }).limit(200);
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { bookings: data || [] });
});

// FIX #1 — Push on booking status change
app.patch("/api/bookings/:id", requireSupabase, async (req, res) => {
  try {
    const t = verifyToken(req);
    if (!t) return sendError(res, 401, "Auth required");

    const { data: existing } = await supa.from("bookings")
      .select("*").eq("id", req.params.id).maybeSingle();
    if (!existing) return sendError(res, 404, "Booking not found");

    const isVendor = t.role === "vendor" && String(existing.vendor_id) === String(t.vendor_id);
    const isHotel  = t.role === "hotel"  && existing.hotel_id === t.hotel_id;
    const isGuest  = t.role === "guest"  && String(existing.guest_session_id) === String(t.sid);
    if (!isVendor && !isHotel && !isGuest) return sendError(res, 403, "Not yours");

    const next = String(req.body.status || "").toLowerCase();
    const allowed = isVendor
      ? ["confirmed", "declined", "completed", "cancelled"]
      : isHotel
      ? ["confirmed", "declined", "completed", "cancelled"]
      : ["cancelled"];
    if (next && !allowed.includes(next)) return sendError(res, 403, "Not allowed");

    const patch = { updated_at: new Date().toISOString() };
    if (next) patch.status = next;
    if (req.body.vendor_note !== undefined) patch.vendor_note = cleanText(req.body.vendor_note, 300);
    if (next === "confirmed") patch.confirmed_at = new Date().toISOString();
    if (next === "completed") patch.completed_at = new Date().toISOString();
    if (next === "cancelled") patch.cancelled_at = new Date().toISOString();

    const { data, error } = await supa.from("bookings").update(patch).eq("id", req.params.id).select().single();
    if (error) return sendError(res, 500, error.message);

    if (next === "completed" && data.amount > 0 && data.vendor_id) {
      try {
        await supa.from("commission_ledger").insert([{
          hotel_id: data.hotel_id,
          vendor_id: data.vendor_id,
          booking_id: data.id,
          gross_amount: Number(data.amount) || 0,
          commission: Math.floor((Number(data.amount) || 0) * 0.15),
          status: "owed"
        }]);
      } catch (e) { console.warn("⚠️ commission insert (booking):", e.message); }
    }

    // Push (FIX #1)
    pushBookingUpdate(data).catch(() => {});

    return sendSuccess(res, { booking: data });
  } catch (e) { return sendError(res, 500, e.message); }
});

// ============================================================
// GUEST SSE — real-time orders + bookings + kitchen (FIX #1, #13)
// ============================================================
app.get("/api/stream/guest/:token", requireSupabase, async (req, res) => {
  const token = String(req.params.token || "");
  let payload = null;
  try { payload = jwt.verify(token, JWT_SECRET); } catch { /* */ }
  if (!payload || payload.role !== "guest") return sendError(res, 401, "Invalid guest token");

  const sid = payload.sid;
  const hotelId = String(payload.hid || "").toUpperCase();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  // Register for kitchen broadcasts
  if (!guestStreamsByHotel.has(hotelId)) guestStreamsByHotel.set(hotelId, new Set());
  const entry = { send, sid };
  guestStreamsByHotel.get(hotelId).add(entry);

  send("hello", { sid, hotelId, ts: Date.now() });

  // Send current kitchen state
  try {
    const { data: h } = await supa.from("hotels")
      .select("kitchen_busy,busy_message,busy_until")
      .ilike("hotel_id", hotelId).maybeSingle();
    if (h) send("kitchen", { busy: !!h.kitchen_busy, message: h.busy_message, until: h.busy_until });
  } catch {}

  let lastOrdersHash = "";
  let lastBookingsHash = "";

  const tick = async () => {
    try {
      // Try extended columns first; fall back if missing
      let ordersList = [];
      let bookingsList = [];

      {
        const r = await supa.from("orders")
          .select("id,status,reference,amount,service_title,updated_at,created_at,mode,room_number,table_number,items,eta_minutes,assigned_to,cancel_window_ends_at")
          .eq("hotel_id", hotelId).eq("guest_session_id", sid)
          .order("created_at", { ascending: false }).limit(20);
        if (r.error && isMissingColumnError(r.error)) {
          const r2 = await supa.from("orders")
            .select("id,status,reference,amount,service_title,updated_at,created_at,mode,room_number,table_number,items")
            .eq("hotel_id", hotelId).eq("guest_session_id", sid)
            .order("created_at", { ascending: false }).limit(20);
          ordersList = r2.data || [];
        } else ordersList = r.data || [];
      }

      {
        const r = await supa.from("bookings")
          .select("id,status,reference,scheduled_for,service_title,updated_at,amount,duration_min,vendor_note")
          .eq("guest_session_id", sid)
          .order("created_at", { ascending: false }).limit(20);
        bookingsList = r.data || [];
      }

      const oHash = JSON.stringify(ordersList);
      const bHash = JSON.stringify(bookingsList);

      if (oHash !== lastOrdersHash) {
        lastOrdersHash = oHash;
        send("orders", ordersList);
      }
      if (bHash !== lastBookingsHash) {
        lastBookingsHash = bHash;
        send("bookings", bookingsList);
      }

      send("ping", { ts: Date.now() });
    } catch (e) {
      send("error", { message: e.message });
    }
  };

  tick();
  const timer = setInterval(tick, 4000);

  req.on("close", () => {
    clearInterval(timer);
    guestStreamsByHotel.get(hotelId)?.delete(entry);
    try { res.end(); } catch {}
  });
});

// ============================================================
// STATIC FRONTEND + SPA fallback
// ============================================================
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir, { maxAge: "1h", etag: true }));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/config.js")) {
    return res.status(404).json({ ok: false, error: "API route not found: " + req.path });
  }
  const filePath = path.join(publicDir, req.path);
  if (req.path.endsWith(".html")) {
    return res.sendFile(filePath, (err) => {
      if (err) res.sendFile(path.join(publicDir, "index.html"));
    });
  }
  const htmlMap = {
    "/admin": "admin.html",
    "/guest": "guest.html",
    "/hotel": "hotel-dashboard.html",
    "/vendor": "vendor-dashboard.html",
    "/vendor-login": "vendor-login.html",
    "/vendor-signup": "vendor-signup.html",
    "/hotel-login": "hotel-login.html",
    "/admin-login": "admin-login.html",
    "/": "index.html"
  };
  const mapped = htmlMap[req.path] || "index.html";
  res.sendFile(path.join(publicDir, mapped), (err) => {
    if (err) res.sendFile(path.join(publicDir, "index.html"));
  });
});

app.use((err, req, res, next) => {
  console.error("❌", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: "Server error" });
});

// ---------- Listen ----------
app.listen(PORT, "0.0.0.0", () => {
  console.log("============================================");
  console.log(`✅ GuestHub V2.1 Guest Love Edition on 0.0.0.0:${PORT}`);
  console.log(`📁 Serving from: ${path.join(__dirname, "public")}`);
  console.log(`🔑 Supabase: ${supa ? "CONNECTED" : "MISSING KEYS"}`);
  console.log(`🔔 Web Push: ${PUSH_ENABLED ? "ENABLED" : "DISABLED"}`);
  console.log(`📦 Storage bucket: ${BUCKET}`);
  if (missing.length) console.log(`⚠️  Missing env: ${missing.join(", ")}`);
  console.log("--------------------------------------------");
  console.log("💳 Direct-to-vendor payments enabled");
  console.log("🍽️  Table-mode ordering enabled");
  console.log("📸 Hotel image uploads (ownership-checked)");
  console.log("🏦 Hotel + vendor paybill/till endpoints");
  console.log("🎫 Guest sessions + bookings + SSE");
  console.log("💰 Commission ledger (15%)");
  console.log("📊 Admin commission endpoints");
  console.log("✨ NEW: Push notifications, ETA, kitchen state");
  console.log("✨ NEW: Cancel window, rate+tip, images, diet tags");
  console.log("============================================");
});

/* === CONTINUE IN PART 2 === */
