const express = require("express");
const path = require("path");

// استيراد fetch ديناميكياً
let fetch;
(async () => {
  const nodeFetch = await import("node-fetch");
  fetch = nodeFetch.default;
})();

const app = express();
const PORT = process.env.PORT || 5000;

// واجهة واحدة فقط
app.use(express.static(__dirname));
app.use(express.json());

// فحص متغيرات البيئة
console.log("🔍 فحص متغيرات البيئة:");
console.log("RPC_URL:", process.env.RPC_URL ? "✅ معرف" : "❌ غير معرف");
console.log("RPC_URL2:", process.env.RPC_URL2 ? "✅ معرف" : "❌ غير معرف");
console.log("RPC_URL3:", process.env.RPC_URL3 ? "✅ معرف" : "❌ غير معرف");

const RPC_URLS = [
  process.env.RPC_URL,
  process.env.RPC_URL2,
  process.env.RPC_URL3
].filter(Boolean);

console.log(`📊 عدد الروابط المحملة: ${RPC_URLS.length}`);
console.log("🌐 الروابط المستخدمة:");
RPC_URLS.forEach((url, index) => {
  const maskedUrl = url ? url.substring(0, 30) + "..." : "غير محدد";
  console.log(`  ${index + 1}. ${maskedUrl}`);
});

if (RPC_URLS.length === 0) {
  console.error("❌ خطأ: لم يتم تعيين أي من متغيرات البيئة RPC_URL, RPC_URL2, RPC_URL3");
  process.exit(1);
}

const RENT_EXEMPT_LAMPORTS = 2039280;

// قائمة عناوين المنصات والحسابات المُستبعدة
const EXCLUDED_ADDRESSES = new Set([
  "8psNvWTrdNTiVRNzAgsou9kETXNJm2SXZyaKuJraVRtf",
  "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "11111111111111111111111111111111",
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj",
  "DdZR6zRFiUt4S5mg7AV1uKB2z1f1WzcNYCaTEEWPAuby",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
]);

// تحويل lamports إلى SOL
function lamportsToSol(lamports) {
  return lamports / 1e9;
}

// --- نظام الـ RPC الذكي (نفس كودك السابق، ما غيرته) ---
let requestCounter = 0;
let rpcHealthStatus = {};
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 300;

async function enforceRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastRequestTime = Date.now();
}

function isRpcHealthy(url) {
  const status = rpcHealthStatus[url];
  if (!status) return true;
  if (!status.healthy) {
    const now = Date.now();
    if (now - status.lastFailure > 45000) {
      status.healthy = true;
      return true;
    }
    return false;
  }
  return true;
}

function markRpcUnhealthy(url) {
  rpcHealthStatus[url] = {
    healthy: false,
    lastFailure: Date.now(),
    failures: (rpcHealthStatus[url]?.failures || 0) + 1
  };
}

function markRpcHealthy(url) {
  rpcHealthStatus[url] = {
    healthy: true,
    lastSuccess: Date.now(),
    failures: 0
  };
}

function calculateSmartWait(attempt) {
  const baseWait = 800;
  const multiplier = Math.pow(1.8, attempt - 1);
  const jitter = Math.random() * 1000;
  return Math.min(baseWait * multiplier + jitter, 12000);
}

async function rpc(method, params, maxRetries = 6) {
  if (!fetch) {
    const nodeFetch = await import("node-fetch");
    fetch = nodeFetch.default;
  }
  await enforceRateLimit();

  let lastError;
  let usedUrls = new Set();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const rpcUrl = RPC_URLS[requestCounter % RPC_URLS.length];
      requestCounter++;
      usedUrls.add(rpcUrl);

      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params,
        }),
        timeout: 50000,
      });

      if (!res.ok) {
        markRpcUnhealthy(rpcUrl);
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      markRpcHealthy(rpcUrl);
      return data.result;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const waitTime = calculateSmartWait(attempt);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  console.log(`⏭️ تخطي ${method} مؤقتاً`);
  return null;
}

// --- وظائف مساعدة ---
async function getSolBalance(address) {
  try {
    const result = await rpc("getBalance", [address]);
    const lamports = result?.value || 0;
    return lamportsToSol(lamports);
  } catch {
    return 0;
  }
}

async function getTokenAccounts(owner, mint) {
  try {
    const result = await rpc("getTokenAccountsByOwner", [
      owner,
      { mint },
      { encoding: "jsonParsed" },
    ]);
    return result?.value || [];
  } catch {
    return [];
  }
}

// ✅ هنا التعديل الأساسي: CoinGecko فقط
async function getTokenPrice(mint) {
  try {
    console.log("📊 جلب السعر من CoinGecko فقط...");
    const url = `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=usd`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const price = data[mint]?.usd || 0;

    console.log(`💰 سعر من CoinGecko: $${price}`);
    return price;
  } catch (error) {
    console.error("❌ خطأ في الحصول على السعر:", error);
    return 0;
  }
}

// --- تحليل الحامليـن ---
async function getHolders(mint) {
  console.log(`🔍 بدء البحث عن حاملي التوكن: ${mint}`);
  const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

  try {
    const accounts = await rpc("getProgramAccounts", [
      TOKEN_PROGRAM_ID,
      {
        encoding: "jsonParsed",
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: mint } },
        ],
      },
    ]);

    if (!accounts || !Array.isArray(accounts)) return [];

    const tokenPrice = await getTokenPrice(mint);
    const ownersWithBalance = new Map();

    for (let acc of accounts) {
      const owner = acc.account?.data?.parsed?.info?.owner;
      const tokenAmount = acc.account?.data?.parsed?.info?.tokenAmount;

      if (owner && tokenAmount) {
        const balance = parseFloat(tokenAmount.uiAmount) || 0;
        const valueInUSD = balance * tokenPrice;

        if (valueInUSD >= 10 && !EXCLUDED_ADDRESSES.has(owner)) {
          ownersWithBalance.set(owner, valueInUSD);
        }
      }
    }

    return Array.from(ownersWithBalance.keys());
  } catch (error) {
    console.error("❌ خطأ في getHolders:", error);
    return [];
  }
}

// --- API ---
app.post("/analyze", async (req, res) => {
  const { mint } = req.body;
  console.log(`🚀 بدء تحليل التوكن: ${mint}`);

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const tokenPrice = await getTokenPrice(mint);
    res.write(`data: ${JSON.stringify({ tokenPrice })}\n\n`);

    const walletOwners = await getHolders(mint);
    res.write(`data: ${JSON.stringify({ totalHolders: walletOwners.length })}\n\n`);

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => console.log(`✅ Running on http://localhost:${PORT}`));
