// GuestHub V34.2 SECURED — GM → Guest → Vendor
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
const app = express();

/* =========================================================
   ✅ FIX: Startup guards — crash early if env is broken
========================================================= */
const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "SUPABASE_SERVICE_KEY",
  "JWT_SECRET",
  "ADMIN_PASSWORD"
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error("❌ Missing env vars:", missing.join(", "));
  // Don't exit in dev, but warn loudly
  if (process.env.NODE_ENV === "production") process.exit(1);
}

const REAL_URL = process.env.SUPABASE_URL;
const REAL_KEY = process.env.SUPABASE_KEY;
const SERVICE  = process.env.SUPABASE_SERVICE_KEY || REAL_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "GuestHub_OS_2026_SECURE_CHANGE_ME";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

if (JWT_SECRET.includes("CHANGE_ME") && process.env.NODE_ENV === "production") {
  console.warn("⚠️ JWT_SECRET looks like a placeholder — set a real one in Render!");
}

/* =========================================================
   Supabase client
========================================================= */
let supa = null;
try {
  supa = createClient(REAL_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
} catch (e) {
  console.error("❌ Supabase init failed:", e.message);
}

/* =========================================================
   ✅ FIX: CORS — allowlist, not wildcard
========================================================= */
const ALLOWED_ORIGINS = [
  "https://guestconnect-ap2q.onrender.com",
  "http://localhost:10000",
  "http://localhost:3000",
  "http://localhost:5173"
];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl, mobile apps, SSR
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Allow any *.onrender.com preview builds (your own service)
    try {
      const host = new URL(origin).hostname;
      if (host.endsWith(".onrender.com")) return cb(null, true);
    } catch {}
    return cb(new Error("CORS origin not allowed: " + origin));
  },
  credentials: true
}));

/* =========================================================
   ✅ FIX: Security headers BEFORE routes, listen AFTER
========================================================= */
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: false, // keep off for now (inline scripts in your HTML)
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

/* =========================================================
   Rate limiters
========================================================= */
const loginLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });
const orderLimiter  = rateLimit({ windowMs: 60 * 1000,      max: 60, standardHeaders: true, legacyHeaders: false });
const forgotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5,  standardHeaders: true, legacyHeaders: false });

// Apply to /api/* (loose), specific routes override below
app.use("/api/", rateLimit({ windowMs: 60 * 1000, max: 200 }));

/* =========================================================
   Helpers
========================================================= */
const clean     = v => String(v || "").trim().toLowerCase();
const cleanText = (v, m = 500) => String(v || "").trim().slice(0, m).replace(/[<>]/g, "");
const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));
const isValidId    = id => /^[A-Za-z0-9_-]{1,100}$/.test(String(id || ""));
const safeNumber   = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f; };

const sendError   = (res, s, m) => res.status(s).json({ ok: false, error: m });
const sendSuccess = (res, d = {}) => res.json({ ok: true, ...d });

/* =========================================================
   JWT helpers
========================================================= */
const createToken = (payload, expires = "7d") =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: expires });

const verifyToken = req => {
  const h = req.headers.authorization || req.headers["x-auth-token"];
  if (!h) return null;
  const t = h.startsWith("Bearer ") ? h.slice(7) : h;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
};

/* =========================================================
   ✅ FIX: getHotelId — no silent BAOBAB fallback
   Returns null if no valid hotel_id is provided.
========================================================= */
const getHotelId = req => {
  const tk = verifyToken(req);
  const raw = (tk && tk.hotel_id) ||
              req.query.hotel_id ||
              (req.body && req.body.hotel_id) ||
              req.headers["x-hotel-id"];
  if (!raw) return null;
  const id = String(raw).toUpperCase().trim();
  return isValidId(id) ? id : null;
};

/* =========================================================
   ✅ FIX: Auth middlewares (restored from earlier version)
========================================================= */
function requireAdmin(req, res, next) {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== "admin") {
    return sendError(res, 401, "Unauthorized — admin only");
  }
  req.user = decoded;
  next();
}

function requireHotel(req, res, next) {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== "hotel") {
    return sendError(res, 401, "Unauthorized — hotel login required");
  }
  req.user = decoded;
  next();
}

function requireVendor(req, res, next) {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== "vendor") {
    return sendError(res, 401, "Unauthorized — vendor login required");
  }
  req.user = decoded;
  next();
}

/* =========================================================
   Hotel cache
========================================================= */
let HOTEL_CACHE = { data: [], time: 0 };

/* =========================================================
   PUBLIC — health + config.js
========================================================= */
app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    os: "V34.2 SECURED",
    port: PORT,
    time: new Date().toISOString()
  })
);

// ✅ FIX: config.js serves ONLY the anon key. This is safe because
// SUPABASE_KEY must be your anon/public key. Never serve SERVICE_KEY.
app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.setHeader("Cache-Control", "no-cache");
  const u = process.env.SUPABASE_URL || "https://placeholder.supabase.co";
  const k = process.env.SUPABASE_KEY || "placeholder-key";
  res.send(
    `const SUPABASE_URL="${u}";` +
    `const SUPABASE_KEY="${k}";` +
    `window.SUPABASE_URL="${u}";` +
    `window.SUPABASE_KEY="${k}";`
  );
});

/* =========================================================
   ADMIN AUTH (new — restores what was missing)
========================================================= */
app.post("/api/admin/login", loginLimiter, async (req, res) => {
  try {
    const password = String(req.body.password || "");
    if (!password) return sendError(res, 400, "Password required");
    if (!ADMIN_PASSWORD) return sendError(res, 500, "Admin password not configured on server");

    // Support either bcrypt hash or plaintext env var
    let valid = false;
    if (ADMIN_PASSWORD.startsWith("$2")) {
      valid = await bcrypt.compare(password, ADMIN_PASSWORD);
    } else {
      valid = password === ADMIN_PASSWORD;
    }
    if (!valid) return sendError(res, 401, "Wrong admin password");

    const token = createToken({ role: "admin" }, "12h");
    return sendSuccess(res, { token, expiresIn: "12h" });
  } catch (e) {
    return sendError(res, 500, "Server error");
  }
});

/* =========================================================
   HOTELS — public data
========================================================= */
app.get("/api/data", async (req, res) => {
  try {
    if (Date.now() - HOTEL_CACHE.time < 60000 && HOTEL_CACHE.data.length) {
      return res.json({ hotels: HOTEL_CACHE.data, cached: true });
    }
    const { data, error } = await supa
      .from("hotels")
      .select("id,hotel_id,hotel_name,name,location,city,status")
      .eq("status", "APPROVED")
      .limit(1000);
    if (error) throw error;
    HOTEL_CACHE = { data: data || [], time: Date.now() };
    res.json({ hotels: data || [] });
  } catch (e) {
    res.json({ hotels: HOTEL_CACHE.data || [] });
  }
});

/* =========================================================
   HOTEL signup + login
========================================================= */
app.post("/api/hotels/signup", signupLimiter, async (req, res) => {
  try {
    const { hotel_name, name, email, phone, password, location, city } = req.body;
    if (!password || password.length < 8) return sendError(res, 400, "Password 8+");
    const finalName = cleanText(hotel_name || name || "Hotel", 100);
    const finalEmail = clean(email);
    if (!isValidEmail(finalEmail)) return sendError(res, 400, "Invalid email");

    const hotelId = (
      finalName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "hotel"
    ).toUpperCase() + (Math.floor(Math.random() * 900) + 100);

    const hash = await bcrypt.hash(String(password), 12);
    const { error } = await supa.from("hotels").insert([{
      id: hotelId,
      hotel_id: hotelId,
      name: finalName,
      hotel_name: finalName,
      city: cleanText(city || location || "Mombasa", 80),
      location: cleanText(location || city || "Mombasa", 100),
      email: finalEmail,
      phone: cleanText(phone || "", 30),
      status: "PENDING",
      password_hash: hash
    }]);
    if (error) throw error;
    HOTEL_CACHE.time = 0;
    return sendSuccess(res, { hotel_id: hotelId, status: "PENDING" });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.post("/api/hotels/login", loginLimiter, async (req, res) => {
  try {
    const { email, password, hotel_id } = req.body;
    const hid = (hotel_id || "").toUpperCase();
    if (!password) return sendError(res, 400, "Password required");

    let q = supa.from("hotels").select("*");
    if (hid) {
      if (!isValidId(hid)) return sendError(res, 400, "Invalid hotel ID");
      q = q.or(`hotel_id.eq.${hid},id.eq.${hid}`);
    } else {
      q = q.eq("email", clean(email));
    }
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    if (!data) return sendError(res, 404, "Hotel not found");

    if (data.password_hash) {
      const ok = await bcrypt.compare(String(password), data.password_hash);
      if (!ok) return sendError(res, 401, "Wrong password");
    }

    // ✅ FIX: block non-approved hotels
    if (String(data.status || "").toUpperCase() !== "APPROVED") {
      return sendError(res, 403, "Hotel not approved yet");
    }

    const token = createToken({
      hotel_id: data.hotel_id || data.id,
      email: data.email,
      role: "hotel"
    });
    const safeHotel = { ...data };
    delete safeHotel.password_hash;
    delete safeHotel.password;
    return sendSuccess(res, { token, hotel_id: data.hotel_id || data.id, hotel: safeHotel });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

/* =========================================================
   VENDORS
========================================================= */
app.post("/api/vendors/signup", signupLimiter, async (req, res) => {
  try {
    const b = req.body;
    const finalName = (b.vendor_name || b.name || "").trim();
    const email = clean(b.email || "");
    const password = String(b.password || "");
    const phone = String(b.phone || "").replace(/\D/g, "");

    if (!finalName || !phone || !email) return sendError(res, 400, "Name, phone & email required");
    if (!isValidEmail(email)) return sendError(res, 400, "Invalid email");
    if (password.length < 8) return sendError(res, 400, "Password min 8");

    const { data: exists } = await supa.schema("guesthub_os").from("vendors")
      .select("id").eq("email", email).maybeSingle();
    if (exists) return sendError(res, 409, "Email exists — login");

    const hash = await bcrypt.hash(password, 12);
    const vendorId = finalName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
      + Date.now().toString().slice(-4);

    const vendorRow = {
      id: vendorId,
      vendor_name: finalName,
      full_name: b.full_name || finalName,
      category: b.category || "services",
      location: b.location || "Diani",
      city: b.city || "Diani",
      phone, email,
      hotel_ids: ["ALL"],
      services: Array.isArray(b.services) ? b.services : [b.category || "general"],
      price: safeNumber(b.price, 2500),
      status: "pending",
      is_active: true,
      is_available: true,
      password_hash: hash,
      created_at: new Date().toISOString()
    };

    const { error } = await supa.schema("guesthub_os").from("vendors").insert([vendorRow]);
    if (error) throw error;

    // Note: no auto fan-out to hotel_services here. GM adds vendors via /api/gm/vendors/:id/add.
    // ✅ FIX: Removed the fragile setImmediate block that caused duplicate rows.

    return sendSuccess(res, { vendor_id: vendorId, message: "Pending GM approval" });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.post("/api/vendors/login", loginLimiter, async (req, res) => {
  try {
    const email = clean(req.body.email || "");
    const password = String(req.body.password || "");
    if (!email || !password) return sendError(res, 400, "Email & password required");

    const { data: vendor, error } = await supa.schema("guesthub_os").from("vendors")
      .select("*").eq("email", email).maybeSingle();
    if (error) throw error;
    if (!vendor) return sendError(res, 404, "Vendor not found — signup");

    if (vendor.password_hash) {
      const ok = await bcrypt.compare(password, vendor.password_hash);
      if (!ok) return sendError(res, 401, "Wrong password");
    }

    if (vendor.status === "pending") {
      return res.json({ ok: true, pending: true, vendor, message: "Pending GM approval" });
    }
    if (vendor.status === "rejected" || vendor.status === "blocked") {
      return sendError(res, 403, "Account " + vendor.status);
    }

    const token = createToken({ vendor_id: vendor.id, email: vendor.email, role: "vendor" });
    const safeVendor = { ...vendor };
    delete safeVendor.password_hash;
    return sendSuccess(res, { token, vendor: safeVendor });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

/* =========================================================
   ✅ FIX: forgot-password DISABLED. It was an account-takeover
   backdoor. Use a token-email flow (TODO) or admin reset.
========================================================= */
app.post("/api/vendors/forgot-password", forgotLimiter, async (req, res) => {
  return sendError(res, 501, "Password reset via API disabled. Contact support to reset.");
});

/* =========================================================
   GUEST — public vendor/service listing (needs hotel_id)
========================================================= */
app.get("/api/vendors", async (req, res) => {
  try {
    const hid = getHotelId(req);
    if (!hid) return sendError(res, 400, "hotel_id required");

    const { data: vendors } = await supa.schema("guesthub_os").from("vendors")
      .select("*")
      .or(`hotel_ids.cs.{${hid}},hotel_ids.cs.{ALL}`)
      .eq("status", "approved")
      .eq("is_active", true)
      .limit(100);

    const { data: services } = await supa.schema("guesthub_os").from("hotel_services")
      .select("*").eq("hotel_id", hid).eq("is_active", true).limit(150);

    res.json({ vendors: vendors || [], services: services || [] });
  } catch {
    res.json({ vendors: [], services: [] });
  }
});

app.get("/api/hotel-services", async (req, res) => {
  try {
    const hid = (req.query.hotel_id || getHotelId(req) || "").toUpperCase();
    if (!hid || !isValidId(hid)) return sendError(res, 400, "hotel_id required");
    const { data } = await supa.schema("guesthub_os").from("hotel_services")
      .select("*").eq("hotel_id", hid).eq("is_active", true).limit(200);
    res.json({ hotel_id: hid, services: data || [] });
  } catch {
    res.json({ services: [] });
  }
});

/* =========================================================
   GM FLOW — vendors pool, add, remove
========================================================= */
app.get("/api/gm/vendors-pool", requireHotel, async (req, res) => {
  try {
    const hid = req.user.hotel_id;
    const { data: pool } = await supa.schema("guesthub_os").from("vendors")
      .select("*").eq("status", "approved").limit(100);
    const { data: myServices } = await supa.schema("guesthub_os").from("hotel_services")
      .select("vendor_id").eq("hotel_id", hid).eq("is_active", true);
    const myIds = new Set((myServices || []).map(s => s.vendor_id));
    res.json({ pool: pool || [], myVendorIds: [...myIds], hotel_id: hid });
  } catch {
    res.json({ pool: [], myVendorIds: [] });
  }
});

app.post("/api/gm/vendors/:vendorId/add", requireHotel, async (req, res) => {
  try {
    const hid = req.user.hotel_id;
    const vendorId = req.params.vendorId;
    if (!isValidId(vendorId)) return sendError(res, 400, "Invalid vendor");

    const { data: vendor } = await supa.schema("guesthub_os").from("vendors")
      .select("*").eq("id", vendorId).maybeSingle();
    if (!vendor) return sendError(res, 404, "Vendor not found");

    await supa.schema("guesthub_os").from("hotel_services")
      .update({ is_active: true }).eq("hotel_id", hid).eq("vendor_id", vendorId);

    const { data: exists } = await supa.schema("guesthub_os").from("hotel_services")
      .select("id").eq("hotel_id", hid).eq("vendor_id", vendorId).maybeSingle();

    if (!exists) {
      await supa.schema("guesthub_os").from("hotel_services").insert([{
        hotel_id: hid,
        title: `${vendor.services?.[0] || "Service"} — ${vendor.vendor_name}`,
        price: vendor.price,
        department: "services",
        vendor_name: vendor.vendor_name,
        vendor_phone: vendor.phone,
        vendor_id: vendorId,
        is_active: true
      }]);
    }
    return sendSuccess(res, { message: `${vendor.vendor_name} added to ${hid}` });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.post("/api/gm/vendors/:vendorId/remove", requireHotel, async (req, res) => {
  try {
    const hid = req.user.hotel_id;
    const vendorId = req.params.vendorId;
    if (!isValidId(vendorId)) return sendError(res, 400, "Invalid vendor");
    await supa.schema("guesthub_os").from("hotel_services")
      .update({ is_active: false }).eq("hotel_id", hid).eq("vendor_id", vendorId);
    res.json({ ok: true });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

/* =========================================================
   VENDOR DASHBOARD
========================================================= */
app.get("/api/vendor/me", requireVendor, async (req, res) => {
  try {
    const { data } = await supa.schema("guesthub_os").from("vendors")
      .select("*").eq("id", req.user.vendor_id).maybeSingle();
    if (!data) return sendError(res, 404, "Vendor not found");
    const safe = { ...data };
    delete safe.password_hash;
    return res.json({ ok: true, vendor: safe });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/vendor/orders", requireVendor, async (req, res) => {
  try {
    const { data: services } = await supa.schema("guesthub_os").from("hotel_services")
      .select("hotel_id").eq("vendor_id", req.user.vendor_id).eq("is_active", true);
    const hotelIds = (services || []).map(s => s.hotel_id);
    if (!hotelIds.length) return res.json({ ok: true, orders: [] });

    const { data, error } = await supa.schema("guesthub_os").from("orders")
      .select("*").in("hotel_id", hotelIds)
      .order("created_at", { ascending: false }).limit(150);
    if (error) throw error;
    res.json({ ok: true, orders: data || [] });
  } catch (e) {
    console.error("vendor/orders:", e.message);
    res.status(500).json({ ok: false, error: e.message, orders: [] });
  }
});

/* =========================================================
   ✅ FIX: ALL ADMIN ROUTES NOW REQUIRE ADMIN JWT
========================================================= */
app.get("/api/admin/vendors", requireAdmin, async (req, res) => {
  const { data } = await supa.schema("guesthub_os").from("vendors")
    .select("*").order("created_at", { ascending: false }).limit(200);
  res.json({ vendors: data || [] });
});

app.post("/api/admin/vendors/:id/approve", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidId(id)) return sendError(res, 400, "Invalid id");
    if (req.body?.status === "rejected") {
      await supa.schema("guesthub_os").from("vendors")
        .update({ status: "rejected", is_active: false }).eq("id", id);
      await supa.schema("guesthub_os").from("hotel_services")
        .update({ is_active: false }).eq("vendor_id", id);
    } else {
      await supa.schema("guesthub_os").from("vendors")
        .update({ status: "approved", is_active: true, is_available: true }).eq("id", id);
      await supa.schema("guesthub_os").from("hotel_services")
        .update({ is_active: true }).eq("vendor_id", id);
    }
    res.json({ ok: true });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.delete("/api/admin/vendors/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidId(id)) return sendError(res, 400, "Invalid id");
    await supa.schema("guesthub_os").from("vendors").delete().eq("id", id);
    await supa.schema("guesthub_os").from("hotel_services").delete().eq("vendor_id", id);
    res.json({ ok: true });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.get("/api/admin/hotels", requireAdmin, async (req, res) => {
  const { data } = await supa.from("hotels")
    .select("*").order("created_at", { ascending: false }).limit(1000);
  res.json({ hotels: data || [] });
});

app.post("/api/admin/hotels/:id/approve", requireAdmin, async (req, res) => {
  try {
    const hid = req.params.id.toUpperCase();
    if (!isValidId(hid)) return sendError(res, 400, "Invalid id");
    await supa.from("hotels")
      .update({ status: "APPROVED", approved_by_admin: true })
      .or(`hotel_id.eq.${hid},id.eq.${hid}`);
    HOTEL_CACHE.time = 0;
    res.json({ ok: true });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

app.delete("/api/admin/hotels/:id", requireAdmin, async (req, res) => {
  try {
    const hid = req.params.id.toUpperCase();
    if (!isValidId(hid)) return sendError(res, 400, "Invalid id");
    await supa.from("hotels").delete().or(`hotel_id.eq.${hid},id.eq.${hid}`);
    HOTEL_CACHE.time = 0;
    res.json({ ok: true });
  } catch (e) {
    return sendError(res, 500, e.message);
  }
});

/* =========================================================
   ORDERS — guest submits (no auth, hotel_id required)
========================================================= */
app.post("/api/orders", orderLimiter, async (req, res) => {
  try {
    const hid = getHotelId(req);
    if (!hid) return sendError(res, 400, "hotel_id required");

    const body = req.body;
    const vendorId = body.items?.[0]?.vendor_id || body.vendor_id || null;

    const payload = {
      hotel_id: hid,
      room_number: cleanText(body.room_number || body.room || "101", 30),
      guest_name: cleanText(body.guest_name || "Guest", 100),
      guest_phone: cleanText(body.guest_phone || body.phone || "", 30),
      items: body.items || [],
      total: safeNumber(body.total || 0),
      status: "pending",
      department: clean(body.department || "services"),
      vendor_id: vendorId
    };

    const { data, error } = await supa.schema("guesthub_os").from("orders")
      .insert([payload]).select().single();
    if (error) throw error;
    res.json({ ok: true, order: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/orders", requireHotel, async (req, res) => {
  try {
    const hid = req.user.hotel_id;
    const { data } = await supa.schema("guesthub_os").from("orders")
      .select("*").eq("hotel_id", hid)
      .order("created_at", { ascending: false }).limit(100);
    res.json({ orders: data || [] });
  } catch {
    res.json({ orders: [] });
  }
});

/* =========================================================
   ✅ FIX: API 404 JSON, then static + SPA fallback
========================================================= */
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/*", (req, res) => {
  res.status(404).json({ ok: false, error: "API route not found" });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================================================
   ✅ FIX: Central error handler
========================================================= */
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: "Server error" });
});

/* =========================================================
   ✅ FIX: listen() moved to the END
========================================================= */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔒 GuestHub V34.2 SECURED — listening on ${PORT}`);
});
