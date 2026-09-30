import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";

const app = express();

const PORT = process.env.PORT || 5000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

app.use(
  cors({
    origin: true,
  }),
);

app.use(express.json());

const packages = {
  portfolio: {
    name: "Portfolio",
    price: 2000,
  },
  business: {
    name: "Business",
    price: 3500,
  },
  ecommerce: {
    name: "E-commerce",
    price: 6000,
  },
  landing: {
    name: "Landing Page",
    price: 2000,
  },
  healthcare: {
    name: "Healthcare",
    price: 4000,
  },
  restaurant: {
    name: "Restaurant",
    price: 4000,
  },
};

const CONTACT = {
  bkash: "01933200699",
  nagad: "01933200699",
  rocket: "01933200699",
  whatsapp: "https://wa.me/8801933200699",
  facebook: "https://www.facebook.com/profile.php?id=61576826618253",
  telegram: "https://t.me/asadulsameer",
};

const makeOrderId = () =>
  `WB-${new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "")}-${String(Date.now()).slice(-5)}`;

const clean = (value, fallback = "—") => String(value ?? "").trim() || fallback;

/* =========================================================
   IMGBB
========================================================= */

async function uploadToImgBB(file) {
  const apiKey = process.env.IMGBB_API_KEY;

  if (!apiKey) {
    throw new Error("ImgBB is not configured. Add IMGBB_API_KEY.");
  }

  if (!file) {
    return null;
  }

  const base64Image = file.buffer.toString("base64");

  const form = new URLSearchParams();

  form.append("key", apiKey);
  form.append("image", base64Image);
  form.append("name", file.originalname || "payment-proof");

  const response = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    body: form,
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    console.error("ImgBB Error:", data);

    throw new Error(
      data?.error?.message || "Failed to upload payment screenshot to ImgBB.",
    );
  }

  return {
    url: data.data.url,
    displayUrl: data.data.display_url,
    deleteUrl: data.data.delete_url,
    thumbUrl: data.data.thumb?.url || data.data.url,
  };
}

/* =========================================================
   TELEGRAM
========================================================= */

async function sendTelegram(order, file) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error(
      "Telegram is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.",
    );
  }

  const hasTransactionId = String(order.transactionId || "").trim().length > 0;

  const hasScreenshot = Boolean(order.paymentScreenshotUrl);

  const payText =
    order.paymentOption === "pay_later"
      ? `💳 Payment: PAY LATER / DISCUSS PAYMENT
Payment proof: Not required now`
      : `💳 Payment: ${order.paymentMethod}
Start: ${order.milestonePercent}%
Pay now: ৳${order.advanceAmount}
Remaining: ৳${order.remainingAmount}
Transaction ID: ${hasTransactionId ? order.transactionId : "Not provided"}
Payment Screenshot: ${
          hasScreenshot ? order.paymentScreenshotUrl : "Not provided"
        }`;

  const caption = `🚀 NEW WEBBUZZ ORDER
━━━━━━━━━━━━━━━━

🆔 Order ID: ${order.orderId}

🕐 ${new Date(order.createdAt).toLocaleString("en-BD", {
    timeZone: "Asia/Dhaka",
  })}

👤 CLIENT
Name: ${clean(order.name)}
Phone: ${clean(order.phone)}
WhatsApp: ${clean(order.whatsapp)}
Email: ${clean(order.email)}

📦 PROJECT
Package: ${order.packageName}
Project Value: ৳${order.totalAmount}

${payText}

🏢 BUSINESS
Business: ${clean(order.businessName)}
Website Type: ${clean(order.website)}
Reference: ${clean(order.reference)}

📝 REQUIREMENT
${clean(order.requirement)}

━━━━━━━━━━━━━━━━
💳 PAYMENT NUMBERS

bKash: ${CONTACT.bkash}
Nagad: ${CONTACT.nagad}
Rocket: ${CONTACT.rocket}

━━━━━━━━━━━━━━━━

🌐 WEBBUZZ BD
WhatsApp: ${CONTACT.whatsapp}
Facebook: ${CONTACT.facebook}
Telegram: ${CONTACT.telegram}`;

  /*
   * Screenshot already uploaded to ImgBB.
   * Telegram will receive the screenshot URL in the message.
   */

  const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: caption,
      disable_web_page_preview: false,
    }),
  });

  const body = await tg.text();

  if (!tg.ok) {
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }
}

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Webbuzz BD API",
    imgbb: Boolean(process.env.IMGBB_API_KEY),
    telegram: Boolean(
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
    ),
  });
});

/* =========================================================
   CREATE ORDER
========================================================= */

app.post("/api/orders", upload.single("screenshot"), async (req, res) => {
  try {
    const {
      packageId,
      name,
      phone,
      email,
      businessName,
      requirement,
      paymentOption,
    } = req.body;

    const pkg = packages[packageId];

    if (!pkg) {
      return res.status(400).json({
        message: "Invalid package.",
      });
    }

    if (!name || !phone || !email || !businessName || !requirement) {
      return res.status(400).json({
        message: "Please complete all required fields.",
      });
    }

    if (!["pay_20", "pay_30", "pay_later"].includes(paymentOption)) {
      return res.status(400).json({
        message: "Invalid payment option.",
      });
    }

    const milestonePercent =
      paymentOption === "pay_20" ? 20 : paymentOption === "pay_30" ? 30 : 0;

    const advanceAmount = Math.round((pkg.price * milestonePercent) / 100);

    const remainingAmount = pkg.price - advanceAmount;

    /* =====================================================
         PAYMENT PROOF VALIDATION
      ===================================================== */

    const hasTransactionId =
      String(req.body.transactionId || "").trim().length > 0;

    const hasScreenshot = Boolean(req.file);

    if (paymentOption !== "pay_later" && !hasTransactionId && !hasScreenshot) {
      return res.status(400).json({
        message: "Please provide either Transaction ID or payment screenshot.",
      });
    }

    if (paymentOption === "pay_later" && (hasTransactionId || hasScreenshot)) {
      return res.status(400).json({
        message: "Payment proof should not be submitted for Pay Later.",
      });
    }

    /* =====================================================
         UPLOAD SCREENSHOT TO IMGBB
      ===================================================== */

    let imageData = null;

    if (req.file) {
      imageData = await uploadToImgBB(req.file);
    }

    /* =====================================================
         ORDER OBJECT
      ===================================================== */

    const order = {
      orderId: makeOrderId(),

      status: "New",

      createdAt: new Date().toISOString(),

      packageId,

      packageName: pkg.name,

      totalAmount: pkg.price,

      paymentOption,

      milestonePercent,

      advanceAmount,

      remainingAmount,

      name: clean(name, ""),

      phone: clean(phone, ""),

      whatsapp: clean(req.body.whatsapp, ""),

      email: clean(email, ""),

      businessName: clean(businessName, ""),

      website: clean(req.body.website, ""),

      reference: clean(req.body.reference, ""),

      requirement: clean(requirement, ""),

      paymentMethod:
        paymentOption === "pay_later"
          ? "Pay Later"
          : clean(req.body.paymentMethod),

      transactionId:
        paymentOption === "pay_later" ? "" : clean(req.body.transactionId, ""),

      paymentScreenshotUrl: imageData?.url || "",

      paymentScreenshotDisplayUrl: imageData?.displayUrl || "",

      paymentScreenshotThumb: imageData?.thumbUrl || "",

      paymentScreenshotDeleteUrl: imageData?.deleteUrl || "",
    };

    /* =====================================================
         SEND TELEGRAM
      ===================================================== */

    await sendTelegram(order, req.file || null);

    /* =====================================================
         RESPONSE
      ===================================================== */

    return res.status(201).json({
      ok: true,

      message: "Order received, screenshot uploaded and sent to Telegram.",

      order,
    });
  } catch (error) {
    console.error("ORDER ERROR:", error);

    return res.status(500).json({
      ok: false,

      message: error.message || "Server error while creating order.",
    });
  }
});

/* =========================================================
   SERVER
========================================================= */

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Webbuzz API running on http://localhost:${PORT}`);
  });
}

export default app;
