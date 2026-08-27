import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- FIX: CONFIG.JS ROUTE - ADD HAPA ---
app.get('/config.js', (req, res) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  
  if (!url || !key) {
    return res.type('application/javascript').send(`console.error("Missing env vars");`);
  }
  
  res.type('application/javascript');
  res.send(`
    const SUPABASE_URL = "${url}";
    const SUPABASE_KEY = "${key}";
    const SUPABASE_ANON_KEY = "${key}";
    window.SUPABASE_URL = "${url}";
    window.SUPABASE_KEY = "${key}";
    window.SUPABASE_ANON_KEY = "${key}";
  `);
});
// --- END FIX ---


/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_IN_RENDER";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY");
  process.exit(1);
}

if (!ADMIN_PASSWORD) {
  console.error("❌ Missing ADMIN_PASSWORD environment variable");
  process.exit(1);
}

if (
  JWT_SECRET ===
  "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_IN_RENDER"
) {
  console.warn(
    "⚠️ WARNING: Set JWT_SECRET in your Render environment variables."
  );
}

/* =========================================================
   SUPABASE
========================================================= */

const supa = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

/* =========================================================
   APP
========================================================= */

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  express.json({
    limit: "50kb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "50kb"
  })
);

/* =========================================================
   CORS
========================================================= */

const ALLOWED_ORIGINS = [
  "https://guestconnect-ap2q.onrender.com",
  "http://localhost:10000",
  "http://localhost:3000"
];

app.use(
  cors({
    origin(origin, callback) {

      if (!origin) {
        return callback(null, true);
      }

      if (
        ALLOWED_ORIGINS.includes(origin) ||
        /\.onrender\.com$/.test(
          new URL(origin).hostname
        )
      ) {
        return callback(null, true);
      }

      return callback(
        new Error("CORS origin not allowed")
      );
    },

    credentials: true
  })
);

/* =========================================================
   STATIC FILES
========================================================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================================
   RATE LIMITERS
========================================================= */

const loginLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
      ok: false,
      message:
        "Too many login attempts. Please try again later."
    }
  });

const signupLimiter =
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
      ok: false,
      message:
        "Too many signup attempts from this IP."
    }
  });

const apiLimiter =
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
      ok: false,
      message:
        "Too many requests. Please slow down."
    }
  });

app.use("/api/", apiLimiter);

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function cleanText(value, max = 500) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(email || "")
  );
}

function isValidId(id) {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(
    String(id || "")
  );
}

function safeNumber(value, fallback = 0) {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return n;
}

function safePositiveNumber(value) {

  const n = Number(value);

  if (!Number.isFinite(n) || n < 0) {
    return null;
  }

  return n;
}

function sendError(res, status, message) {

  return res.status(status).json({
    ok: false,
    error: message
  });
}

function sendSuccess(res, data = {}) {

  return res.json({
    ok: true,
    ...data
  });
}

/* =========================================================
   SAFE HOTEL FIELDS
========================================================= */

const SAFE_HOTEL_FIELDS = [
  "id",
  "hotel_id",
  "hotel_name",
  "name",
  "email",
  "phone",
  "location",
  "city",
  "hotel_type",
  "plan",
  "price",
  "status",
  "created_at",
  "whatsapp_kitchen",
  "whatsapp_house",
  "whatsapp_housekeeping",
  "whatsapp_laundry",
  "whatsapp_spa",
  "whatsapp_taxi",
  "whatsapp_tours",
  "whatsapp_media",
  "whatsapp_front"
].join(",");

/* =========================================================
   JWT
========================================================= */

function createToken(payload) {

  return jwt.sign(
    payload,
    JWT_SECRET,
    {
      expiresIn: "12h"
    }
  );
}

function getBearerToken(req) {

  const header =
    req.headers.authorization;

  if (
    header &&
    header.startsWith("Bearer ")
  ) {
    return header.slice(7);
  }

  return (
    req.headers["x-admin-token"] ||
    req.headers["x-auth-token"] ||
    null
  );
}

function verifyToken(req) {

  const token =
    getBearerToken(req);

  if (!token) {
    return null;
  }

  try {

    return jwt.verify(
      token,
      JWT_SECRET
    );

  } catch {

    return null;
  }
}

/* =========================================================
   ADMIN AUTH
========================================================= */

function requireAdmin(req, res, next) {

  const decoded =
    verifyToken(req);

  if (
    !decoded ||
    decoded.role !== "admin"
  ) {
    return sendError(
      res,
      401,
      "Unauthorized - Admin access required"
    );
  }

  req.user = decoded;

  next();
}

/* =========================================================
   HOTEL AUTH
========================================================= */

function requireHotel(req, res, next) {

  const decoded =
    verifyToken(req);

  if (
    !decoded ||
    decoded.role !== "hotel"
  ) {
    return sendError(
      res,
      401,
      "Unauthorized - Hotel login required"
    );
  }

  req.user = decoded;

  next();
}

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  "/api/admin/login",
  loginLimiter,
  async (req, res) => {

    try {

      const password =
        String(req.body.password || "");

      if (!password) {

        return sendError(
          res,
          400,
          "Password required"
        );
      }

      const valid =
        await bcrypt.compare(
          password,
          ADMIN_PASSWORD
        ).catch(() => false);

      /*
        Allows ADMIN_PASSWORD to be either:
        1. bcrypt hash
        2. plain environment secret

        For production, bcrypt hash is strongly recommended.
      */

      const authenticated =
        valid ||
        password === ADMIN_PASSWORD;

      if (!authenticated) {

        return sendError(
          res,
          401,
          "Wrong admin password"
        );
      }

      const token =
        createToken({
          role: "admin",
          scope: "full_admin"
        });

      return sendSuccess(
        res,
        {
          token,
          expiresIn: "12h"
        }
      );

    } catch (error) {

      console.error(
        "Admin login error:",
        error
      );

      return sendError(
        res,
        500,
        "Server error"
      );
    }
  }
);

/* =========================================================
   HOTEL SIGNUP
========================================================= */

app.post(
  "/api/hotels/signup",
  signupLimiter,
  async (req, res) => {

    try {

      const {
        hotel_name,
        name,
        location,
        city,
        hotel_type,
        email,
        phone,
        password
      } = req.body;

      const finalName =
        cleanText(
          hotel_name || name,
          100
        );

      const finalEmail =
        clean(email);

      if (
        !finalName ||
        finalName.length < 3
      ) {

        return sendError(
          res,
          400,
          "Hotel name must be at least 3 characters"
        );
      }

      if (!isValidEmail(finalEmail)) {

        return sendError(
          res,
          400,
          "Invalid email address"
        );
      }

      if (
        !password ||
        String(password).length < 8
      ) {

        return sendError(
          res,
          400,
          "Password must be at least 8 characters"
        );
      }

      /*
        Generate a readable hotel ID.
      */

      let baseId =
        finalName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 20);

      if (!baseId) {

        return sendError(
          res,
          400,
          "Invalid hotel name"
        );
      }

      let hotelId = baseId;

      /*
        Avoid collisions.
      */

      let suffix = 1;

      while (true) {

        const { data: existing } =
          await supa
            .from("hotels")
            .select("id")
            .or(
              `id.eq.${hotelId},hotel_id.eq.${hotelId}`
            )
            .limit(1);

        if (
          !existing ||
          existing.length === 0
        ) {
          break;
        }

        hotelId =
          `${baseId}${suffix}`;

        suffix++;

        if (suffix > 9999) {

          return sendError(
            res,
            500,
            "Unable to generate unique hotel ID"
          );
        }
      }

      const hash =
        await bcrypt.hash(
          String(password),
          12
        );

      const payload = {

        id: hotelId,

        hotel_id: hotelId,

        name: finalName,

        hotel_name: finalName,

        location:
          cleanText(
            location || city,
            100
          ),

        city:
          cleanText(
            city,
            80
          ),

        hotel_type:
          cleanText(
            hotel_type || "Upendo",
            30
          ),

        email: finalEmail,

        phone:
          cleanText(
            phone,
            30
          ),

        password: hash,

        password_hash: hash,

        status: "PENDING",

        plan: "Upendo",

        price: 6500
      };

      const { error } =
        await supa
          .from("hotels")
          .insert([payload]);

      if (error) {

        console.error(
          "Hotel signup DB error:",
          error
        );

        if (
          error.code === "23505"
        ) {

          return sendError(
            res,
            409,
            "Hotel already exists"
          );
        }

        throw error;
      }

      return sendSuccess(
        res,
        {
          hotel_id: hotelId,
          status: "PENDING",
          message:
            "Hotel registered successfully and is awaiting approval."
        }
      );

    } catch (error) {

      console.error(
        "Signup error:",
        error
      );

      return sendError(
        res,
        500,
        "Unable to register hotel"
      );
    }
  }
);

/* =========================================================
   HOTEL LOGIN
========================================================= */

app.post(
  "/api/hotel/login",
  loginLimiter,
  async (req, res) => {

    try {

      const {
        hotelId,
        hotel_id,
        password
      } = req.body;

      if (!password) {

        return sendError(
          res,
          400,
          "Password required"
        );
      }

      const id =
        clean(
          hotelId ||
          hotel_id
        );

      if (!id) {

        return sendError(
          res,
          400,
          "Hotel ID required"
        );
      }

      if (!isValidId(id)) {

        return sendError(
          res,
          400,
          "Invalid hotel ID"
        );
      }

      const { data: hotel, error } =
        await supa
          .from("hotels")
          .select("*")
          .or(
            `id.eq.${id},hotel_id.eq.${id}`
          )
          .limit(1)
          .maybeSingle();

      if (error) {

        console.error(
          "Hotel lookup error:",
          error
        );

        throw error;
      }

      if (!hotel) {

        return sendError(
          res,
          404,
          "Hotel not found"
        );
      }

      const hash =
        hotel.password_hash ||
        hotel.password;

      if (!hash) {

        return sendError(
          res,
          500,
          "Hotel account has no password configured"
        );
      }

      const valid =
        await bcrypt.compare(
          String(password),
          hash
        );

      if (!valid) {

        return sendError(
          res,
          401,
          "Wrong password"
        );
      }

      const status =
        String(
          hotel.status || ""
        ).toUpperCase();

      if (status !== "APPROVED") {

        return sendError(
          res,
          403,
          `Hotel is not approved. Current status: ${status || "UNKNOWN"}`
        );
      }

      const token =
        createToken({
          role: "hotel",
          hotel_id:
            hotel.hotel_id ||
            hotel.id
        });

      /*
        Never return passwords.
      */

      const safeHotel =
        { ...hotel };

      delete safeHotel.password;
      delete safeHotel.password_hash;

      return sendSuccess(
        res,
        {
          token,
          hotel: safeHotel,
          expiresIn: "12h"
        }
      );

    } catch (error) {

      console.error(
        "Hotel login error:",
        error
      );

      return sendError(
        res,
        500,
        "Server error"
      );
    }
  }
);

/* =========================================================
   CURRENT USER
========================================================= */

app.get(
  "/api/auth/me",
  async (req, res) => {

    const decoded =
      verifyToken(req);

    if (!decoded) {

      return sendError(
        res,
        401,
        "Invalid or expired token"
      );
    }

    if (
      decoded.role === "hotel"
    ) {

      const { data: hotel } =
        await supa
          .from("hotels")
          .select(SAFE_HOTEL_FIELDS)
          .or(
            `id.eq.${decoded.hotel_id},hotel_id.eq.${decoded.hotel_id}`
          )
          .limit(1)
          .maybeSingle();

      return sendSuccess(
        res,
        {
          user: decoded,
          hotel: hotel || null
        }
      );
    }

    return sendSuccess(
      res,
      {
        user: decoded
      }
    );
  }
);

/* =========================================================
   PUBLIC HOTEL LOOKUP
========================================================= */

app.get(
  "/api/public/hotel/:id",
  async (req, res) => {

    try {

      const id =
        clean(req.params.id);

      if (!isValidId(id)) {

        return sendError(
          res,
          400,
          "Invalid hotel ID"
        );
      }

      const { data, error } =
        await supa
          .from("hotels")
          .select(
            [
              "id",
              "hotel_id",
              "hotel_name",
              "name",
              "email",
              "phone",
              "location",
              "city",
              "hotel_type",
              "plan",
              "status"
            ].join(",")
          )
          .or(
            `id.eq.${id},hotel_id.eq.${id}`
          )
          .limit(1)
          .maybeSingle();

      if (error) throw error;

      if (!data) {

        return sendError(
          res,
          404,
          "Hotel not found"
        );
      }

      return sendSuccess(
        res,
        {
          hotel: data
        }
      );

    } catch (error) {

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load hotel"
      );
    }
  }
);

/* =========================================================
   PUBLIC HOTEL SERVICES
========================================================= */

app.get(
  "/api/public/hotel/:hotel_id/services",
  async (req, res) => {

    try {

      const hotelId =
        clean(
          req.params.hotel_id
        );

      if (!hotelId) {

        return sendError(
          res,
          400,
          "Hotel ID required"
        );
      }

      const { data, error } =
        await supa
          .from("hotel_services")
          .select(
            "id,hotel_id,title,price,category,description,active,created_at"
          )
          .eq(
            "hotel_id",
            hotelId
          )
          .eq(
            "active",
            true
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          );

      if (error) throw error;

      return sendSuccess(
        res,
        {
          services: data || []
        }
      );

    } catch (error) {

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load hotel services"
      );
    }
  }
);

/* =========================================================
   ADMIN HOTELS
========================================================= */

app.get(
  "/api/hotels",
  requireAdmin,
  async (req, res) => {

    try {

      const { data, error } =
        await supa
          .from("hotels")
          .select(SAFE_HOTEL_FIELDS)
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(1000);

      if (error) throw error;

      return res.json(data || []);

    } catch (error) {

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load hotels"
      );
    }
  }
);

app.get(
  "/api/admin/hotels",
  requireAdmin,
  async (req, res) => {

    try {

      const { data, error } =
        await supa
          .from("hotels")
          .select(SAFE_HOTEL_FIELDS)
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(1000);

      if (error) throw error;

      return res.json(data || []);

    } catch (error) {

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load hotels"
      );
    }
  }
);

/* =========================================================
   ADMIN HOTEL CREATE
========================================================= */

app.post(
  "/api/admin/hotels",
  requireAdmin,
  async (req, res) => {

    try {

      const {
        name,
        hotel_name,
        city,
        location,
        email,
        phone,
        hotel_type,
        plan
      } = req.body;

      const finalName =
        cleanText(
          name || hotel_name,
          100
        );

      if (!finalName) {

        return sendError(
          res,
          400,
          "Hotel name required"
        );
      }

      let baseId =
        finalName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 20);

      if (!baseId) {

        return sendError(
          res,
          400,
          "Invalid hotel name"
        );
      }

      let id = baseId;
      let suffix = 1;

      while (true) {

        const { data } =
          await supa
            .from("hotels")
            .select("id")
            .eq("id", id)
            .limit(1);

        if (!data?.length) break;

        id =
          `${baseId}${suffix++}`;

        if (suffix > 9999) {

          return sendError(
            res,
            500,
            "Could not create unique hotel ID"
          );
        }
      }

      const payload={

        id,

        hotel_id:id,

        name:finalName,

        hotel_name:finalName,

        city:
          cleanText(city,80),

        location:
          cleanText(
            location || city,
            100
          ),

        email:
          clean(email),

        phone:
          cleanText(phone,30),

        hotel_type:
          cleanText(
            hotel_type || "Upendo",
            30
          ),

        plan:
          cleanText(
            plan || "Upendo",
            30
          ),

        price:
          plan === "Bahari"
            ? 12000
            : plan === "Karibu"
              ? 25000
              : 6500,

        status:"APPROVED"

      };

      const { data, error } =
        await supa
          .from("hotels")
          .insert([payload])
          .select(SAFE_HOTEL_FIELDS)
          .single();

      if (error) throw error;

      return sendSuccess(
        res,
        {
          hotel:data
        }
      );

    } catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message ||
        "Unable to create hotel"
      );
    }
  }
);

/* =========================================================
   ADMIN HOTEL UPDATE
========================================================= */

app.patch(
  "/api/admin/hotels/:id",
  requireAdmin,
  async (req,res)=>{

    try{

      const id =
        clean(req.params.id);

      const allowed = [

        "name",
        "hotel_name",
        "city",
        "location",
        "email",
        "phone",
        "hotel_type",
        "plan",
        "status",

        "whatsapp_kitchen",
        "whatsapp_house",
        "whatsapp_housekeeping",
        "whatsapp_laundry",
        "whatsapp_spa",
        "whatsapp_taxi",
        "whatsapp_tours",
        "whatsapp_media",
        "whatsapp_front"

      ];

      const payload={};

      for(
        const field of allowed
      ){

        if(
          Object.prototype.hasOwnProperty
            .call(req.body,field)
        ){

          payload[field] =
            typeof req.body[field] === "string"
              ? cleanText(
                  req.body[field],
                  300
                )
              : req.body[field];

        }
      }

      if(
        payload.plan
      ){

        payload.price =
          payload.plan === "Bahari"
            ? 12000
            : payload.plan === "Karibu"
              ? 25000
              : 6500;
      }

      if(
        !Object.keys(payload).length
      ){

        return sendError(
          res,
          400,
          "No valid fields supplied"
        );
      }

      const { data,error } =
        await supa
          .from("hotels")
          .update(payload)
          .or(
            `id.eq.${id},hotel_id.eq.${id}`
          )
          .select(SAFE_HOTEL_FIELDS)
          .maybeSingle();

      if(error) throw error;

      return sendSuccess(
        res,
        {
          hotel:data
        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

/* =========================================================
   APPROVE HOTEL
========================================================= */

async function approveHotel(
  req,
  res
){

  try{

    const id =
      clean(req.params.id);

    const plan =
      cleanText(
        req.body.plan || "Upendo",
        30
      );

    const price =
      plan === "Bahari"
        ? 12000
        : plan === "Karibu"
          ? 25000
          : 6500;

    const { data,error } =
      await supa
        .from("hotels")
        .update({
          status:"APPROVED",
          plan,
          price
        })
        .or(
          `id.eq.${id},hotel_id.eq.${id}`
        )
        .select(SAFE_HOTEL_FIELDS)
        .maybeSingle();

    if(error) throw error;

    return sendSuccess(
      res,
      {
        hotel:data
      }
    );

  }catch(error){

    console.error(error);

    return sendError(
      res,
      500,
      error.message
    );
  }
}

app.post(
  "/api/hotels/:id/approve",
  requireAdmin,
  approveHotel
);

app.post(
  "/api/admin/approve/:id",
  requireAdmin,
  approveHotel
);

app.post(
  "/api/approve",
  requireAdmin,
  async(req,res)=>{

    req.params.id =
      req.body.id ||
      req.body.hotel_id;

    return approveHotel(
      req,
      res
    );
  }
);

/* =========================================================
   BLOCK HOTEL
========================================================= */

app.post(
  "/api/hotels/:id/block",
  requireAdmin,
  async(req,res)=>{

    try{

      const id =
        clean(req.params.id);

      const {error} =
        await supa
          .from("hotels")
          .update({
            status:"BLOCKED"
          })
          .or(
            `id.eq.${id},hotel_id.eq.${id}`
          );

      if(error) throw error;

      return sendSuccess(res);

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

/* =========================================================
   DELETE HOTEL
========================================================= */

app.delete(
  "/api/hotels/:id",
  requireAdmin,
  async(req,res)=>{

    try{

      const id =
        clean(req.params.id);

      const {error} =
        await supa
          .from("hotels")
          .delete()
          .or(
            `id.eq.${id},hotel_id.eq.${id}`
          );

      if(error) throw error;

      return sendSuccess(res);

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

app.post(
  "/api/hotels/:id/delete",
  requireAdmin,
  async(req,res)=>{

    req.params.id =
      req.params.id;

    return app._router.handle(
      req,
      res
    );
  }
);

/* =========================================================
   ADMIN STATS
========================================================= */

app.get(
  "/api/admin/stats",
  requireAdmin,
  async(req,res)=>{

    try{

      const [
        hotels,
        vendors,
        services,
        orders
      ] = await Promise.all([

        supa
          .from("hotels")
          .select("id,status",{
            count:"exact"
          }),

        supa
          .from("vendors")
          .select("id,status",{
            count:"exact"
          }),

        supa
          .from("hotel_services")
          .select("id",{
            count:"exact"
          }),

        supa
          .from("orders")
          .select("id,amount,status")

      ]);

      const orderData =
        orders.data || [];

      const gmv =
        orderData.reduce(
          (sum,o)=>
            sum +
            safeNumber(
              o.amount ||
              o.total ||
              0
            ),
          0
        );

      const commission =
        Math.floor(gmv * 0.15);

      return sendSuccess(
        res,
        {

          hotels:
            hotels.count || 0,

          vendors:
            vendors.count || 0,

          pendingVendors:
            (vendors.data || [])
              .filter(v=>
                String(v.status)
                  .toLowerCase()==="pending"
              ).length,

          services:
            services.count || 0,

          orders:
            orderData.length,

          gmv,

          commission

        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load statistics"
      );
    }
  }
);

/* =========================================================
   BOOKINGS COUNT
========================================================= */

app.get(
  "/api/admin/bookings/count",
  requireAdmin,
  async(req,res)=>{

    try{

      const {count,error} =
        await supa
          .from("orders")
          .select(
            "id",
            {
              count:"exact",
              head:true
            }
          );

      if(error) throw error;

      return res.json({
        count:count || 0
      });

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to count bookings"
      );
    }
  }
);

/* =========================================================
   ADMIN VENDORS
========================================================= */

app.get(
  "/api/admin/vendors",
  requireAdmin,
  async(req,res)=>{

    try{

      const {data,error} =
        await supa
          .from("vendors")
          .select("*")
          .order(
            "created_at",
            {
              ascending:false
            }
          )
          .limit(1000);

      if(error) throw error;

      return res.json(
        data || []
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load vendors"
      );
    }
  }
);

app.patch(
  "/api/admin/vendors/:id",
  requireAdmin,
  async(req,res)=>{

    try{

      const id =
        clean(req.params.id);

      const status =
        cleanText(
          req.body.status,
          30
        );

      if(
        ![
          "pending",
          "approved",
          "rejected",
          "blocked"
        ].includes(
          status.toLowerCase()
        )
      ){

        return sendError(
          res,
          400,
          "Invalid vendor status"
        );
      }

      const {data,error} =
        await supa
          .from("vendors")
          .update({
            status:
              status.toLowerCase()
          })
          .eq("id",id)
          .select("*")
          .maybeSingle();

      if(error) throw error;

      return sendSuccess(
        res,
        {
          vendor:data
        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

/* =========================================================
   ADMIN SERVICES
========================================================= */

app.get(
  "/api/admin/services",
  requireAdmin,
  async(req,res)=>{

    try{

      const {data,error} =
        await supa
          .from("hotel_services")
          .select("*")
          .order(
            "created_at",
            {
              ascending:false
            }
          )
          .limit(1000);

      if(error) throw error;

      return res.json(
        data || []
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load services"
      );
    }
  }
);

app.post(
  "/api/admin/services",
  requireAdmin,
  async(req,res)=>{

    try{

      const {
        hotel_id,
        title,
        price,
        category,
        description,
        active
      } = req.body;

      if(
        !hotel_id ||
        !title
      ){

        return sendError(
          res,
          400,
          "Hotel and service title required"
        );
      }

      const finalPrice =
        safePositiveNumber(
          price
        );

      if(finalPrice === null){

        return sendError(
          res,
          400,
          "Invalid price"
        );
      }

      const payload={

        hotel_id:
          clean(hotel_id),

        title:
          cleanText(title,120),

        price:
          finalPrice,

        category:
          cleanText(
            category || "other",
            30
          ),

        description:
          cleanText(
            description,
            500
          ),

        active:
          active !== false

      };

      const {data,error} =
        await supa
          .from("hotel_services")
          .insert([payload])
          .select("*")
          .single();

      if(error) throw error;

      return sendSuccess(
        res,
        {
          service:data
        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

app.patch(
  "/api/admin/services/:id",
  requireAdmin,
  async(req,res)=>{

    try{

      const id =
        clean(req.params.id);

      const payload={};

      if(req.body.hotel_id)
        payload.hotel_id =
          clean(req.body.hotel_id);

      if(req.body.title !== undefined)
        payload.title =
          cleanText(
            req.body.title,
            120
          );

      if(req.body.price !== undefined){

        const price =
          safePositiveNumber(
            req.body.price
          );

        if(price === null){

          return sendError(
            res,
            400,
            "Invalid price"
          );
        }

        payload.price=price;
      }

      if(req.body.category !== undefined)
        payload.category =
          cleanText(
            req.body.category,
            30
          );

      if(req.body.description !== undefined)
        payload.description =
          cleanText(
            req.body.description,
            500
          );

      if(req.body.active !== undefined)
        payload.active =
          Boolean(req.body.active);

      if(!Object.keys(payload).length){

        return sendError(
          res,
          400,
          "No valid fields supplied"
        );
      }

      const {data,error} =
        await supa
          .from("hotel_services")
          .update(payload)
          .eq("id",id)
          .select("*")
          .maybeSingle();

      if(error) throw error;

      return sendSuccess(
        res,
        {
          service:data
        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

app.delete(
  "/api/admin/services/:id",
  requireAdmin,
  async(req,res)=>{

    try{

      const id =
        clean(req.params.id);

      const {error} =
        await supa
          .from("hotel_services")
          .delete()
          .eq("id",id);

      if(error) throw error;

      return sendSuccess(res);

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

/* =========================================================
   OLD GM ADD ITEM COMPATIBILITY
========================================================= */

app.post(
  "/api/gm/add-item",
  requireHotel,
  async(req,res)=>{

    try{

      const {
        type,
        name,
        price,
        description
      } = req.body;

      const hotel_id =
        req.user.hotel_id;

      if(!name){

        return sendError(
          res,
          400,
          "Item name required"
        );
      }

      const amount =
        safePositiveNumber(price);

      if(amount === null){

        return sendError(
          res,
          400,
          "Invalid price"
        );
      }

      const payload={

        hotel_id,

        type:
          cleanText(
            type || "service",
            30
          ),

        name:
          cleanText(
            name,
            100
          ),

        price:
          amount,

        description:
          cleanText(
            description,
            500
          )

      };

      const {data,error} =
        await supa
          .from("hotel_items")
          .insert([payload])
          .select("*")
          .single();

      if(error) throw error;

      return sendSuccess(
        res,
        {
          item:data
        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

/* =========================================================
   HOTEL SERVICES
========================================================= */

app.get(
  "/api/gm/services",
  requireHotel,
  async(req,res)=>{

    try{

      const hotelId =
        req.user.hotel_id;

      const {data,error} =
        await supa
          .from("hotel_services")
          .select("*")
          .eq(
            "hotel_id",
            hotelId
          )
          .order(
            "created_at",
            {
              ascending:false
            }
          );

      if(error) throw error;

      return sendSuccess(
        res,
        {
          services:data || []
        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load services"
      );
    }
  }
);

/* =========================================================
   HOTEL DASHBOARD
========================================================= */

app.get(
  "/api/gm/dashboard",
  requireHotel,
  async(req,res)=>{

    try{

      const hotelId =
        req.user.hotel_id;

      const [
        hotelResult,
        ordersResult,
        servicesResult,
        vendorsResult
      ] = await Promise.all([

        supa
          .from("hotels")
          .select(SAFE_HOTEL_FIELDS)
          .or(
            `id.eq.${hotelId},hotel_id.eq.${hotelId}`
          )
          .limit(1)
          .maybeSingle(),

        supa
          .from("orders")
          .select("*")
          .eq(
            "hotel_id",
            hotelId
          )
          .order(
            "created_at",
            {
              ascending:false
            }
          )
          .limit(500),

        supa
          .from("hotel_services")
          .select("*")
          .eq(
            "hotel_id",
            hotelId
          )
          .order(
            "created_at",
            {
              ascending:false
            }
          ),

        supa
          .from("vendors")
          .select("*")
          .limit(100)
      ]);

      if(hotelResult.error)
        throw hotelResult.error;

      if(ordersResult.error)
        throw ordersResult.error;

      if(servicesResult.error)
        throw servicesResult.error;

      const orders =
        ordersResult.data || [];

      const revenue =
        orders.reduce(
          (sum,o)=>
            sum +
            safeNumber(
              o.amount ||
              o.total ||
              0
            ),
          0
        );

      return sendSuccess(
        res,
        {

          hotel:
            hotelResult.data,

          orders,

          items:
            servicesResult.data || [],

          services:
            servicesResult.data || [],

          todayOrders:
            orders.length,

          revenue,

          activeVendors:
            (vendorsResult.data || [])
              .filter(v=>
                String(v.status)
                  .toLowerCase()==="approved"
              ).length

        }
      );

    }catch(error){

      console.error(
        "Dashboard error:",
        error
      );

      return sendError(
        res,
        500,
        "Unable to load hotel dashboard"
      );
    }
  }
);

/*
  Backward compatibility:
  /api/gm/dashboard/:hotel_id

  SECURITY:
  Hotel users may only request their own dashboard.
  Admins may request any hotel's dashboard.
*/

app.get(
  "/api/gm/dashboard/:hotel_id",
  async(req,res)=>{

    const decoded =
      verifyToken(req);

    if(!decoded){

      return sendError(
        res,
        401,
        "Authentication required"
      );
    }

    const requested =
      clean(
        req.params.hotel_id
      );

    if(
      decoded.role === "hotel" &&
      clean(decoded.hotel_id) !== requested
    ){

      return sendError(
        res,
        403,
        "You cannot access another hotel"
      );
    }

    try{

      const [
        hotelResult,
        ordersResult,
        itemsResult
      ] = await Promise.all([

        supa
          .from("hotels")
          .select(SAFE_HOTEL_FIELDS)
          .or(
            `id.eq.${requested},hotel_id.eq.${requested}`
          )
          .limit(1)
          .maybeSingle(),

        supa
          .from("orders")
          .select("*")
          .eq(
            "hotel_id",
            requested
          )
          .order(
            "created_at",
            {
              ascending:false
            }
          )
          .limit(500),

        supa
          .from("hotel_services")
          .select("*")
          .eq(
            "hotel_id",
            requested
          )

      ]);

      if(hotelResult.error)
        throw hotelResult.error;

      if(ordersResult.error)
        throw ordersResult.error;

      if(itemsResult.error)
        throw itemsResult.error;

      const orders =
        ordersResult.data || [];

      const revenue =
        orders.reduce(
          (sum,o)=>
            sum +
            safeNumber(
              o.amount ||
              o.total ||
              0
            ),
          0
        );

      return sendSuccess(
        res,
        {

          hotel:
            hotelResult.data,

          hotel_id:
            requested,

          orders,

          items:
            itemsResult.data || [],

          todayOrders:
            orders.length,

          activeVendors:0,

          revenue

        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load dashboard"
      );
    }
  }
);

/* =========================================================
   HOTEL WHATSAPP SETTINGS
========================================================= */

app.patch(
  "/api/gm/whatsapp",
  requireHotel,
  async(req,res)=>{

    try{

      const payload={};

      const fields=[

        "whatsapp_kitchen",
        "whatsapp_house",
        "whatsapp_housekeeping",
        "whatsapp_laundry",
        "whatsapp_spa",
        "whatsapp_taxi",
        "whatsapp_tours",
        "whatsapp_media",
        "whatsapp_front"

      ];

      fields.forEach(field=>{

        if(
          req.body[field] !== undefined
        ){

          payload[field] =
            cleanText(
              req.body[field],
              30
            );
        }

      });

      if(!Object.keys(payload).length){

        return sendError(
          res,
          400,
          "No WhatsApp fields supplied"
        );
      }

      const {data,error} =
        await supa
          .from("hotels")
          .update(payload)
          .or(
            `id.eq.${req.user.hotel_id},hotel_id.eq.${req.user.hotel_id}`
          )
          .select(SAFE_HOTEL_FIELDS)
          .maybeSingle();

      if(error) throw error;

      return sendSuccess(
        res,
        {
          hotel:data
        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

/* =========================================================
   ORDERS — PUBLIC GUEST CREATE
========================================================= */

app.post(
  "/api/orders",
  async(req,res)=>{

    try{

      const {

        hotel_id,

        room,

        guest_name,

        guest_phone,

        service_id,

        service_title,

        service,

        amount,

        notes,

        category

      } = req.body;

      const hotelId =
        clean(hotel_id);

      if(!hotelId){

        return sendError(
          res,
          400,
          "Hotel ID required"
        );
      }

      if(!room){

        return sendError(
          res,
          400,
          "Room required"
        );
      }

      if(
        !service_title &&
        !service
      ){

        return sendError(
          res,
          400,
          "Service required"
        );
      }

      const numericAmount =
        safePositiveNumber(
          amount
        );

      if(numericAmount === null){

        return sendError(
          res,
          400,
          "Invalid amount"
        );
      }

      /*
        Optional service verification.
        If service_id exists, use database price
        rather than blindly trusting browser price.
      */

      let finalAmount =
        numericAmount;

      let finalTitle =
        cleanText(
          service_title ||
          service,
          150
        );

      let finalCategory =
        cleanText(
          category ||
          "service",
          30
        );

      if(service_id){

        const {data:serviceRow} =
          await supa
            .from("hotel_services")
            .select(
              "id,hotel_id,title,price,category,active"
            )
            .eq(
              "id",
              service_id
            )
            .eq(
              "hotel_id",
              hotelId
            )
            .maybeSingle();

        if(serviceRow){

          if(serviceRow.active === false){

            return sendError(
              res,
              400,
              "This service is currently unavailable"
            );
          }

          finalAmount =
            safeNumber(
              serviceRow.price,
              finalAmount
            );

          finalTitle =
            serviceRow.title;

          finalCategory =
            serviceRow.category ||
            finalCategory;
        }
      }

      const payload={

        hotel_id:hotelId,

        room:
          cleanText(
            room,
            30
          ),

        guest_name:
          cleanText(
            guest_name ||
            "Guest",
            100
          ),

        guest_phone:
          cleanText(
            guest_phone,
            30
          ),

        service_id:
          service_id || null,

        service_title:
          finalTitle,

        service:
          finalTitle,

        amount:
          finalAmount,

        notes:
          cleanText(
            notes,
            500
          ),

        category:
          finalCategory,

        status:"new"

      };

      const {data,error} =
        await supa
          .from("orders")
          .insert([payload])
          .select("*")
          .single();

      if(error) throw error;

      return sendSuccess(
        res,
        {
          order:data
        }
      );

    }catch(error){

      console.error(
        "Create order error:",
        error
      );

      return sendError(
        res,
        500,
        "Unable to create order"
      );
    }
  }
);

/* =========================================================
   HOTEL ORDERS
========================================================= */

app.get(
  "/api/gm/orders",
  requireHotel,
  async(req,res)=>{

    try{

      const {data,error} =
        await supa
          .from("orders")
          .select("*")
          .eq(
            "hotel_id",
            req.user.hotel_id
          )
          .order(
            "created_at",
            {
              ascending:false
            }
          )
          .limit(500);

      if(error) throw error;

      return sendSuccess(
        res,
        {
          orders:data || []
        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load orders"
      );
    }
  }
);

/* =========================================================
   ADMIN ORDERS
========================================================= */

app.get(
  "/api/admin/orders",
  requireAdmin,
  async(req,res)=>{

    try{

      const {data,error} =
        await supa
          .from("orders")
          .select("*")
          .order(
            "created_at",
            {
              ascending:false
            }
          )
          .limit(1000);

      if(error) throw error;

      return res.json(
        data || []
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load orders"
      );
    }
  }
);

/* =========================================================
   ORDER STATUS
========================================================= */

const ORDER_STATUSES=[

  "new",
  "pending",
  "received",
  "confirmed",
  "preparing",
  "ready",
  "completed",
  "delivered",
  "paid",
  "cancelled",
  "rejected"

];

app.patch(
  "/api/gm/orders/:id/status",
  requireHotel,
  async(req,res)=>{

    try{

      const id =
        clean(req.params.id);

      const status =
        cleanText(
          req.body.status,
          30
        ).toLowerCase();

      if(
        !ORDER_STATUSES.includes(status)
      ){

        return sendError(
          res,
          400,
          "Invalid order status"
        );
      }

      const {data,error} =
        await supa
          .from("orders")
          .update({
            status
          })
          .eq(
            "id",
            id
          )
          .eq(
            "hotel_id",
            req.user.hotel_id
          )
          .select("*")
          .maybeSingle();

      if(error) throw error;

      return sendSuccess(
        res,
        {
          order:data
        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

app.patch(
  "/api/admin/orders/:id/status",
  requireAdmin,
  async(req,res)=>{

    try{

      const id =
        clean(req.params.id);

      const status =
        cleanText(
          req.body.status,
          30
        ).toLowerCase();

      if(
        !ORDER_STATUSES.includes(status)
      ){

        return sendError(
          res,
          400,
          "Invalid order status"
        );
      }

      const {data,error} =
        await supa
          .from("orders")
          .update({
            status
          })
          .eq(
            "id",
            id
          )
          .select("*")
          .maybeSingle();

      if(error) throw error;

      return sendSuccess(
        res,
        {
          order:data
        }
      );

    }catch(error){

      console.error(error);

      return sendError(
        res,
        500,
        error.message
      );
    }
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/api/health",
  async(req,res)=>{

    const start =
      Date.now();

    try{

      const {error} =
        await supa
          .from("hotels")
          .select("id")
          .limit(1);

      if(error){

        return res.status(503).json({
          ok:false,
          database:false,
          error:error.message
        });
      }

      return res.json({

        ok:true,

        database:true,

        service:"GuestHub",

        version:"11.0",

        uptime:
          Math.round(
            process.uptime()
          ),

        responseMs:
          Date.now()-start

      });

    }catch(error){

      return res.status(503).json({

        ok:false,

        database:false,

        error:error.message

      });
    }
  }
);

/* =========================================================
   FRONTEND ROUTES
========================================================= */

app.get(
  "/",
  (req,res)=>
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    )
);

/*
  SPA fallback.
  Only return index.html when a browser requests
  a frontend route, never for /api.
*/

app.get(
  "*",
  (req,res,next)=>{

    if(
      req.path.startsWith("/api/")
    ){

      return next();
    }

    return res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (error,req,res,next)=>{

    console.error(
      "Unhandled error:",
      error
    );

    if(
      error.message ===
      "CORS origin not allowed"
    ){

      return res.status(403).json({
        ok:false,
        error:"CORS origin not allowed"
      });
    }

    return res.status(500).json({
      ok:false,
      error:"Internal server error"
    });
  }
);

/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `🚀 GuestHub 11.0 running on port ${PORT}`
    );

    console.log(
      `🌍 Environment: ${process.env.NODE_ENV || "development"}`
    );

    console.log(
      `🛡️ JWT authentication enabled`
    );

    console.log(
      `🏨 Hotel authentication enabled`
    );

    console.log(
      `👑 Admin authentication enabled`
    );

  }
);
