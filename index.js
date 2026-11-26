const { MongoClient } = require("mongodb");
// import { MongoClient } from 'mongodb';
require("dotenv/config");

// Node-এর DNS resolver কখনো কখনো MongoDB-এর SRV record resolve করতে পারে না।
// .env-এ DNS_SERVERS থাকলে সেটি ব্যবহার করব (না থাকলে সিস্টেম ডিফল্ট)।
const dns = require("dns");

if (process.env.DNS_SERVERS) {
  dns.setServers(
    process.env.DNS_SERVERS.split(",")
      .map((server) => server.trim())
      .filter(Boolean)
  );
}

// Express package import করছি
// Express দিয়ে আমাদের Backend Server তৈরি করব
const express = require("express");

// Frontend থেকে Backend-এ request পাঠানোর অনুমতি নিয়ন্ত্রণ করে
const cors = require("cors");

// Express application তৈরি করছি
const app = express();

// Server-এর Port নির্ধারণ করছি
// Environment-এ PORT থাকলে সেটি ব্যবহার হবে, না থাকলে 5000
const PORT = process.env.PORT || 5000;

// Middleware


// MongoDB URI বানানোর আগে required env variable গুলো যাচাই করি।
// Error message-এ শুধু variable name থাকে — কোনো secret value print হয় না।
const REQUIRED_DB_ENV = ["DB_USER_URL", "DB_PASSWORD_URL"];
const missingDbEnv = REQUIRED_DB_ENV.filter((name) => {
  const value = process.env[name];
  return !value || !value.trim();
});

if (missingDbEnv.length > 0) {
  throw new Error(
    `Missing required MongoDB environment variable(s): ${missingDbEnv.join(
      ", "
    )}. Add them to the backend .env file.`
  );
}

// Better Auth session verification-এর জন্য Next.js app-এর base URL দরকার।
// Missing হলে শুধু variable-এর নাম দেখানো হয় — কোনো secret value নয়।
if (!process.env.BETTER_AUTH_URL || !process.env.BETTER_AUTH_URL.trim()) {
  throw new Error(
    "BETTER_AUTH_URL is not set in the backend .env (example: http://localhost:3000)"
  );
}

const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL.trim().replace(/\/+$/, "");

// Template literal (backtick) দিয়ে env value বসাতে হবে — সাধারণ string-এ
// ${...} interpolate হয় না, তাহলে লিটারাল "${...}" username যায় এবং
// "bad auth: Authentication failed" হয়।
// Username/password-এ বিশেষ চিহ্ন (@ : / $ ইত্যাদি) থাকলে URL-encode করা হয়।
const MONGO_URI = `mongodb+srv://${encodeURIComponent(process.env.DB_USER_URL)}:${encodeURIComponent(process.env.DB_PASSWORD_URL)}@cluster0.wjo89lz.mongodb.net/`;

const client = new MongoClient(MONGO_URI);

// DB_NAME না থাকলে বা খালি থাকলে "fixmate" fallback ব্যবহার হবে
const DB_NAME = process.env.DB_NAME?.trim() || "fixmate";

// Frontend থেকে আসা JSON data পড়তে সাহায্য করবে
app.use(express.json());

let db = null;

// MongoDB-তে connect করে এবং ping দিয়ে যাচাই করে db handle রাখে
async function connectToMongoDB() {
  await client.connect();
  await client.db("admin").command({ ping: 1 });
  db = client.db(DB_NAME);
  console.log(`MongoDB connected (database: ${DB_NAME})`);
  return db;
}

// MongoDB connection শুধু startServer()-এর ভিতরে একবার হবে,
// server listen করার আগে। (module load-এ আলাদা connection attempt নেই)

// কোন কোন frontend origin থেকে request আসতে পারবে
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim());

// Frontend থেকে আসা cross-origin request গ্রহণ করতে সাহায্য করবে
app.use(
  cors({
    origin(origin, callback) {
      // Postman/curl-এর মতো origin-হীন request-ও অনুমতি পাবে
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);

// Frontend-এর সঙ্গে Connection Test API
app.get("/api/message", (req, res) => {
  res.json({
    success: true,
    message: "Frontend successfully connected with Backend!",
  });
});
// Home Route
// Browser-এ localhost:5000 লিখলে এই route কাজ করবে
app.get("/", (req, res) => {
  res.send("Hello from the server!");
});

// Dashboard Route
// Browser-এ localhost:5000/dashboard লিখলে এই route কাজ করবে
app.get("/dashboard", (req, res) => {
  res.send("Welcome to the dashboard!");
});

// CORS বা অন্য error-এর জন্য পরিষ্কার JSON response
// Database connect না থাকলে 503 ফেরত দেয়
function requireDatabase(res) {
  if (db) return true;

  res.status(503).json({
    success: false,
    message: "Database not connected",
  });
  return false;
}

// MongoDB connection-এর সত্যিকারের অবস্থা
app.get("/api/db-status", async (req, res) => {
  if (!requireDatabase(res)) return;

  const ping = await client.db("admin").command({ ping: 1 });

  res.json({
    success: true,
    database: DB_NAME,
    ping: ping.ok,
  });
});

app.get("/api/test", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Frontend and Backend connected successfully!",
  });
});

// Frontend থেকে আসা data MongoDB-তে save করে
app.post("/api/connection-tests", async (req, res) => {
  if (!requireDatabase(res)) return;

  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";

  if (!note) {
    res.status(400).json({
      success: false,
      message: "note is required",
    });
    return;
  }

  const result = await db.collection("connection_tests").insertOne({
    note,
    createdAt: new Date(),
  });

  res.status(201).json({
    success: true,
    insertedId: result.insertedId,
    note,
  });
});

// MongoDB থেকে data এনে frontend-এ পাঠায়
app.get("/api/connection-tests", async (req, res) => {
  if (!requireDatabase(res)) return;

  const items = await db
    .collection("connection_tests")
    .find({})
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  res.json({
    success: true,
    count: items.length,
    items,
  });
});

// ---- Booking validation helpers ----
// ব্যবহারিক email regex: consecutive dot, missing TLD, ভুল domain label reject করে
const EMAIL_PATTERN =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

// BD mobile (01[3-9]XXXXXXXX / +880...), international (+... বা 00...) এবং
// দেশীয় ৭–১৫ ডিজিটের নম্বর — space, hyphen, bracket, dot separator হিসেবে চলবে
const PHONE_PATTERN =
  /^(?:\+?880|0)1[3-9]\d{8}$|^(?:\+|00)[1-9]\d{6,14}$|^[1-9]\d{6,14}$/;

// ফোন যাচাইয়ের আগে separator গুলো বাদ দেওয়া হয়
function normalizePhone(value) {
  return value.replace(/[\s().-]/g, "");
}

// YYYY-MM-DD এবং বাস্তব calendar date কিনা (যেমন 2026-02-30 invalid)
function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

// সব booking validation error একই shape-এ 400 দেয়
function sendBookingError(res, message) {
  res.status(400).json({ success: false, message });
}

// নতুন repair booking request MongoDB-তে save করে
// Assignment 9-এর field গুলো সব store হয়, পুরোনো client-এর field-ও রাখা হয় (compatibility)
app.post("/api/bookings", async (req, res) => {
  if (!requireDatabase(res)) return;

  try {
    const body = req.body ?? {};

    // string field trim করে নেয়, non-string হলে খালি string
    const asString = (value) =>
      typeof value === "string" ? value.trim() : "";

    // price শুধু non-negative finite number হলে গ্রহণ করা হয়
    const asPrice = (value) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null;

    const serviceTitle =
      asString(body.serviceTitle) || asString(body.serviceName);
    const day = asString(body.day);
    const time = asString(body.time);
    const preferredDateInput = asString(body.preferredDate);
    const preferredDate = preferredDateInput || day;

    // পুরোনো API-তে serviceName/day/time লাগত; নতুন API-তে preferredDate হলেও চলে,
    // তাই service identity আর একটি date বাধ্যতামূলক রাখা হয়েছে (পুরোনো payload কাজ করবে)
    if (!serviceTitle) {
      return sendBookingError(
        res,
        "serviceTitle (or serviceName) is required"
      );
    }

    if (!preferredDate) {
      return sendBookingError(res, "preferredDate (or day) is required");
    }

    // preferredDate দেওয়া থাকলে অবশ্যই বৈধ YYYY-MM-DD হতে হবে
    if (body.preferredDate !== undefined && !isValidIsoDate(preferredDateInput)) {
      return sendBookingError(
        res,
        "preferredDate must be a valid date in YYYY-MM-DD format"
      );
    }

    // basePrice না থাকলে পুরোনো price field fallback হিসেবে ব্যবহৃত হয়
    const basePriceInput =
      body.basePrice !== undefined ? body.basePrice : body.price;
    const basePrice = asPrice(basePriceInput);

    if (basePriceInput !== undefined && basePrice === null) {
      return sendBookingError(
        res,
        "basePrice (or price) must be a non-negative number"
      );
    }

    const customerName = asString(body.customerName);
    const customerEmail = asString(body.customerEmail);
    const customerPhone = asString(body.customerPhone);
    const technicianName = asString(body.technicianName);
    const technicianEmail = asString(body.technicianEmail);
    const addressInput = asString(body.address);
    const serviceArea = asString(body.serviceArea);
    const address = addressInput || serviceArea;
    const problemDescription = asString(body.problemDescription);

    if (
      body.customerEmail !== undefined &&
      (!customerEmail || !EMAIL_PATTERN.test(customerEmail))
    ) {
      return sendBookingError(
        res,
        "customerEmail is not a valid email address"
      );
    }

    if (
      body.technicianEmail !== undefined &&
      (!technicianEmail || !EMAIL_PATTERN.test(technicianEmail))
    ) {
      return sendBookingError(
        res,
        "technicianEmail is not a valid email address"
      );
    }

    if (body.customerPhone !== undefined) {
      if (!customerPhone || !PHONE_PATTERN.test(normalizePhone(customerPhone))) {
        return sendBookingError(
          res,
          "customerPhone is not a valid Bangladesh or international phone number"
        );
      }
    }

    // explicit address দিলে অন্তত ১০ অক্ষরের হতে হবে (legacy serviceArea fallback অপরিবর্তিত)
    if (body.address !== undefined && addressInput.length < 10) {
      return sendBookingError(res, "address must be at least 10 characters");
    }

    // problemDescription দিলে অন্তত ২০ অক্ষরের হতে হবে
    if (
      body.problemDescription !== undefined &&
      problemDescription.length < 20
    ) {
      return sendBookingError(
        res,
        "problemDescription must be at least 20 characters"
      );
    }

    const now = new Date();

    const booking = {
      // পুরোনো field — existing client/UI compatibility
      serviceId:
        typeof body.serviceId === "string" || typeof body.serviceId === "number"
          ? body.serviceId
          : null,
      serviceName: serviceTitle,
      day: day || preferredDate,
      time,
      price: basePrice,
      serviceArea: serviceArea || address || null,
      payment: "unpaid",

      // Assignment 9 fields
      customerName: customerName || null,
      customerEmail: customerEmail || null,
      customerPhone: customerPhone || null,
      technicianName: technicianName || null,
      technicianEmail: technicianEmail || null,
      serviceTitle,
      serviceImage: asString(body.serviceImage) || null,
      category: asString(body.category) || null,
      basePrice,
      address: address || null,
      preferredDate,
      problemDescription: problemDescription || null,
      status: "requested",
      paymentStatus: "unpaid",
      finalAmount: basePrice,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection("bookings").insertOne(booking);

    res.status(201).json({
      success: true,
      booking: { _id: result.insertedId, ...booking },
    });
  } catch (err) {
    // Client-কে internal error detail দেখানো হয় না — শুধু server log-এ থাকে
    console.error("Booking creation failed:", err.message);
    res.status(500).json({
      success: false,
      message: "Failed to create booking. Please try again later.",
    });
  }
});

// MongoDB থেকে সাম্প্রতিক bookings পাঠায়
app.get("/api/bookings", async (req, res) => {
  if (!requireDatabase(res)) return;

  const items = await db
    .collection("bookings")
    .find({})
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  res.json({
    success: true,
    count: items.length,
    items,
  });
});

// ---- Better Auth session verification ----
// Next.js-এর Better Auth endpoint-এ incoming Cookie header forward করে session যাচাই হয়।
// Cookie/token কোনো log বা response-এ রাখা হয় না।
async function getBetterAuthSession(cookieHeader) {
  const response = await fetch(`${BETTER_AUTH_URL}/api/auth/get-session`, {
    headers: { cookie: cookieHeader },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return null;

  const data = await response.json().catch(() => null);
  if (!data || !data.user || !data.user.id) return null;

  return data;
}

// Reusable middleware: valid session না থাকলে 401, থাকলে verified identity req.user-এ রাখে।
// Request body-র কোনো customer identity এখানে পড়া বা বিশ্বাস করা হয় না।
async function requireAuth(req, res, next) {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  try {
    const session = await getBetterAuthSession(cookieHeader);

    if (!session) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // শুধু verified id, name, email রাখা হয়
    req.user = {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
    };

    next();
  } catch (err) {
    // Cookie/token log করা হয় না — শুধু generic server-side message
    console.error("Session verification failed:", err.message);
    res.status(401).json({ success: false, message: "Unauthorized" });
  }
}

// Session যাচাইয়ের ছোট protected route — শুধু verified identity ফেরত দেয়
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

// অজানা API route-এর জন্য পরিষ্কার 404
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// CORS package import করছি
app.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  // ভাঙা JSON body → generic 400, parser-এর internal message expose করা হয় না
  if (
    err.type === "entity.parse.failed" ||
    (err instanceof SyntaxError && err.status === 400)
  ) {
    res.status(400).json({
      success: false,
      message: "Invalid JSON body",
    });
    return;
  }

  const isCorsError = err.message && err.message.includes("not allowed by CORS");

  res.status(isCorsError ? 403 : 500).json({
    success: false,
    message: err.message || "Server error",
  });
});

// Server চালু করছি
async function startServer() {
  try {
    await connectToMongoDB();
  } catch (err) {
    // Database না থাকলেও server চলবে, DB route গুলো 503 দেবে
    console.error("MongoDB connection failed:", err.message);
  }

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer();
