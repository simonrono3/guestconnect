// ============================================================
// GuestHub V1.2 — Direct-to-Vendor Payments
// Aligned with GM OS + Guest SuperApp + Vendor OS
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
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 10000;

// ---------- env check (WARN only — do NOT exit) ----------
const REQUIRED = ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_KEY", "JWT_SECRET", "ADMIN_PASSWORD"];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.warn("⚠️  Missing env vars:", missing.join(", "));
  console.warn("⚠️  Server will start, but API calls that need these will fail.");
}

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON = process.env.SUPABASE_KEY || "";
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "dev_only_change_me";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Only create client if we have valid keys
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

// ---------- CORS ----------
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

// ---------- Rate limits ----------
const loginLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true });
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true });
const orderLimiter  = rateLimit({ windowMs: 60 * 1000,      max: 30, standardHeaders: true });
app.use("/api/", rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true }));

// ---------- Health checks ----------
app.get("/healthz", (req, res) => res.status(200).send("ok"));
app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    os: "GuestHub V1.2",
    time: new Date().toISOString(),
    supabase: !!supa,
    missing_env: missing
  })
);

// ---------- Config served to browsers ----------
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

// ---------- Helpers ----------
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

function requireSupabase(req, res, next) {
  if (!supa) return sendError(res, 503, "Server not configured. Contact admin.");
  next();
}

// ---------- Order status model ----------
const ALLOWED_STATUSES = [
  "pending", "new", "accepted", "preparing", "on_the_way", "completed", "cancelled"
];
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

// ---------- Direct-payment model ----------
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
    if (!acc) return { error: "Paybill account number/name required" };
    patch.paybill_number = num;
    patch.paybill_account = acc;
    patch.till_number = null;
  } else if (channel === "till") {
    const till = String(body.till_number || "").replace(/\D/g, "");
    if (!/^\d{4,10}$/.test(till)) return { error: "Till number must be 4–10 digits" };
    patch.till_number = till;
    patch.paybill_number = null;
    patch.paybill_account = null;
  } else {
    const phone = cleanPhone(body.mpesa || body.phone);
    if (phone.length < 10) return { error: "Valid M-Pesa phone required" };
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
    const id = req.params.id;
    const { hotel } = await findHotel(id);
    if (!hotel) return sendError(res, 404, "Hotel not found: " + id);

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

// ============================================================
// HOTELS
// ============================================================
app.get("/api/data", requireSupabase, async (req, res) => {
  const { data } = await supa.from("hotels")
    .select("id,hotel_id,name,hotel_name,location,city,hotel_type,status")
    .eq("status", "APPROVED").limit(500);
  res.json({ hotels: data || [] });
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
// VENDOR SIGNUP (public) — includes payment setup
// ============================================================
app.post("/api/vendors/signup", signupLimiter, requireSupabase, async (req, res) => {
  try {
    const {
      full_name, vendor_name, email, password, phone,
      id_number, city, location, location_hub,
      category, services, price, bio,
      hotels, hotel_ids
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

    // ---- Validate payment setup ----
    const payCheck = validatePayment(req.body);
    if (payCheck.error) return sendError(res, 400, payCheck.error);

    const { data: existing } = await supa
      .from("vendors").select("id").eq("email", finalEmail).maybeSingle();
    if (existing) return sendError(res, 409, "Vendor already registered with this email");

    const hash = await bcrypt.hash(String(password), 12);
    const serviceList = Array.isArray(services) ? services : [];

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
      // Payment fields
      ...payCheck.patch
    };

    let { data: vendor, error } = await supa
      .from("vendors").insert([{ ...insertPayload, ...optional }]).select().single();

    if (error && /column|schema cache/i.test(error.message || "")) {
      console.warn("⚠️ Optional vendor columns missing, retrying minimal insert:", error.message);
      // Try again with only guaranteed columns + payment
      const retry = await supa.from("vendors").insert([{
        ...insertPayload,
        ...payCheck.patch
      }]).select().single();
      vendor = retry.data;
      error = retry.error;
    }

    if (error) {
      if (error.code === "23505") return sendError(res, 409, "Vendor already registered");
      return sendError(res, 500, error.message);
    }

    // ---- Link hotels ----
    const chosen = Array.isArray(hotels) && hotels.length ? hotels
                 : Array.isArray(hotel_ids) && hotel_ids.length ? hotel_ids
                 : [];

    let hotelIds = chosen.filter(h => isValidId(h) && h !== "ALL");
    if (chosen.includes("ALL")) {
      const { data: allHotels } = await supa.from("hotels")
        .select("hotel_id").eq("status", "APPROVED");
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

// ============================================================
// VENDOR LOGIN
// ============================================================
app.post("/api/vendors/login", loginLimiter, requireSupabase, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return sendError(res, 400, "Email and password required");

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
  const { title, description, price, category, icon } = req.body;
  if (!title) return sendError(res, 400, "Title required");
  const { data, error } = await supa.from("hotel_services").insert([{
    hotel_id: req.user.hotel_id,
    title: cleanText(title, 120),
    description: cleanText(description, 300),
    price: safeNumber(price, 0),
    category: cleanText(category || "food", 30),
    icon: cleanText(icon || "🍔", 8),
    is_active: true
  }]).select().single();
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
  const { data } = await supa.from("hotel_services").update(patch).eq("id", req.params.id).select().single();
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
    await supa.from("hotel_services").insert([{
      hotel_id: hid,
      title: `${v.vendor_name} — ${v.category || "service"}`,
      description: v.bio || "Available through GuestHub",
      price: safeNumber(v.price, 0),
      category: v.category || "services",
      icon: "🏪",
      vendor_id: vid,
      vendor_name: v.vendor_name,
      vendor_phone: v.phone,
      is_active: true
    }]);
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

app.patch("/api/gm/orders/:id/status", requireHotel, requireSupabase, async (req, res) => {
  try {
    const next = normalizeStatusKey(req.body.status);
    if (!ALLOWED_STATUSES.includes(next)) return sendError(res, 400, "Invalid status");

    const { data: existing } = await supa.from("orders")
      .select("hotel_id, status, reference")
      .eq("id", req.params.id).maybeSingle();
    if (!existing) return sendError(res, 404, "Order not found");
    if (existing.hotel_id !== req.user.hotel_id) return sendError(res, 403, "Not yours");

    const current = normalizeStatusKey(existing.status);
    if (next !== current) {
      const allowed = VALID_TRANSITIONS[current] || [];
      if (!allowed.includes(next)) {
        return sendError(res, 400, `Cannot transition ${current} → ${next}`);
      }
    }

    const now = new Date().toISOString();
    const patch = { status: next, updated_at: now };
    if (next === "accepted")   patch.accepted_at   = now;
    if (next === "on_the_way") patch.on_the_way_at = now;
    if (next === "completed")  patch.completed_at  = now;
    if (next === "cancelled")  patch.cancelled_at  = now;

    let { data, error } = await supa.from("orders").update(patch).eq("id", req.params.id).select().single();
    if (error && /column|schema cache/i.test(error.message || "")) {
      const r2 = await supa.from("orders").update({ status: next }).eq("id", req.params.id).select().single();
      data = r2.data; error = r2.error;
    }
    if (error) return sendError(res, 500, error.message);

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

// ============================================================
// VENDOR endpoints (authenticated)
// ============================================================
app.get("/api/vendor/me", requireVendor, requireSupabase, async (req, res) => {
  const { data } = await supa.from("vendors").select("*").eq("id", req.user.vendor_id).maybeSingle();
  if (!data) return sendError(res, 404, "Vendor not found");
  delete data.password_hash;
  return sendSuccess(res, { vendor: data });
});

// ---- Orders ----
app.get("/api/vendor/orders", requireVendor, requireSupabase, async (req, res) => {
  const vid = req.user.vendor_id;
  const { data: links } = await supa.from("vendor_hotels")
    .select("hotel_id").eq("vendor_id", vid).eq("is_active", true);
  const hotelIds = (links || []).map(l => l.hotel_id);

  // Also include hotels the vendor chose at signup (may be is_active=false until approved)
  const { data: linksAll } = await supa.from("vendor_hotels")
    .select("hotel_id").eq("vendor_id", vid);
  const allHotelIds = (linksAll || []).map(l => l.hotel_id);
  const scopeIds = hotelIds.length ? hotelIds : allHotelIds;

  if (!scopeIds.length) return sendSuccess(res, { orders: [] });

  const { data } = await supa.from("orders").select("*")
    .in("hotel_id", scopeIds)
    .or(`vendor_id.eq.${vid},vendor_id.is.null`)
    .order("created_at", { ascending: false }).limit(200);
  return sendSuccess(res, { orders: data || [] });
});

app.patch("/api/vendor/orders/:id", requireVendor, requireSupabase, async (req, res) => {
  try {
    const vid = req.user.vendor_id;
    const status = normalizeStatusKey(req.body.status);
    if (!["accepted", "on_the_way", "completed", "cancelled"].includes(status))
      return sendError(res, 400, "Invalid status");

    const { data: order } = await supa.from("orders")
      .select("id, status, vendor_id, hotel_id, reference")
      .eq("id", req.params.id).maybeSingle();
    if (!order) return sendError(res, 404, "Order not found");

    // Ownership gate
    if (order.vendor_id && String(order.vendor_id) !== String(vid))
      return sendError(res, 403, "This order belongs to another vendor");

    // Transition gate
    const current = normalizeStatusKey(order.status);
    if (status !== current) {
      const allowed = VALID_TRANSITIONS[current] || [];
      if (!allowed.includes(status)) {
        return sendError(res, 400, `Cannot transition ${current} → ${status}`);
      }
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

    let { data, error } = await supa.from("orders")
      .update(patch).eq("id", req.params.id).select().single();
    if (error && /column|schema cache/i.test(error.message || "")) {
      const r2 = await supa.from("orders").update({
        status, vendor_id: vid,
        vendor_name: v?.vendor_name || null,
        vendor_phone: v?.phone || null
      }).eq("id", req.params.id).select().single();
      data = r2.data; error = r2.error;
    }
    if (error) return sendError(res, 500, error.message);
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

// ---- Availability toggle ----
app.patch("/api/vendor/availability", requireVendor, requireSupabase, async (req, res) => {
  const isAvailable = !!req.body.available;
  let { data, error } = await supa.from("vendors")
    .update({ is_available: isAvailable })
    .eq("id", req.user.vendor_id).select().single();

  if (error && /column|schema cache/i.test(error.message || "")) {
    // Column missing — soft-succeed so UI doesn't break
    return sendSuccess(res, {
      available: isAvailable,
      warning: "Add is_available column to vendors table to persist this."
    });
  }
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { available: data.is_available });
});

// ---- Vendor edits own services / price / bio / mpesa ----
app.patch("/api/vendor/services", requireVendor, requireSupabase, async (req, res) => {
  const patch = {};
  if (Array.isArray(req.body.services))
    patch.services = req.body.services.filter(s => typeof s === "string" && s.length < 60).slice(0, 50);
  if (req.body.price !== undefined)   patch.price = safeNumber(req.body.price, 0);
  if (req.body.bio !== undefined)     patch.bio = cleanText(req.body.bio, 300);
  if (req.body.category !== undefined) patch.category = cleanText(req.body.category, 40);
  if (!Object.keys(patch).length) return sendError(res, 400, "Nothing to update");

  const { data, error } = await supa.from("vendors")
    .update(patch).eq("id", req.user.vendor_id).select().single();
  if (error) return sendError(res, 500, error.message);
  delete data.password_hash;
  return sendSuccess(res, { vendor: data });
});

// ---- Direct payment setup ----
app.get("/api/vendor/payment", requireVendor, requireSupabase, async (req, res) => {
  const { data, error } = await supa.from("vendors")
    .select("payment_channel, paybill_number, paybill_account, till_number, mpesa, mpesa_name")
    .eq("id", req.user.vendor_id).maybeSingle();
  if (error && /column|schema cache/i.test(error.message || "")) {
    return sendError(res, 501,
      "Payment columns missing. Run the ALTER TABLE from the migration.");
  }
  if (error) return sendError(res, 500, error.message);
  return sendSuccess(res, { payment: data || {} });
});

app.patch("/api/vendor/payment", requireVendor, requireSupabase, async (req, res) => {
  const check = validatePayment(req.body);
  if (check.error) return sendError(res, 400, check.error);

  // Attach optional mpesa_name
  if (req.body.mpesa_name !== undefined) {
    check.patch.mpesa_name = cleanText(req.body.mpesa_name, 100);
  }

  let { data, error } = await supa.from("vendors")
    .update(check.patch).eq("id", req.user.vendor_id).select().single();

  if (error && /column|schema cache/i.test(error.message || "")) {
    return sendError(res, 501,
      "Payment columns missing. Run the ALTER TABLE from the migration.");
  }
  if (error) return sendError(res, 500, error.message);
  delete data.password_hash;
  return sendSuccess(res, { vendor: data });
});

// ---- PUBLIC: guest reads vendor payment details ----
app.get("/api/public/vendor/:vendorId/payment", requireSupabase, async (req, res) => {
  const vid = req.params.vendorId;
  if (!isValidId(vid)) return sendError(res, 400, "Invalid vendor");
  const { data } = await supa.from("vendors")
    .select("vendor_name, payment_channel, paybill_number, paybill_account, till_number, mpesa, mpesa_name")
    .eq("id", vid).maybeSingle();
  if (!data) return sendError(res, 404, "Vendor not found");
  return sendSuccess(res, { payment: data });
});

// ============================================================
// GUEST — public
// ============================================================
app.get("/api/public/hotel/:hotelId/services", requireSupabase, async (req, res) => {
  const hid = String(req.params.hotelId || "").toUpperCase();
  const { data } = await supa.from("hotel_services").select("*")
    .eq("hotel_id", hid).eq("is_active", true)
    .order("created_at", { ascending: false }).limit(200);
  const { data: depts } = await supa.from("departments").select("name, whatsapp").eq("hotel_id", hid);
  res.json({ services: data || [], departments: depts || [] });
});

app.post("/api/orders", orderLimiter, requireSupabase, async (req, res) => {
  try {
    const { hotel_id, room_number, guest_name, guest_phone, service_id, service_title,
            category, details, amount, department } = req.body;

    if (!hotel_id) return sendError(res, 400, "hotel_id required");
    if (!room_number) return sendError(res, 400, "Room number required");
    if (!guest_name) return sendError(res, 400, "Guest name required");
    if (!guest_phone) return sendError(res, 400, "Phone required");
    if (!service_title) return sendError(res, 400, "Service required");

    const hid = String(hotel_id).toUpperCase();
    const ref = makeRef();

    const { data, error } = await supa.from("orders").insert([{
      reference: ref,
      hotel_id: hid,
      room_number: cleanText(room_number, 30),
      guest_name: cleanText(guest_name, 100),
      guest_phone: cleanPhone(guest_phone),
      service_id: cleanText(service_id, 60),
      service_title: cleanText(service_title, 120),
      category: cleanText(category || "food", 30),
      details: cleanText(details, 300),
      amount: safeNumber(amount, 0),
      department: cleanText(department || "services", 30),
      status: "pending"
    }]).select().single();

    if (error) return sendError(res, 500, error.message);
    return sendSuccess(res, { order: data });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.get("/api/orders/:id", requireSupabase, async (req, res) => {
  const id = req.params.id;
  const { data } = await supa.from("orders").select("*")
    .or(`id.eq.${id},reference.eq.${id}`).maybeSingle();
  if (!data) return sendError(res, 404, "Order not found");
  return sendSuccess(res, { order: data });
});

app.post("/api/orders/:id/rate", requireSupabase, async (req, res) => {
  try {
    const stars = safeNumber(req.body.rating, 0);
    if (stars < 1 || stars > 5) return sendError(res, 400, "Rating must be 1–5");

    const { data: existing } = await supa.from("orders")
      .select("id, status").eq("id", req.params.id).maybeSingle();
    if (!existing) return sendError(res, 404, "Order not found");
    if (String(existing.status).toLowerCase() !== "completed")
      return sendError(res, 400, "Only completed orders can be rated");

    const now = new Date().toISOString();
    let { data, error } = await supa.from("orders")
      .update({ rating: stars, rated_at: now }).eq("id", req.params.id).select().single();
    if (error && /column|schema cache/i.test(error.message || "")) {
      return sendError(res, 501, "Rating not configured on orders table");
    }
    if (error) return sendError(res, 500, error.message);
    return sendSuccess(res, { order: data });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.get("/api/orders/:hotelId/:room", requireSupabase, async (req, res) => {
  try {
    const hotelId = String(req.params.hotelId || "").toUpperCase();
    const room = cleanText(req.params.room, 30);

    if (!hotelId || !room || room.toLowerCase() === "rate") {
      return sendError(res, 400, "hotelId and room required");
    }

    const { data, error } = await supa.from("orders")
      .select("*")
      .eq("hotel_id", hotelId)
      .eq("room_number", room)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return sendError(res, 500, error.message);
    return sendSuccess(res, { orders: data || [] });
  } catch (e) { return sendError(res, 500, e.message); }
});

app.get("/api/guest/orders", requireSupabase, async (req, res) => {
  const phone = cleanPhone(req.query.phone || "");
  const hotel_id = String(req.query.hotel_id || "").toUpperCase();
  if (!phone || !hotel_id) return sendError(res, 400, "phone and hotel_id required");
  const { data } = await supa.from("orders").select("*")
    .eq("hotel_id", hotel_id)
    .eq("guest_phone", phone)
    .order("created_at", { ascending: false }).limit(20);
  return sendSuccess(res, { orders: data || [] });
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
    "/": "index.html"
  };
  const mapped = htmlMap[req.path] || "index.html";
  res.sendFile(path.join(publicDir, mapped), (err) => {
    if (err) res.sendFile(path.join(publicDir, "index.html"));
  });
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  console.error("❌", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: "Server error" });
});

// ---------- Listen ----------
app.listen(PORT, "0.0.0.0", () => {
  console.log("============================================");
  console.log(`✅ GuestHub V1.2 running on 0.0.0.0:${PORT}`);
  console.log(`📁 Serving from: ${path.join(__dirname, "public")}`);
  console.log(`🔑 Supabase: ${supa ? "CONNECTED" : "MISSING KEYS"}`);
  if (missing.length) console.log(`⚠️  Missing env: ${missing.join(", ")}`);
  console.log("--------------------------------------------");
  console.log("💳 Direct-to-vendor payments enabled");
  console.log("📌 Required migration (run once in Supabase SQL):");
  console.log("   ALTER TABLE vendors");
  console.log("     ADD COLUMN IF NOT EXISTS payment_channel text DEFAULT 'send_money',");
  console.log("     ADD COLUMN IF NOT EXISTS paybill_number  text,");
  console.log("     ADD COLUMN IF NOT EXISTS paybill_account text,");
  console.log("     ADD COLUMN IF NOT EXISTS till_number     text,");
  console.log("     ADD COLUMN IF NOT EXISTS mpesa_name      text,");
  console.log("     ADD COLUMN IF NOT EXISTS is_available    boolean DEFAULT true;");
  console.log("============================================");
});
