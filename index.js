const express = require("express");
const path = require("path");

// استيراد fetch ديناميكياً
let fetch;
(async () => {
  const nodeFetch = await import('node-fetch');
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
].filter(Boolean); // إزالة القيم الفارغة

console.log(`📊 عدد الروابط المحملة: ${RPC_URLS.length}`);
console.log("🌐 الروابط المستخدمة:");
RPC_URLS.forEach((url, index) => {
  const maskedUrl = url ? url.substring(0, 30) + "..." : "غير محدد";
  console.log(`  ${index + 1}. ${maskedUrl}`);
});

// التحقق من وجود روابط RPC صحيحة
if (RPC_URLS.length === 0) {
  console.error("❌ خطأ: لم يتم تعيين أي من متغيرات البيئة RPC_URL, RPC_URL2, RPC_URL3");
  process.exit(1);
}
const RENT_EXEMPT_LAMPORTS = 2039280; // تقريبي لحسابات التوكن

// قائمة عناوين المنصات والحسابات المُستبعدة
const EXCLUDED_ADDRESSES = new Set([
  "8psNvWTrdNTiVRNzAgsou9kETXNJm2SXZyaKuJraVRtf", // منصة
  "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC", // منصة
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", // Raydium Authority V4
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM Program V4
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", // Raydium Liquidity Pool V4
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token Program
  "11111111111111111111111111111111", // System Program
  "So11111111111111111111111111111111111111112", // Wrapped SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // Marinade staked SOL
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // Lido staked SOL
  "DdZR6zRFiUt4S5mg7AV1uKB2z1f1WzcNYCaTEEWPAuby", // Jupiter Aggregator V6
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter Token
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // Pump.fun Program
]);

// متغير لتتبع توزيع الطلبات
let requestCounter = 0;
let rpcHealthStatus = {}; // تتبع حالة كل RPC
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 300; // الحد الأدنى بين الطلبات (300ms)

// تحويل lamports إلى SOL
function lamportsToSol(lamports) {
  return lamports / 1e9;
}

// اختيار RPC URL بالتناوب (يتكيف مع عدد الروابط المتاحة)
function getNextRpcUrl() {
  if (RPC_URLS.length === 0) {
    throw new Error('لا توجد روابط RPC متاحة');
  }
  
  const index = requestCounter % RPC_URLS.length;
  const url = RPC_URLS[index];
  requestCounter++;
  
  // تحديد اسم الرابط بناء على الفهرس
  let linkName;
  if (index === 0) linkName = 'الرابط الأول';
  else if (index === 1) linkName = 'الرابط الثاني';
  else if (index === 2) linkName = 'الرابط الثالث';
  else linkName = `الرابط ${index + 1}`;
  
  console.log(`🌐 استخدام RPC: ${linkName} (فهرس: ${index}/${RPC_URLS.length - 1}, الطلب #${requestCounter})`);
  console.log(`📝 URL المختصر: ${url ? url.substring(0, 40) + '...' : 'غير محدد'}`);
  
  return url;
}

// دوال مساعدة للمعالجة الذكية
async function enforceRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRequestTime = Date.now();
}

function getSmartRpcUrl(usedUrls, attempt) {
  if (RPC_URLS.length === 0) return null;
  
  // فلترة الروابط الصحية فقط
  const healthyUrls = RPC_URLS.filter(url => 
    !usedUrls.has(url) && isRpcHealthy(url)
  );
  
  if (healthyUrls.length === 0) {
    // إذا لم توجد روابط صحية، استخدم أي رابط متاح
    const availableUrls = RPC_URLS.filter(url => !usedUrls.has(url));
    if (availableUrls.length === 0) return null;
    
    const index = (requestCounter + attempt) % availableUrls.length;
    requestCounter++;
    return availableUrls[index];
  }
  
  const index = (requestCounter + attempt) % healthyUrls.length;
  requestCounter++;
  return healthyUrls[index];
}

function isRpcHealthy(url) {
  const status = rpcHealthStatus[url];
  if (!status) return true; // اعتبار الروابط الجديدة صحية
  
  // إذا كان غير صحي، تحقق من انقضاء فترة العقاب
  if (!status.healthy) {
    const now = Date.now();
    if (now - status.lastFailure > 45000) { // 45 ثانية عقاب
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
  // انتظار متدرج ذكي
  const baseWait = 800; // 0.8 ثانية
  const multiplier = Math.pow(1.8, attempt - 1);
  const jitter = Math.random() * 1000; // عشوائية لتجنب التحميل المتزامن
  
  return Math.min(baseWait * multiplier + jitter, 12000); // حد أقصى 12 ثانية
}

function isRecoverableError(error) {
  const recoverableMessages = [
    'rate limit',
    'too many requests', 
    'temporary',
    'timeout',
    'connection',
    'network',
    'unavailable'
  ];
  
  const errorMsg = (error.message || error.toString()).toLowerCase();
  return recoverableMessages.some(msg => errorMsg.includes(msg));
}

function getDefaultValue(method) {
  // قيم افتراضية لتجنب الأخطاء
  switch (method) {
    case 'getBalance': return { value: 0 };
    case 'getTokenAccountsByOwner': return { value: [] };
    case 'getSignaturesForAddress': return [];
    case 'getTransaction': return null;
    default: return null;
  }
}

// معالجة ذكية لـ RPC بدون أخطاء
async function rpc(method, params, maxRetries = 6) {
  if (!fetch) {
    const nodeFetch = await import('node-fetch');
    fetch = nodeFetch.default;
  }

  // تنظيم الطلبات بالانتظار الذكي
  await enforceRateLimit();

  let lastError;
  let usedUrls = new Set(); // تتبع الروابط المستخدمة

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const rpcUrl = getSmartRpcUrl(usedUrls, attempt);
      if (!rpcUrl) {
        // إذا لم توجد روابط متاحة، انتظر وأعد المحاولة
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        usedUrls.clear(); // إعادة تعيين الروابط المستخدمة
        continue;
      }
      
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
        timeout: 50000, // زيادة timeout
      });

      // معالجة خاصة لـ 429 بدون عرض خطأ
      if (res.status === 429) {
        markRpcUnhealthy(rpcUrl);
        const smartWait = calculateSmartWait(attempt);
        await new Promise(resolve => setTimeout(resolve, smartWait));
        continue;
      }

      if (!res.ok) {
        markRpcUnhealthy(rpcUrl);
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      if (data.error) {
        // بعض أخطاء RPC طبيعية، لا نعتبرها فشل
        if (isRecoverableError(data.error)) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue;
        }
        throw new Error(`RPC Error: ${data.error.message || data.error}`);
      }

      // تحديث حالة RPC كـ healthy عند النجاح
      markRpcHealthy(rpcUrl);
      return data.result;

    } catch (error) {
      lastError = error;
      
      // تسجيل صامت للمحاولات الوسطية
      if (attempt === maxRetries) {
        console.log(`🔄 معالجة ${method} (${attempt}/${maxRetries})`);
      }

      if (attempt < maxRetries) {
        const waitTime = calculateSmartWait(attempt);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // إذا فشلت جميع المحاولات، إرجاع قيمة افتراضية بدلاً من خطأ
  console.log(`⏭️ تخطي ${method} مؤقتاً - سيعاد المحاولة لاحقاً`);
  return getDefaultValue(method);
}

// احصل على رصيد محفظة SOL مع معالجة ذكية
async function getSolBalance(address, maxRetries = 2) {
  try {
    const result = await rpc("getBalance", [address]);
    const lamports = result?.value || result || 0;
    return lamportsToSol(lamports);
  } catch (error) {
    // رجوع صامت لقيمة افتراضية
    console.log(`🔄 معالجة رصيد ${address.substring(0, 8)}...`);
    return 0; // قيمة افتراضية بدلاً من خطأ
  }
}

// احصل على حسابات التوكن مع معالجة ذكية
async function getTokenAccounts(owner, mint, maxRetries = 2) {
  try {
    const result = await rpc("getTokenAccountsByOwner", [
      owner,
      { mint },
      { encoding: "jsonParsed" },
    ]);
    return result?.value || [];
  } catch (error) {
    // رجوع صامت لقائمة فارغة
    console.log(`🔄 معالجة حسابات ${owner.substring(0, 8)}...`);
    return []; // قائمة فارغة بدلاً من خطأ
  }
}

// احصل على سعر التوكن بالدولار
async function getTokenPrice(mint, serverSource = 'dexscreener') {
  try {
    if (serverSource === 'pumpfun') {
      // استخدم PumpFun فقط
      console.log("🚀 استخدام PumpFun فقط...");
      return await getPumpFunPrice(mint);
    }

    if (serverSource === 'dexscreener') {
      // استخدم DexScreener فقط
      console.log("📊 استخدام DexScreener فقط...");
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      const data = await response.json();

      if (data.pairs && data.pairs.length > 0) {
        const price = parseFloat(data.pairs[0].priceUsd) || 0;
        console.log(`💰 سعر من DexScreener: $${price}`);
        return price;
      } else {
        console.log("❌ لم يتم العثور على السعر في DexScreener");
        return 0;
      }
    }

    // الافتراضي: استخدم كلاهما (DexScreener أولاً ثم PumpFun)
    console.log("🔄 استخدام كلا الخادمين...");
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await response.json();

    if (data.pairs && data.pairs.length > 0) {
      const price = parseFloat(data.pairs[0].priceUsd) || 0;
      console.log(`💰 سعر من DexScreener: $${price}`);
      return price;
    }

    // إذا لم يجد في DexScreener، جرب Jupiter API ثم PumpFun
    console.log("🔍 لم يتم العثور على السعر في DexScreener، محاولة Jupiter API...");
    const jupiterPrice = await getJupiterPrice(mint);
    if (jupiterPrice > 0) {
      return jupiterPrice;
    }
    
    console.log("🔍 لم يتم العثور على السعر في Jupiter، محاولة PumpFun...");
    return await getPumpFunPrice(mint);

  } catch (error) {
    console.error("خطأ في الحصول على سعر التوكن:", error);

    if (serverSource === 'both') {
      // محاولة Jupiter ثم PumpFun كبديل إذا كان الإعداد "كلاهما"
      try {
        console.log("🔍 محاولة Jupiter API كبديل...");
        const jupiterPrice = await getJupiterPrice(mint);
        if (jupiterPrice > 0) {
          return jupiterPrice;
        }
        
        console.log("🔍 محاولة PumpFun API كبديل أخير...");
        return await getPumpFunPrice(mint);
      } catch (backupError) {
        console.error("خطأ في الحصول على سعر التوكن من المصادر الاحتياطية:", backupError);
        return 0;
      }
    }

    return 0;
  }
}

// احصل على سعر التوكن من PumpFun
async function getPumpFunPrice(mint) {
  try {
    console.log(`🚀 البحث عن سعر التوكن ${mint} في PumpFun...`);

    // استخدام REST API بدلاً من WebSocket للبساطة
    const response = await fetch(`https://frontend-api.pump.fun/coins/${mint}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data && data.usd_market_cap && data.total_supply) {
      // حساب السعر من market cap و total supply
      const price = data.usd_market_cap / data.total_supply;
      console.log(`💰 سعر من PumpFun: $${price}`);
      return price;
    }

    // إذا لم توجد البيانات المطلوبة، جرب من خلال virtual_sol_reserves
    if (data && data.virtual_sol_reserves && data.virtual_token_reserves) {
      // تحويل SOL إلى USD (افتراض 1 SOL = $150 تقريباً)
      const SOL_PRICE = 150; // يمكن تحديثه لاحقاً من API منفصل
      const price = (data.virtual_sol_reserves * SOL_PRICE) / data.virtual_token_reserves;
      console.log(`💰 سعر محسوب من reserves في PumpFun: $${price}`);
      return price;
    }

    console.log("⚠️ لم يتم العثور على بيانات السعر في PumpFun");
    return 0;

  } catch (error) {
    console.error("خطأ في الحصول على سعر التوكن من PumpFun:", error);
    return 0;
  }
}

// دالة للحصول على سعر التوكن من Jupiter API
async function getJupiterPrice(mint) {
  try {
    console.log(`🪐 البحث عن سعر التوكن ${mint} في Jupiter...`);

    const response = await fetch(`https://price.jup.ag/v6/price?ids=${mint}`, {
      timeout: 10000 // timeout 10 ثوان
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data && data.data && data.data[mint] && data.data[mint].price) {
      const price = parseFloat(data.data[mint].price);
      console.log(`💰 سعر من Jupiter: $${price}`);
      return price;
    }

    console.log("⚠️ لم يتم العثور على بيانات السعر في Jupiter");
    return 0;

  } catch (error) {
    console.error("خطأ في الحصول على سعر التوكن من Jupiter:", error);
    return 0;
  }
}

// احصل على قائمة المحافظ المالكة للتوكن مع فلتر 10$ كحد أدنى
async function getHolders(mint) {
  console.log(`🔍 بدء البحث عن حاملي التوكن: ${mint}`);

  // استخدام getProgramAccounts للحصول على جميع حسابات التوكن
  const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

  try {
    console.log("📡 إرسال طلب getProgramAccounts...");
    const accounts = await rpc("getProgramAccounts", [
      TOKEN_PROGRAM_ID,
      {
        encoding: "jsonParsed",
        filters: [
          {
            dataSize: 165, // حجم حساب التوكن
          },
          {
            memcmp: {
              offset: 0, // موضع عنوان المنت
              bytes: mint,
            },
          },
        ],
      },
    ]);

    console.log("📊 استجابة getProgramAccounts:", {
      type: typeof accounts,
      isArray: Array.isArray(accounts),
      length: accounts?.length || 0,
      sample: accounts?.[0] || null
    });

    if (!accounts || !Array.isArray(accounts)) {
      console.error("❌ فشل في الحصول على حسابات التوكن:", accounts);
      return [];
    }

    // الحصول على سعر التوكن
    console.log("💰 جلب سعر التوكن...");
    const tokenPrice = await getTokenPrice(mint);
    console.log(`💲 سعر التوكن: $${tokenPrice}`);

    const ownersWithBalance = new Map();
    let processedAccounts = 0;
    let validAccounts = 0;
    let qualifiedHolders = 0;
    let excludedPlatforms = 0;

    console.log(`🔄 معالجة ${accounts.length} حساب...`);

    for (let acc of accounts) {
      processedAccounts++;
      try {
        const owner = acc.account?.data?.parsed?.info?.owner;
        const tokenAmount = acc.account?.data?.parsed?.info?.tokenAmount;

        if (owner && tokenAmount) {
          validAccounts++;
          const balance = parseFloat(tokenAmount.uiAmount) || 0;
          const valueInUSD = balance * tokenPrice;

          // تحقق من القيمة أولاً
          if (valueInUSD >= 10) {
            // تحقق من عناوين المنصات المُستبعدة
            if (EXCLUDED_ADDRESSES.has(owner)) {
              excludedPlatforms++;
            } else {
              qualifiedHolders++;
              if (ownersWithBalance.has(owner)) {
                ownersWithBalance.set(owner, ownersWithBalance.get(owner) + valueInUSD);
              } else {
                ownersWithBalance.set(owner, valueInUSD);
              }
            }
          }
        }
      } catch (error) {
        console.error(`❌ خطأ في معالجة الحساب ${processedAccounts}:`, error);
      }
    }

    console.log(`✅ انتهاء المعالجة:`, {
      processedAccounts,
      validAccounts,
      qualifiedHolders,
      excludedPlatforms,
      uniqueHolders: ownersWithBalance.size
    });

    return Array.from(ownersWithBalance.keys());

  } catch (error) {
    console.error("❌ خطأ في getHolders:", error);
    return [];
  }
}

// احصل على مالك حساب توكن
async function getOwnerOfTokenAccount(accountPubkey) {
  const result = await rpc("getAccountInfo", [accountPubkey, { encoding: "jsonParsed" }]);
  return result?.value?.data?.parsed?.info?.owner || null;
}

// فحص ما إذا كان للمحفظة نشاط في Pump.fun
async function hasPumpFunActivity(owner, maxRetries = 3) {
  const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
  const VALID_OPERATION_TYPES = ['create', 'buy', 'sell'];
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔍 فحص نشاط Pump.fun للمحفظة ${owner} - محاولة ${attempt}/${maxRetries}`);
      
      // جلب آخر 20 معاملة للمحفظة
      const signatures = await rpc("getSignaturesForAddress", [owner, { limit: 20 }], 2);
      
      if (!signatures || signatures.length === 0) {
        console.log(`⏭️ لا توجد معاملات للمحفظة ${owner}`);
        return false;
      }
      
      console.log(`📜 تم العثور على ${signatures.length} معاملة، فحص التفاصيل...`);
      
      // فحص كل معاملة للبحث عن برنامج Pump.fun
      for (let i = 0; i < signatures.length; i++) {
        try {
          const signature = signatures[i].signature;
          
          // جلب تفاصيل المعاملة
          const transaction = await rpc("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }], 2);
          
          if (transaction && transaction.transaction && transaction.transaction.message && transaction.transaction.message.instructions) {
            const instructions = transaction.transaction.message.instructions;
            
            // فحص كل instruction في المعاملة
            for (let instruction of instructions) {
              // التحقق من أن programId يطابق Pump.fun
              if (instruction.programId === PUMP_FUN_PROGRAM) {
                // فحص ما إذا كان للتعليمة parsed data ونوع عملية صحيح
                if (instruction.parsed && instruction.parsed.type) {
                  const operationType = instruction.parsed.type.toLowerCase();
                  
                  if (VALID_OPERATION_TYPES.includes(operationType)) {
                    console.log(`✅ تم العثور على عملية Pump.fun صحيحة (${operationType}) في المعاملة ${signature} للمحفظة ${owner}`);
                    return true;
                  }
                }
                
                // في حالة عدم وجود parsed data، قد تكون العملية مشفرة
                // نفحص ما إذا كان البرنامج صحيح على الأقل
                console.log(`🔍 تم العثور على تعليمة Pump.fun في المعاملة ${signature} للمحفظة ${owner} لكن بدون parsed data`);
                
                // يمكن أن نقبل العملية إذا كان البرنامج صحيح حتى لو لم نستطع تحليل النوع
                // أو يمكن أن نكون أكثر صرامة ونرفضها
                // للأمان، سنقبلها إذا كان البرنامج صحيح
                console.log(`✅ تم قبول عملية Pump.fun غير محللة في المعاملة ${signature} للمحفظة ${owner}`);
                return true;
              }
            }
          }
        } catch (txError) {
          console.warn(`⚠️ خطأ في فحص المعاملة ${i + 1} للمحفظة ${owner}:`, txError.message);
          // الاستمرار في فحص المعاملات الأخرى
          continue;
        }
      }
      
      console.log(`❌ لم يتم العثور على عمليات Pump.fun صحيحة في آخر ${signatures.length} معاملة للمحفظة ${owner}`);
      return false;
      
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ محاولة ${attempt}/${maxRetries} فشلت في فحص نشاط Pump.fun للمحفظة ${owner}:`, error.message);
      
      if (attempt < maxRetries) {
        const waitTime = Math.min(1000 * attempt, 3000);
        console.log(`⏳ انتظار ${waitTime}ms قبل المحاولة التالية...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  console.error(`❌ فشل نهائي في فحص نشاط Pump.fun للمحفظة ${owner}:`, lastError);
  return false; // إرجاع false في حالة الفشل للأمان
}

// تحليل محفظة واحدة مع إعادة المحاولة الشاملة
async function analyzeWallet(owner, mint, tokenPrice = 0, maxRetries = 3, minAccounts = 0.05) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔍 تحليل المحفظة ${owner} - محاولة ${attempt}/${maxRetries}`);

      // جلب جميع البيانات المطلوبة مع آلية إعادة المحاولة لكل طلب
      let allTokenAccountsResult, specificTokenAccountsResult, solBalance;

      try {
        [allTokenAccountsResult, specificTokenAccountsResult, solBalance] = await Promise.all([
          rpc("getTokenAccountsByOwner", [
            owner,
            { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
            { encoding: "jsonParsed" }
          ], 2),
          getTokenAccounts(owner, mint, 2),
          getSolBalance(owner, 2)
        ]);
      } catch (parallelError) {
        // إذا فشل الطلب المتوازي، جرب بشكل تسلسلي
        console.warn(`⚠️ فشل الطلب المتوازي، محاولة تسلسلية...`);
        allTokenAccountsResult = await rpc("getTokenAccountsByOwner", [
          owner,
          { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
          { encoding: "jsonParsed" }
        ], 2);

        specificTokenAccountsResult = await getTokenAccounts(owner, mint, 2);
        solBalance = await getSolBalance(owner, 2);
      }

      const allAccounts = allTokenAccountsResult?.value || [];

      // فحص سريع - إذا كان عدد الحسابات أقل من الحد المحدد، لا تكمل
      const minAccountsThreshold = minAccounts * 1000; // تحويل من SOL إلى عدد الحسابات التقريبي
      if (allAccounts.length < minAccountsThreshold) {
        console.log(`⏭️ المحفظة ${owner} لديها ${allAccounts.length} حساب فقط (أقل من ${minAccountsThreshold}) - تخطي`);
        return null;
      }

      let tokenAccountsCount = 0;
      let nftAccountsCount = 0;
      let cleanupAccountsCount = 0;
      let totalTokenBalance = 0;

      // حساب البيانات بشكل محسن
      for (let acc of allAccounts) {
        try {
          const info = acc.account.data.parsed.info;
          const amount = parseFloat(info.tokenAmount.uiAmount) || 0;
          const decimals = info.tokenAmount.decimals;

          // تصنيف الحسابات
          if (amount === 0) {
            tokenAccountsCount++;
          } else if (decimals === 0 && amount === 1) {
            nftAccountsCount++;
          } else {
            cleanupAccountsCount++;
          }
        } catch (parseError) {
          console.warn(`⚠️ خطأ في تحليل حساب - تجاهل:`, parseError.message);
          continue;
        }
      }

      // حساب قيمة التوكن المحدد
      for (let acc of specificTokenAccountsResult) {
        try {
          const info = acc.account.data.parsed.info;
          const amount = parseFloat(info.tokenAmount.uiAmount) || 0;
          totalTokenBalance += amount;
        } catch (parseError) {
          console.warn(`⚠️ خطأ في تحليل توكن محدد - تجاهل:`, parseError.message);
          continue;
        }
      }

      const totalRent = allAccounts.length * 0.00203928;
      const tokenValueUSD = totalTokenBalance * tokenPrice;



      const result = {
        address: owner,
        solBalance: solBalance.toFixed(3),
        reclaimable: totalRent.toFixed(6),
        accountsCount: allAccounts.length,
        tokenAccounts: tokenAccountsCount,
        nftAccounts: nftAccountsCount,
        cleanupAccounts: cleanupAccountsCount,
        tokenValue: tokenValueUSD.toFixed(2),
      };

      console.log(`✅ نجح تحليل المحفظة ${owner} - محاولة ${attempt}`);
      return result;

    } catch (error) {
      lastError = error;
      console.warn(`⚠️ محاولة ${attempt}/${maxRetries} فشلت في تحليل المحفظة ${owner}:`, error.message);

      if (attempt < maxRetries) {
        const waitTime = Math.min(2000 * attempt, 10000);
        console.log(`⏳ انتظار ${waitTime}ms قبل المحاولة التالية...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  console.error(`❌ فشل نهائي في تحليل المحفظة ${owner} بعد ${maxRetries} محاولات:`, lastError);
  throw lastError; // رمي الخطأ بدلاً من إرجاع null
}

// نقطة البدء
app.post("/analyze", async (req, res) => {
  const { mint, minAccounts = 0.05, balanceFilter = 'under10' } = req.body;
  console.log(`🚀 بدء تحليل التوكن: ${mint}`);
  console.log(`⚙️ إعدادات الفحص: الحد الأدنى ${minAccounts} حساب`);
  console.log(`⚖️ فلتر الرصيد: ${balanceFilter}`);

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // الحصول على سعر التوكن أولاً
    console.log("💲 جلب سعر التوكن...");
    const tokenPrice = await getTokenPrice(mint, 'dexscreener');
    console.log(`💰 سعر التوكن المستلم: $${tokenPrice}`);

    const tokenPriceData = { tokenPrice: tokenPrice };
    console.log("📤 إرسال سعر التوكن:", tokenPriceData);
    res.write(`data: ${JSON.stringify(tokenPriceData)}\n\n`);

    console.log("🔍 البحث عن حاملي التوكن...");
    const walletOwners = await getHolders(mint);
    console.log(`👥 تم العثور على ${walletOwners.length} حامل للتوكن`);

    // إرسال عدد الحاملين الإجمالي أولاً
    const holdersData = { totalHolders: walletOwners.length };
    console.log("📤 إرسال عدد الحاملين:", holdersData);
    res.write(`data: ${JSON.stringify(holdersData)}\n\n`);

    if (walletOwners.length === 0) {
      const errorData = { error: "لم يتم العثور على محافظ تحمل التوكن بقيمة 10$ أو أكثر" };
      console.log("❌ لا توجد محافظ مؤهلة");
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
      res.end();
      return;
    }

    const results = [];
    let processed = 0;
    let qualifiedResults = 0;

    console.log(`🔄 بدء معالجة ${walletOwners.length} محفظة بشكل متوازي...`);

    // معالجة المحافظ في مجموعات متوازية (5 محافظ في المرة الواحدة)
    const BATCH_SIZE = 2; // معالجة ذكية - تقليل العدد لتجنب الحمولة الزائدة
    const batches = [];

    for (let i = 0; i < walletOwners.length; i += BATCH_SIZE) {
      batches.push(walletOwners.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      // التحقق من حالة الاتصال قبل معالجة كل مجموعة
      if (res.destroyed || res.writableEnded) {
        console.log("🛑 تم قطع الاتصال - توقيف المعالجة");
        return;
      }

      // معالجة المجموعة بشكل متوازي مع إعادة المحاولة
      const batchPromises = batch.map(async (owner) => {
        let retries = 0;
        const maxRetries = 3;

        while (retries < maxRetries) {
          try {
            console.log(`📝 معالجة المحفظة: ${owner} ${retries > 0 ? `(إعادة محاولة ${retries})` : ''}`);
            
            // فحص الرصيد أولاً إذا كان الفلتر 'under10'
            if (balanceFilter === 'under10') {
              const solBalance = await getSolBalance(owner, 2);
              if (solBalance > 10) {
                console.log(`❌ المحفظة ${owner} رصيدها ${solBalance.toFixed(3)} SOL (أكثر من 10) - تم تخطيها`);
                return { unqualified: true, address: owner, reason: 'high_balance' };
              }
              console.log(`✅ المحفظة ${owner} رصيدها ${solBalance.toFixed(3)} SOL (أقل من 10) - متابعة التحليل`);
            }
            
            const data = await analyzeWallet(owner, mint, tokenPrice, 2, minAccounts);

            if (data) {
              console.log(`✅ محفظة مؤهلة: ${data.address} - يمكن استرداد ${data.reclaimable} SOL`);
              return data;
            } else {
              console.log(`❌ محفظة غير مؤهلة: ${owner}`);
              return { unqualified: true, address: owner, reason: 'low_accounts' };
            }
          } catch (error) {
            retries++;
            console.error(`❌ خطأ في معالجة المحفظة ${owner} (محاولة ${retries}/${maxRetries}):`, error.message);

            if (retries < maxRetries) {
              const waitTime = Math.min(3000 * retries, 15000);
              console.log(`⏳ إعادة محاولة المحفظة ${owner} بعد ${waitTime}ms...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
              console.error(`❌ فشل نهائي في معالجة المحفظة ${owner} بعد ${maxRetries} محاولات`);
              // لا تعيد null، بل تعيد خطأ ليتم التعامل معه
              throw new Error(`فشل نهائي في معالجة المحفظة ${owner}`);
            }
          }
        }
      });

      // انتظار انتهاء جميع محافظ المجموعة
      const batchResults = await Promise.all(batchPromises);

      // إضافة النتائج الصالحة (فقط المحافظ المؤهلة)
      const validResults = batchResults.filter(result => result !== null && !result.unqualified);
      results.push(...validResults);
      qualifiedResults += validResults.length;

      processed += batch.length;

      // حساب عدد المحافظ المستبعدة
      const balanceExcluded = batchResults.filter(result => result && result.unqualified && result.reason === 'high_balance').length;
      const accountsExcluded = batchResults.filter(result => result && result.unqualified && result.reason === 'low_accounts').length;
      
      // إرسال التحديث
      const progressData = { 
        progress: processed, 
        total: walletOwners.length,
        qualified: qualifiedResults,
        balanceExcluded: balanceExcluded,
        accountsExcluded: accountsExcluded
      };
      console.log(`📊 التقدم: ${processed}/${walletOwners.length} (${Math.round(processed/walletOwners.length*100)}%) - مؤهل: ${qualifiedResults} - مستبعد بسبب الرصيد: ${balanceExcluded} - مستبعد بسبب الحسابات: ${accountsExcluded}`);
      res.write(`data: ${JSON.stringify(progressData)}\n\n`);

      // إرسال النتائج الجديدة إذا وجدت
      if (validResults.length > 0) {
        const batchData = { 
          batch: true, 
          results: validResults, 
          batchNumber: Math.floor(processed / BATCH_SIZE),
          totalBatches: batches.length
        };
        res.write(`data: ${JSON.stringify(batchData)}\n\n`);
      }
    }

    console.log(`🎯 انتهاء المعالجة - النتائج المؤهلة: ${results.length}/${walletOwners.length}`);

    const finalData = { done: true, totalResults: results.length };
    console.log("📤 إرسال إشارة الانتهاء");
    res.write(`data: ${JSON.stringify(finalData)}\n\n`);
    res.end();
    console.log("✅ تم إنهاء الطلب بنجاح");

  } catch (err) {
    console.error("❌ خطأ عام في /analyze:", err);
    const errorData = { error: err.message };
    res.write(`data: ${JSON.stringify(errorData)}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => console.log(`✅ Running on http://localhost:${PORT}`));