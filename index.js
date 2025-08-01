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

const RPC_URL = "https://proud-aged-flower.solana-mainnet.quiknode.pro/6c4369466a2cfc21c12af4a500501aa9b0093340";
const RENT_EXEMPT_LAMPORTS = 2039280; // تقريبي لحسابات التوكن

// تحويل lamports إلى SOL
function lamportsToSol(lamports) {
  return lamports / 1e9;
}

// استعلام عبر RPC
async function rpc(method, params) {
  if (!fetch) {
    const nodeFetch = await import('node-fetch');
    fetch = nodeFetch.default;
  }
  
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  const data = await res.json();
  return data.result;
}

// احصل على رصيد محفظة SOL
async function getSolBalance(address) {
  try {
    const result = await rpc("getBalance", [address]);
    const lamports = result?.value || result || 0;
    return lamportsToSol(lamports);
  } catch (error) {
    console.error("خطأ في الحصول على رصيد SOL:", error);
    return 0;
  }
}

// احصل على حسابات التوكن لمحفظة معينة
async function getTokenAccounts(owner, mint) {
  const result = await rpc("getTokenAccountsByOwner", [
    owner,
    { mint },
    { encoding: "jsonParsed" },
  ]);
  return result?.value || [];
}

// احصل على سعر التوكن بالدولار
async function getTokenPrice(mint) {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await response.json();
    
    if (data.pairs && data.pairs.length > 0) {
      return parseFloat(data.pairs[0].priceUsd) || 0;
    }
    return 0;
  } catch (error) {
    console.error("خطأ في الحصول على سعر التوكن:", error);
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
          
          // فقط الحاملين الذين يملكون 10$ أو أكثر
          if (valueInUSD >= 10) {
            qualifiedHolders++;
            if (ownersWithBalance.has(owner)) {
              ownersWithBalance.set(owner, ownersWithBalance.get(owner) + valueInUSD);
            } else {
              ownersWithBalance.set(owner, valueInUSD);
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

// تحليل محفظة واحدة للبحث عن حسابات قابلة للإغلاق
async function analyzeWallet(owner, mint, tokenPrice = 0) {
  console.log(`🔍 تحليل المحفظة: ${owner}`);
  
  try {
    // الحصول على جميع حسابات التوكن في المحفظة (جميع الأنواع)
    const allTokenAccounts = await rpc("getTokenAccountsByOwner", [
      owner,
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { encoding: "jsonParsed" }
    ]);
    
    const allAccounts = allTokenAccounts?.value || [];
    console.log(`📄 إجمالي حسابات التوكن في المحفظة: ${allAccounts.length}`);
    
    // الحصول على حسابات التوكن المحدد فقط لحساب القيمة
    const specificTokenAccounts = await getTokenAccounts(owner, mint);
    
    let tokenAccountsCount = 0;
    let nftAccountsCount = 0;
    let cleanupAccountsCount = 0;
    let totalRent = 0;
    let totalTokenBalance = 0;

    // حساب rent لجميع حسابات التوكن
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
        
        // حساب rent لكل حساب توكن
        totalRent += 0.00203928;
        
      } catch (error) {
        console.error(`❌ خطأ في معالجة حساب التوكن:`, error);
        continue;
      }
    }

    // حساب قيمة التوكن المحدد فقط
    for (let acc of specificTokenAccounts) {
      try {
        const info = acc.account.data.parsed.info;
        const amount = parseFloat(info.tokenAmount.uiAmount) || 0;
        totalTokenBalance += amount;
      } catch (error) {
        console.error(`❌ خطأ في معالجة حساب التوكن المحدد:`, error);
        continue;
      }
    }

    // تحسين جلب رصيد SOL
    const solBalance = await getSolBalance(owner);
    const tokenValueUSD = totalTokenBalance * tokenPrice;
    
    if (totalRent < 0.05) {
      console.log(`⚠️ المحفظة لا تستوفي الحد الأدنى: ${totalRent} < 0.001 SOL`);
      return null;
    }

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
    
    console.log(`✅ نتيجة تحليل المحفظة:`, result);
    return result;
    
  } catch (error) {
    console.error(`❌ خطأ في تحليل المحفظة ${owner}:`, error);
    return null;
  }
}

// نقطة البدء
app.post("/analyze", async (req, res) => {
  const { mint } = req.body;
  console.log(`🚀 بدء تحليل التوكن: ${mint}`);

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // الحصول على سعر التوكن أولاً
    console.log("💲 جلب سعر التوكن...");
    const tokenPrice = await getTokenPrice(mint);
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

    console.log(`🔄 بدء معالجة ${walletOwners.length} محفظة...`);

    for (let owner of walletOwners) {
      try {
        console.log(`📝 معالجة المحفظة ${processed + 1}/${walletOwners.length}: ${owner}`);
        const data = await analyzeWallet(owner, mint, tokenPrice);
        
        // عرض المحافظ التي يمكنها استرداد أكثر من 0.001 SOL (مؤقتاً)
        // ملاحظة: لعرض المحافظ التي تحتوي على 0.05+ يجب البحث عن محافظ بـ 25+ حساب توكن
        if (data && parseFloat(data.reclaimable) >= 0.001) {
          results.push(data);
          qualifiedResults++;
          console.log(`✅ محفظة مؤهلة #${qualifiedResults}: ${data.address} - يمكن استرداد ${data.reclaimable} SOL`);
        } else {
          console.log(`❌ محفظة غير مؤهلة: ${owner} - أقل من 0.05 SOL`);
        }

        processed++;
        const progressData = { progress: processed, total: walletOwners.length };
        console.log(`📊 التقدم: ${processed}/${walletOwners.length} (${Math.round(processed/walletOwners.length*100)}%)`);
        res.write(`data: ${JSON.stringify(progressData)}\n\n`);
        
      } catch (error) {
        console.error(`❌ خطأ في معالجة المحفظة ${owner}:`, error);
        processed++;
        const progressData = { progress: processed, total: walletOwners.length };
        res.write(`data: ${JSON.stringify(progressData)}\n\n`);
      }
    }

    console.log(`🎯 انتهاء المعالجة - النتائج المؤهلة: ${results.length}/${walletOwners.length}`);
    
    // إرسال النتائج في مجموعات أصغر لتجنب مشاكل JSON الكبيرة
    const BATCH_SIZE = 10;
    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);
      const batchData = { 
        batch: true, 
        results: batch, 
        batchNumber: Math.floor(i / BATCH_SIZE) + 1,
        totalBatches: Math.ceil(results.length / BATCH_SIZE)
      };
      res.write(`data: ${JSON.stringify(batchData)}\n\n`);
    }
    
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