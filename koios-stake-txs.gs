/**
 * Koios Stake Transactions Google Apps Script
 * Query Koios for transactions from all payment addresses associated with a stake address.
 * Outputs results to a Google Sheet instead of CSV.
 * 
 * Usage:
 * 1. Open Google Apps Script (script.google.com)
 * 2. Create a new project
 * 3. Replace the default code with this script
 * 4. Run the main function with parameters:
 *    - stakeAddress: Stake address (e.g., "stake1...")
 *    - date: Date in YYYY-MM-DD format (e.g., "2024-01-01")
 *    - sheetName: Optional sheet name (defaults to "Transactions")
 */

// Configuration
const KOIOS_API_BASE = "https://api.koios.rest/api/v1";
const ACCOUNT_ADDRESSES_ENDPOINT = `${KOIOS_API_BASE}/account_addresses`;
const ADDRESS_TXS_ENDPOINT = `${KOIOS_API_BASE}/address_txs`;
const TX_INFO_ENDPOINT = `${KOIOS_API_BASE}/tx_info`;
const TIP_ENDPOINT = `${KOIOS_API_BASE}/tip`;
const BATCH_SIZE = 50;

/**
 * Main function to query stake address transactions and output to Google Sheet
 * @param {string} stakeAddress - The stake address to query
 * @param {string} date - Date in YYYY-MM-DD format to filter transactions from
 * @param {string} sheetName - Optional sheet name (defaults to "Transactions")
 */
function queryStakeTransactions(stakeAddress, date, sheetName = "Transactions") {
  try {
    // Validate inputs
    if (!stakeAddress || !date) {
      throw new Error("Both stakeAddress and date are required");
    }
    
    if (!stakeAddress.match(/^stake1[0-9a-z]+$/)) {
      throw new Error(`Invalid stake address format: ${stakeAddress}`);
    }
    
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      throw new Error(`Invalid date format. Use YYYY-MM-DD: ${date}`);
    }
    
    console.log(`Getting payment addresses for stake address: ${stakeAddress}`);
    
    // Get payment addresses
    const paymentAddresses = getPaymentAddresses(stakeAddress);
    if (paymentAddresses.length === 0) {
      throw new Error(`No payment addresses found for stake address: ${stakeAddress}`);
    }
    
    console.log(`Found ${paymentAddresses.length} payment addresses`);
    
    // Get current block height
    console.log("Getting current block height...");
    const currentBlock = getCurrentBlockHeight();
    if (!currentBlock) {
      throw new Error("Could not get current block height");
    }
    
    console.log(`Current block height: ${currentBlock}`);
    
    // Get transactions for all payment addresses
    console.log("Fetching transactions...");
    const txResponse = getAddressTransactions(paymentAddresses);
    
    // Extract transaction hashes
    const txHashes = txResponse
      .filter(tx => tx.tx_hash)
      .map(tx => tx.tx_hash);
    
    if (txHashes.length === 0) {
      console.log("No transactions found for the given criteria");
      createEmptySheet(sheetName);
      return;
    }
    
    console.log(`Found ${txHashes.length} transactions`);
    
    // Get detailed transaction information in batches
    console.log("Fetching transaction details in batches...");
    const txDetails = [];
    
    for (let i = 0; i < txHashes.length; i += BATCH_SIZE) {
      const batchHashes = txHashes.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(txHashes.length / BATCH_SIZE)}...`);
      
      const batchDetails = getTransactionDetails(batchHashes);
      if (batchDetails && batchDetails.length > 0) {
        txDetails.push(...batchDetails);
      }
    }
    
    // Get USD price for the given date
    const adaUsdPrice = getAdaUsdPrice(date);
    
    // Generate sheet output
    console.log("Generating sheet output...");
    writeToSheet(stakeAddress, paymentAddresses, txResponse, txDetails, date, adaUsdPrice, sheetName);
    
    console.log(`Data written to sheet: ${sheetName}`);
    
  } catch (error) {
    console.error("Error:", error.message);
    throw error;
  }
}

/**
 * Make API call to Koios
 * @param {string} endpoint - API endpoint URL
 * @param {Object} data - Request data
 * @returns {Object} API response
 */
function apiCall(endpoint, data) {
  const options = {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(data)
  };
  
  try {
    const response = UrlFetchApp.fetch(endpoint, options);
    
    if (response.getResponseCode() !== 200) {
      throw new Error(`Koios returned HTTP ${response.getResponseCode()}: ${response.getContentText()}`);
    }
    
    return JSON.parse(response.getContentText());
  } catch (error) {
    console.error(`API call failed for ${endpoint}:`, error.message);
    throw error;
  }
}

/**
 * Get current block height
 * @returns {number} Current block height
 */
function getCurrentBlockHeight() {
  const response = apiCall(TIP_ENDPOINT, {});
  return response[0]?.block_height || null;
}

/**
 * Get payment addresses for a stake address
 * @param {string} stakeAddress - Stake address
 * @returns {Array} Array of payment addresses
 */
function getPaymentAddresses(stakeAddress) {
  const data = {
    _stake_addresses: [stakeAddress]
  };
  
  const response = apiCall(ACCOUNT_ADDRESSES_ENDPOINT, data);
  return response[0]?.addresses || [];
}

/**
 * Get transactions for payment addresses
 * @param {Array} addresses - Array of payment addresses
 * @returns {Array} Array of transaction objects
 */
function getAddressTransactions(addresses) {
  const data = {
    _addresses: addresses
  };
  
  return apiCall(ADDRESS_TXS_ENDPOINT, data);
}

/**
 * Get detailed transaction information
 * @param {Array} txHashes - Array of transaction hashes
 * @returns {Array} Array of detailed transaction objects
 */
function getTransactionDetails(txHashes) {
  const data = {
    _tx_hashes: txHashes
  };
  
  return apiCall(TX_INFO_ENDPOINT, data);
}

/**
 * Convert lovelace to ADA
 * @param {string|number} lovelace - Amount in lovelace
 * @returns {number} Amount in ADA
 */
function lovelaceToAda(lovelace) {
  return parseFloat(lovelace) / 1000000;
}

/**
 * Get USD price for ADA on a given date
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {number} USD price per ADA
 */
function getAdaUsdPrice(date) {
  try {
    // Convert date to DD-MM-YYYY format for CoinGecko
    const dateObj = new Date(date);
    const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${dateObj.getFullYear()}`;
    
    // Try to get historical price from CoinGecko API
    const coingeckoUrl = `https://api.coingecko.com/api/v3/coins/cardano/history?date=${formattedDate}`;
    
    try {
      const response = UrlFetchApp.fetch(coingeckoUrl);
      const data = JSON.parse(response.getContentText());
      
      if (data.market_data?.current_price?.usd) {
        return data.market_data.current_price.usd;
      }
    } catch (error) {
      console.log("Historical price not available, trying current price...");
    }
    
    // Fallback to current price
    const currentPriceUrl = "https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd";
    const response = UrlFetchApp.fetch(currentPriceUrl);
    const data = JSON.parse(response.getContentText());
    
    if (data.cardano?.usd) {
      return data.cardano.usd;
    }
    
    // Final fallback
    return 0.25;
  } catch (error) {
    console.error("Error getting ADA price:", error.message);
    return 0.25;
  }
}

/**
 * Format timestamp to human readable
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Formatted date string
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp * 1000);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

/**
 * Create empty sheet with headers
 * @param {string} sheetName - Name of the sheet
 */
function createEmptySheet(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  } else {
    sheet.clear();
  }
  
  // Add headers
  const headers = [
    "stake_address",
    "payment_address", 
    "transaction_hash",
    "transaction_time",
    "transaction_block_height",
    "amount_ada",
    "amount_usd",
    "fee_ada"
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
}

/**
 * Write transaction data to Google Sheet
 * @param {string} stakeAddress - Stake address
 * @param {Array} paymentAddresses - Array of payment addresses
 * @param {Array} txResponse - Transaction response data
 * @param {Array} txDetails - Detailed transaction data
 * @param {string} date - Filter date
 * @param {number} adaUsdPrice - ADA to USD price
 * @param {string} sheetName - Sheet name
 */
function writeToSheet(stakeAddress, paymentAddresses, txResponse, txDetails, date, adaUsdPrice, sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  } else {
    sheet.clear();
  }
  
  // Add headers
  const headers = [
    "stake_address",
    "payment_address", 
    "transaction_hash",
    "transaction_time",
    "transaction_block_height",
    "amount_ada",
    "amount_usd",
    "fee_ada"
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  
  // Convert date to timestamp for filtering
  const targetTimestamp = Math.floor(new Date(date).getTime() / 1000);
  
  // Process transactions
  const rows = [];
  const txDetailsMap = new Map();
  
  // Create a map for quick lookup of transaction details
  txDetails.forEach(tx => {
    txDetailsMap.set(tx.tx_hash, tx);
  });
  
  txResponse.forEach(tx => {
    if (!tx.tx_hash) return;
    
    const txDetail = txDetailsMap.get(tx.tx_hash);
    if (!txDetail) return;
    
    const blockTime = txDetail.tx_timestamp || 0;
    
    // Check if transaction is after the specified date
    if (blockTime >= targetTimestamp) {
      const amountAda = lovelaceToAda(txDetail.total_output || "0");
      const feeAda = lovelaceToAda(txDetail.fee || "0");
      const amountUsd = amountAda * adaUsdPrice;
      const transactionTime = formatTimestamp(blockTime);
      
      // Use first payment address as fallback
      const paymentAddr = paymentAddresses[0] || "";
      
      rows.push([
        stakeAddress,
        paymentAddr,
        tx.tx_hash,
        transactionTime,
        txDetail.block_height || 0,
        amountAda,
        amountUsd,
        feeAda
      ]);
    }
  });
  
  // Write data to sheet
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    
    // Format numbers
    const amountAdaRange = sheet.getRange(2, 6, rows.length, 1);
    const amountUsdRange = sheet.getRange(2, 7, rows.length, 1);
    const feeAdaRange = sheet.getRange(2, 8, rows.length, 1);
    
    amountAdaRange.setNumberFormat("0.000000");
    amountUsdRange.setNumberFormat("0.000000");
    feeAdaRange.setNumberFormat("0.000000");
    
    // Auto-resize columns
    sheet.autoResizeColumns(1, headers.length);
  }
}

/**
 * Example usage function - you can call this to test the script
 */
function testQueryStakeTransactions() {
  // Example usage - replace with your actual stake address and date
  const stakeAddress = "stake1uyfs09hz8aw9vk202zkw9seypy3jr87xnm3vkm3v37kwc6q6dfjar";
  const date = "2020-01-01";
  const sheetName = "Cardano Transactions";
  
  queryStakeTransactions(stakeAddress, date, sheetName);
}

/**
 * Function to run with custom parameters
 * Call this function with your specific parameters
 */
function runCustomQuery() {
  // Modify these parameters as needed
  const stakeAddress = "YOUR_STAKE_ADDRESS_HERE";
  const date = "2024-01-01";
  const sheetName = "My Transactions";
  
  queryStakeTransactions(stakeAddress, date, sheetName);
}
