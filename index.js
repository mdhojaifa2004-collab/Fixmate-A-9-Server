
// Express package import করছি
// Express দিয়ে আমাদের Backend Server তৈরি করব
const express = require("express");

// CORS package import করছি
// Frontend থেকে Backend-এ request পাঠানোর অনুমতি নিয়ন্ত্রণ করে
const cors = require("cors");

// .env ফাইল থাকলে লোড করি
// Node-এর built-in loader, তাই আলাদা package লাগে না
try {
  process.loadEnvFile();
} catch {
  // .env না থাকলে নিচের ডিফল্ট মান ব্যবহার হবে
}

// Express application তৈরি করছি
const app = express();

// Server-এর Port নির্ধারণ করছি
// Environment-এ PORT থাকলে সেটি ব্যবহার হবে, না থাকলে 5000
const PORT = process.env.PORT || 5000;

// Middleware

// Frontend থেকে আসা JSON data পড়তে সাহায্য করবে
app.use(express.json());

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

// Server চালু করছি
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
