const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv');
const hardcodedUrls = require("./URLs");


const CONFIG = {
  MAX_RETRIES: 2,
  BASE_DELAY: 1500,
  MAX_DELAY: 4000,
  TIMEOUT: 30000,
  HEADLESS: true,
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36'
};

//Regex patterns
const ASIN_PATTERNS = [
  /(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /(?:ASIN)=([A-Z0-9]{10})(?:&|$)/i
];

async function scrapeAmazonProduct(url, retryCount = 0) {
  console.log(`Starting to scrape: ${url}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);

  const originalAsin = extractAsinFromUrl(url);
  let browser;

  try {
    // Launch browser with optimized settings
    browser = await puppeteer.launch({
      headless: CONFIG.HEADLESS,
      userDataDir:"./tmp",
      args: [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    const page = await browser.newPage();
    
    // Configure page for better performance
    await page.setUserAgent(CONFIG.USER_AGENT);
    await page.setViewport({ width: 1366, height: 768 });
    await page.setDefaultNavigationTimeout(CONFIG.TIMEOUT);
    await page.setRequestInterception(true);

    // Block unnecessary resources
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate with robust error handling
    const response = await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.TIMEOUT
    }).catch(e => {
      throw new Error(`Navigation failed: ${e.message}`);
    });

    if (!response.ok() && response.status() !== 404) {
      throw new Error(`HTTP ${response.status()} for ${url}`);
    }

    // Get final URL after redirects
    const finalUrl = page.url();
    const finalAsin = extractAsinFromUrl(finalUrl);
    const redirected = finalAsin !== originalAsin;

    // Wait for critical elements with fallbacks
    await Promise.race([
      page.waitForSelector('#productTitle, #title', { timeout: 5000 }),
      page.waitForSelector('#wayfinding-breadcrumbs_container', { timeout: 5000 }),
      page.waitForSelector('#nav-bb-logo', { timeout: 5000 })
    ]).catch(() => console.log('No critical elements found, proceeding anyway'));

    // lazy loading
    await autoScroll(page);

    // Extract data with robust selectors
    const productData = await page.evaluate(() => {
      // Helper functions
      const extractText = (selector, parent = document) => 
        (parent.querySelector(selector)?.textContent.trim() || '')
      
      const extractNumber = (text) => {
        if (!text) return 0;
        const match = text.match(/(\d+(?:,\d+)*(?:\.\d+)?)/);
        return match ? parseFloat(match[1].replace(/,/g, '')) : 0;
      };

      const extractMoney = (text) => {
        if (!text) return '';
        const match = text.match(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?)/);
        return match ? `₹${match[1]}` : '';
      };

      const extractRating = (text) => {
        if (!text) return '';
        const match = text.match(/(\d\.\d)/);
        return match ? match[1] : '';
      };

      // Title extraction with fallbacks
      const title = extractText('#productTitle') || 
                   extractText('#title') || 
                   extractText('h1.a-size-large');

      // Price extraction with multiple fallbacks
      let price = '';
      const priceSelectors = [
        '.a-price-whole',
        '.a-price .a-offscreen',
        '#priceblock_ourprice',
        '#priceblock_dealprice',
        '.apexPriceToPay .a-offscreen'
      ];

      for (const selector of priceSelectors) {
        if (price) break;
        price = extractMoney(extractText(selector));
      }

      // Rating extraction
      const rating = extractRating(
        extractText('#averageCustomerReviews .a-icon-alt') ||
        extractText('.reviewCountTextLinkedHistogram')
      );

      // Review count extraction
      const reviewCount = extractText('#acrCustomerReviewText') ||
                        extractText('#reviewsMedley .a-size-base');

      // Coupon extraction
      let coupon = '';
      const couponSelectors = [
        '.couponBadge',
        '.promotions-list .a-checkbox label',
        '.couponText',
        '.promoPriceBlockMessage'
      ];

      for (const selector of couponSelectors) {
        if (coupon) break;
        const text = extractText(selector);
        if (text.includes('₹') || text.includes('%')) {
          coupon = text.includes('₹') ? extractMoney(text) : text.match(/\d+%/)?.[0];
        }
      }

      // Bank discount extraction
      let bankDiscount = '₹0';
      const bankKeywords = ['bank', 'card', 'upi', 'instant discount'];
      const bankElements = [
        ...document.querySelectorAll('#itembox-InstantBankDiscount, .ibdPromotionTypeIcon, .a-box .a-color-success')
      ];

      for (const element of bankElements) {
        const text = element.textContent.toLowerCase();
        if (bankKeywords.some(kw => text.includes(kw))) {
          const amount = extractMoney(element.textContent) || element.textContent.match(/\d+/)?.[0];
          if (amount) {
            bankDiscount = `₹${amount}`;
            break;
          }
        }
      }

      return {
        title,
        price,
        rating,
        reviewCount,
        coupon,
        bankDiscount
      };
    });

    // Calculate numeric values
    const numericPrice = extractNumber(productData.price);
    const numericCoupon = extractNumber(productData.coupon);
    const numericBankDiscount = extractNumber(productData.bankDiscount);
    const netPrice = Math.max(0, numericPrice - numericCoupon - numericBankDiscount);

    const result = {
      originalUrl: url,
      originalAsin,
      finalUrl,
      finalAsin,
      redirected: redirected ? 'Yes' : 'No',
      title: productData.title,
      buyBoxPrice: productData.price,
      buyBoxPriceNumeric: numericPrice,
      rating: productData.rating,
      reviewCount: productData.reviewCount,
      couponAmount: productData.coupon,
      couponAmountNumeric: numericCoupon,
      maxBankDiscount: productData.bankDiscount,
      maxBankDiscountNumeric: numericBankDiscount,
      netEffectivePrice: `₹${netPrice.toLocaleString('en-IN')}`,
      netEffectivePriceNumeric: netPrice
    };

    await browser.close();
    return result;

  } catch (error) {
    if (browser) await browser.close();
    
    if (retryCount < CONFIG.MAX_RETRIES) {
      const delay = Math.min(CONFIG.BASE_DELAY * (retryCount + 1), CONFIG.MAX_DELAY);
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return scrapeAmazonProduct(url, retryCount + 1);
    }

    console.error(`Failed to scrape ${url} after ${retryCount + 1} attempts:`, error.message);
    
    return {
      originalUrl: url,
      originalAsin,
      finalUrl: 'SCRAPING_FAILED',
      finalAsin: 'SCRAPING_FAILED',
      redirected: 'Unknown',
      title: 'SCRAPING_FAILED',
      buyBoxPrice: '',
      buyBoxPriceNumeric: 0,
      rating: '',
      reviewCount: '',
      couponAmount: '',
      couponAmountNumeric: 0,
      maxBankDiscount: '₹0',
      maxBankDiscountNumeric: 0,
      netEffectivePrice: '',
      netEffectivePriceNumeric: 0
    };
  }
}

// Helper functions
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 200;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight || totalHeight > 3000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

function extractAsinFromUrl(url) {
  for (const pattern of ASIN_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return 'UNKNOWN_ASIN';
}

function extractNumber(text) {
  if (!text) return 0;
  const match = text.match(/(\d+(?:,\d+)*(?:\.\d+)?)/);
  return match ? parseFloat(match[1].replace(/,/g, '')) : 0;
}

async function scrapeMultipleUrls(urls, outputPath) {
  const fields = [
    'originalUrl', 'originalAsin', 'finalUrl', 'finalAsin', 'redirected',
    'title', 'buyBoxPrice', 'buyBoxPriceNumeric', 'rating', 'reviewCount',
    'couponAmount', 'couponAmountNumeric', 'maxBankDiscount', 
    'maxBankDiscountNumeric', 'netEffectivePrice', 'netEffectivePriceNumeric'
  ];

  // Create a parser for the headers
  const headerParser = new Parser({ fields });
  
  // Create a parser for data rows without headers
  const dataParser = new Parser({ fields, header: false });
  
  // Write headers to file first
  fs.writeFileSync(outputPath, headerParser.parse([]) + '\n');
  
  const stats = {
    total: urls.length,
    success: 0,
    failure: 0,
    redirected: 0,
    withCoupons: 0,
    withBankDiscounts: 0
  };

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`Processing ${i + 1}/${urls.length}: ${url}`);

    const result = await scrapeAmazonProduct(url);
    
    // Update stats
    if (result.finalUrl !== 'SCRAPING_FAILED') {
      stats.success++;
      if (result.redirected === 'Yes') stats.redirected++;
      if (result.couponAmount) stats.withCoupons++;
      if (result.maxBankDiscount !== '₹0') stats.withBankDiscounts++;
    } else {
      stats.failure++;
    }
    
    // Append just the data row to the CSV file (without headers)
    fs.appendFileSync(outputPath, dataParser.parse([result]) + '\n');
    
    // Add delay between requests
    if (i < urls.length - 1) {
      const delay = Math.floor(Math.random() * 2000) + 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return stats;
}

async function main() {
  // Ensure output directory exists
  if (!fs.existsSync('output')) {
    fs.mkdirSync('output');
  }

  // Get URLs from file or hardcoded
  const urls = fs.existsSync('amazon_urls.txt') 
    ? fs.readFileSync('amazon_urls.txt', 'utf8')
        .split('\n')
        .filter(u => u.trim().length > 0)
    : hardcodedUrls;

  if (!urls.length) {
    console.error('No URLs found to scrape');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join('output', `amazon_products_${timestamp}.csv`);

  console.log(`Starting to scrape ${urls.length} URLs...`);
  const stats = await scrapeMultipleUrls(urls, outputPath);

  console.log('\n--- Scraping Summary ---');
  console.log(`Total URLs: ${stats.total}`);
  console.log(`Success: ${stats.success} (${((stats.success / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Failures: ${stats.failure}`);
  console.log(`Redirected: ${stats.redirected}`);
  console.log(`With Coupons: ${stats.withCoupons}`);
  console.log(`With Bank Discounts: ${stats.withBankDiscounts}`);
  console.log(`Results saved to ${outputPath}`);
}

main().catch(console.error);
