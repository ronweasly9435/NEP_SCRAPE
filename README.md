🛒 Amazon Product Scraper

A robust Puppeteer-based scraper that extracts product details such as title, price, rating, review count, coupon amount, bank discount, and calculates the net effective price from Amazon product URLs.
🚀 Features

    Extracts title, price, rating, review count, coupon and bank discount.

    Calculates the net effective price after applying all discounts.

    Handles redirection and scraping failures with retry logic.

    Scrolls and blocks unnecessary resources for optimized performance.

    Outputs results to a timestamped CSV file with statistics.

📦 Prerequisites

Ensure you have the following installed on your system:

    Node.js (v14 or higher recommended)

    npm

🧩 Installation

    Clone the repository:

git clone https://github.com/yourusername/amazon-product-scraper.git
cd amazon-product-scraper

Install dependencies:

npm install

Add URLs:

You can add Amazon product URLs in one of two ways:

    Create a file named amazon_urls.txt in the root directory and list one URL per line:

https://www.amazon.in/dp/B09G9BL5CP
https://www.amazon.in/dp/B0C47H8Z49

Or, edit the URLs.js file and export an array of hardcoded URLs:

        module.exports = [
          'https://www.amazon.in/dp/B09G9BL5CP',
          'https://www.amazon.in/dp/B0C47H8Z49'
        ];

🏃‍♂️ Running the Scraper

Run the scraper using:

node server.js

    Note: If you're using a different filename, replace server.js with your script's filename.

📁 Output

    A CSV file will be created inside the output folder.

    The filename is timestamped, e.g., amazon_products_2025-05-13T12-00-00-000Z.csv.

    It includes all product data and computed fields.

📊 Example Output Fields
Field	Description
originalUrl	Original product URL
originalAsin	ASIN extracted from the original URL
finalUrl	Final URL after redirection
finalAsin	ASIN extracted from the final URL
redirected	Was there a redirection? (Yes/No)
title	Product title
buyBoxPrice	Displayed price
buyBoxPriceNumeric	Price as a number
rating	Star rating (e.g. 4.5)
reviewCount	Number of reviews
couponAmount	Coupon available (₹ or %)
couponAmountNumeric	Coupon as a number
maxBankDiscount	Max bank discount (₹)
maxBankDiscountNumeric	Bank discount as a number
netEffectivePrice	Final price after coupon and discount
netEffectivePriceNumeric	Net price as a number
🛠 Configuration

Adjust values in the CONFIG object inside the script:

const CONFIG = {
  MAX_RETRIES: 2,
  BASE_DELAY: 1500,
  MAX_DELAY: 4000,
  TIMEOUT: 30000,
  HEADLESS: true,
  USER_AGENT: 'Mozilla/5.0 ...'
};

⚠️ Notes

    Scraping Amazon may violate their Terms of Service. Use this tool responsibly.

    Always test with a few URLs before scaling.

    For long runs, consider rotating IPs or using proxies if you hit rate limits.

📄 License

MIT
