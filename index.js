const express = require("express");
const path = require("path");

// استيراد fetch ديناميكياً
let fetch;
(async () => {
  const nodeFetch = await import('node-fetch');
  fetch = nodeFetch.default;
})();

const app = express();
const PORT = process.env.PORT || 3000;

// واجهة واحدة فقط
app.use(express.static(__dirname));
app.use(express.json());

const RPC_URLS = [
  "https://hidden-red-meme.solana-mainnet.quiknode.pro/92e0a8000b1100e99e63251c941bf60f073d6646",
  "https://proud-aged-flower.solana-mainnet.quiknode.pro/6c4369466a2cfc21c12af4a500501aa9b0093340",
  "https://boldest-burned-night.solana-mainnet.quiknode.pro/d7ebec04632ba9ca28466b8a5e8423bfaad53e2c"
];
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

// تحويل lamports إلى SOL
function lamportsToSol(lamports) {
  return lamports / 1e9;
}

// اختيار RPC URL بالتناوب (50/50)
function getNextRpcUrl() {
  const url = RPC_URLS[requestCounter % RPC_URLS.length];
  requestCounter++;
  console.log(`🌐 استخدام RPC: ${url.includes('hidden-red-meme') ? 'الرابط الأول' : 'الرابط الثاني'} (الطلب #${requestCounter})`);
  return url;
}

// استعلام عبر RPC مع توزيع الأحمال وإعادة المحاولة
async function rpc(method, params, maxRetries = 3) {
  if (!fetch) {
    const nodeFetch = await import('node-fetch');
    fetch = nodeFetch.default;
  }

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const rpcUrl = getNextRpcUrl();

      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
        timeout: 30000, // 30 ثانية timeout
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(`RPC Error: ${data.error.message || data.error}`);
      }

      return data.result;

    } catch (error) {
      lastError = error;
      console.warn(`⚠️ محاولة ${attempt}/${maxRetries} فشلت لـ ${method}:`, error.message);

      if (attempt < maxRetries) {
        // انتظار متزايد بين المحاولات
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`⏳ انتظار ${waitTime}ms قبل المحاولة التالية...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  console.error(`❌ فشل في جميع المحاولات لـ ${method}:`, lastError);
  throw lastError;
}

// احصل على رصيد محفظة SOL مع إعادة المحاولة
async function getSolBalance(address, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await rpc("getBalance", [address], 2); // محاولتان فقط لكل RPC call
      const lamports = result?.value || result || 0;
      return lamportsToSol(lamports);
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ محاولة ${attempt}/${maxRetries} فشلت في getSolBalance للمحفظة ${address}:`, error.message);

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  console.error(`❌ فشل نهائي في getSolBalance للمحفظة ${address}:`, lastError);
  throw lastError; // رمي الخطأ بدلاً من إرجاع 0
}

// احصل على حسابات التوكن لمحفظة معينة مع إعادة المحاولة
async function getTokenAccounts(owner, mint, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await rpc("getTokenAccountsByOwner", [
        owner,
        { mint },
        { encoding: "jsonParsed" },
      ], 2);
      return result?.value || [];
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ محاولة ${attempt}/${maxRetries} فشلت في getTokenAccounts:`, error.message);

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  console.error(`❌ فشل نهائي في getTokenAccounts:`, lastError);
  throw lastError;
}

// احصل على سعر التوكن بالدولار
async function getTokenPrice(mint, serverSource = 'both') {
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

    // إذا لم يجد في DexScreener، جرب PumpFun API
    console.log("🔍 لم يتم العثور على السعر في DexScreener، محاولة PumpFun...");
    return await getPumpFunPrice(mint);

  } catch (error) {
    console.error("خطأ في الحصول على سعر التوكن:", error);

    if (serverSource === 'both') {
      // محاولة PumpFun كبديل إذا كان الإعداد "كلاهما"
      try {
        return await getPumpFunPrice(mint);
      } catch (pumpError) {
        console.error("خطأ في الحصول على سعر التوكن من PumpFun:", pumpError);
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
  const { mint, minAccounts = 0.05, serverSource = 'both' } = req.body;
  console.log(`🚀 بدء تحليل التوكن: ${mint}`);
  console.log(`⚙️ إعدادات الفحص: الحد الأدنى ${minAccounts} حساب`);
  console.log(`🌐 مصدر السعر: ${serverSource}`);

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // الحصول على سعر التوكن أولاً
    console.log("💲 جلب سعر التوكن...");
    const tokenPrice = await getTokenPrice(mint, serverSource);
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
    const BATCH_SIZE = 5;
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
            const data = await analyzeWallet(owner, mint, tokenPrice, 2, minAccounts);

            if (data) {
              console.log(`✅ محفظة مؤهلة: ${data.address} - يمكن استرداد ${data.reclaimable} SOL`);
              return data;
            } else {
              console.log(`❌ محفظة غير مؤهلة: ${owner}`);
              return { unqualified: true, address: owner };
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

      // إضافة النتائج الصالحة
      const validResults = batchResults.filter(result => result !== null);
      results.push(...validResults);
      qualifiedResults += validResults.length;

      processed += batch.length;

      // إرسال التحديث
      const progressData = { progress: processed, total: walletOwners.length };
      console.log(`📊 التقدم: ${processed}/${walletOwners.length} (${Math.round(processed/walletOwners.length*100)}%) - مؤهل: ${qualifiedResults}`);
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