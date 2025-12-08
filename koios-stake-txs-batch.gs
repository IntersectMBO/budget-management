/**
 * Koios Stake Transactions Batch Processor - Google Apps Script
 * Reads stake addresses from a Google Sheet and processes them by bucket
 * Creates separate sheets for each bucket with all transactions
 *
 * Configuration:
 * - Source sheet: "transaction-detetective-suspects" in "transaction-detetective" spreadsheet
 * - Date filter: 2025-01-01 onwards (hardcoded)
 * - Output: Separate sheets for each bucket (e.g., "Intersect", "CDH")
 */

// Configuration
const KOIOS_API_BASE = "https://api.koios.rest/api/v1";
const STAKE_TXS_ENDPOINT=`${KOIOS_API_BASE}/account_txs`;
const TX_INFO_ENDPOINT = `${KOIOS_API_BASE}/tx_info`;
const TX_UTXOS_ENDPOINT = `${KOIOS_API_BASE}/tx_utxos`;
const TIP_ENDPOINT = `${KOIOS_API_BASE}/tip`;
const TX_METADATA = `${KOIOS_API_BASE}/tx_metadata`;
const BATCH_SIZE = 50;
const FILTER_DATE = "2025-01-01"; // Hardcoded date filter

// Spreadsheet and sheet configuration
// You can modify these or use the functions below to specify different spreadsheets
const DEFAULT_SPREADSHEET_NAME = "transaction-detetective";
const SOURCE_SHEET_NAME = "transaction-detetective-suspects";

// Option 1: Use spreadsheet ID (most reliable)
const SPREADSHEET_ID = ""; // Paste your spreadsheet ID here

// Option 2: Use spreadsheet URL
const SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1krE_d59sgTkmQjmkRI4AzN-723k_0d7VgLj3TK8AFVU";


function onOpen () {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🕵️detect transactions')
  .addItem('run the script', 'processAllStakeAddresses')
  .addToUi()
}

/**
 * Main function to process all stake addresses by bucket
 * This is the function you'll run from Google Apps Script
 */
function processAllStakeAddresses() {
  try {
    console.log("Starting batch processing of stake addresses...");

    // Get the source spreadsheet
    const spreadsheet = getSourceSpreadsheet();
    if (!spreadsheet) throw new Error(`Could not find spreadsheet: ${DEFAULT_SPREADSHEET_NAME}`);

    // Get the source sheet
    const sourceSheet = spreadsheet.getSheetByName(SOURCE_SHEET_NAME);
    if (!sourceSheet) throw new Error(`Could not find sheet: ${SOURCE_SHEET_NAME}`);

    // Read the data from the source sheet
    const data = readStakeAddressData(sourceSheet);
    console.log(`Found ${data.length} stake addresses across ${Object.keys(data).length} buckets`);

    // Process each bucket
    for (const [bucketName, addresses] of Object.entries(data)) {
      console.log(`Processing bucket: ${bucketName} with ${addresses.length} addresses`);
      processBucket(bucketName, addresses, spreadsheet);
    }

    console.log("Batch processing completed successfully!");
    
  } catch (error) {
    console.error("Error in batch processing:", error.message);
    throw error;
  }
}

/**
 * Get the source spreadsheet using multiple methods
 * @returns {Spreadsheet} The source spreadsheet
 */
function getSourceSpreadsheet() {
  // Method 1: Use spreadsheet ID (most reliable)
  if (SPREADSHEET_ID && SPREADSHEET_ID.trim() !== "") {
    try { return SpreadsheetApp.openById(SPREADSHEET_ID); } 
    catch (error) { console.log("Could not open spreadsheet by ID:", error.message); }
  }
  
  // Method 2: Use spreadsheet URL
  if (SPREADSHEET_URL && SPREADSHEET_URL.trim() !== "") {
    try {
      const id = extractSpreadsheetIdFromUrl(SPREADSHEET_URL);
      if (id) return SpreadsheetApp.openById(id);
    } catch (error) { console.log("Could not open spreadsheet by URL:", error.message); }
  }
  
  // Method 3: Search by name (fallback)
  try {
    const files = DriveApp.getFilesByName(DEFAULT_SPREADSHEET_NAME);
    if (files.hasNext()) return SpreadsheetApp.openById(files.next().getId());
  } catch (error) { console.log("Could not find spreadsheet by name:", error.message); }
  return null;
}

/**
 * Extract spreadsheet ID from URL
 * @param {string} url - Spreadsheet URL
 * @returns {string|null} Spreadsheet ID or null
 */
function extractSpreadsheetIdFromUrl(url) {
  // Handle different URL formats:
  // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
  // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=0
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * Read stake address data from the source sheet
 * @param {Sheet} sourceSheet - The source sheet
 * @returns {Object} Object with bucket names as keys and arrays of addresses as values
 */
function readStakeAddressData(sourceSheet) {
  const data = sourceSheet.getDataRange().getValues();
  const headers = data[0];
  
  // Find column indices
  const bucketIndex = headers.indexOf("Bucket");
  const labelIndex = headers.indexOf("Label");
  const controllerIndex = headers.indexOf("Controller");
  const stakeAddressIndex = headers.indexOf("Stake Address");

  if (bucketIndex === -1 || stakeAddressIndex === -1) {
    throw new Error("Required columns 'Bucket' and 'Stake Address' not found in source sheet");
  }

  const result = {};
  
  // Process each row (skip header)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const bucket = row[bucketIndex];
    const stakeAddress = row[stakeAddressIndex];
    const label = labelIndex !== -1 ? row[labelIndex] : "";
    const controller = controllerIndex !== -1 ? row[controllerIndex] : "";
    
    // Skip empty rows
    if (!bucket || !stakeAddress) continue;

     // Initialize bucket if it doesn't exist
        if (!result[bucket]) result[bucket] = [];
// Add address info to bucket
    result[bucket].push({ stakeAddress, label, controller });
  }
  
  return result;
}

/**
 * Process all addresses in a bucket
 * @param {string} bucketName - Name of the bucket
 * @param {Array} addresses - Array of address objects
 * @param {Spreadsheet} spreadsheet - The target spreadsheet
 */
async function processBucket(bucketName, addresses, spreadsheet) {
  try {
    console.log(`Processing bucket: ${bucketName}`);
    
    // Create or get the bucket sheet
    let bucketSheet = spreadsheet.getSheetByName(bucketName);
    if (bucketSheet) bucketSheet.clear(); 
    else bucketSheet = spreadsheet.insertSheet(bucketName);
   // Set up headers
    setupBucketSheetHeaders(bucketSheet);

    // Collect all transactions for this bucket
    const allTransactions = [];
    
    for (const addressInfo of addresses) {
      console.log(`  Processing stake address: ${addressInfo.stakeAddress} (${addressInfo.label})`);
      
      try {
        const transactions = await getTransactionsForStakeAddress(
          addressInfo.stakeAddress,
          addressInfo.label,
          addressInfo.controller,
          bucketName
        );
        
        allTransactions.push(...transactions);
        console.log(`    Found ${transactions.length} transactions`);
        
      } catch (error) {
        console.error(`    Error processing ${addressInfo.stakeAddress}:`, error.message);
        // Continue with other addresses even if one fails
      }
    }

    // Write all transactions to the bucket sheet
    if (allTransactions.length > 0) {
      writeTransactionsToSheet(bucketSheet, allTransactions);
      console.log(`  Wrote ${allTransactions.length} transactions to ${bucketName} sheet`);
    } else {
      console.log(`  No transactions found for ${bucketName} bucket`);
    }

  } catch (error) {
    console.error(`Error processing bucket ${bucketName}:`, error.message);
    throw error;
  }
}

/**
 * Get transactions for a single stake address
 * @param {string} stakeAddress - The stake address
 * @param {string} label - The label for this address
 * @param {string} controller - The controller for this address
 * @param {string} bucket - The bucket name for this address
 * @returns {Array} Array of transaction objects
 */
async function getTransactionsForStakeAddress(stakeAddress, label, controller, bucket) {
  try {

    //Get transactions for stake addresses
    const txResponse = getStakeAddressesTransaction(stakeAddress);
    if (txResponse.length === 0){
      console.log(`    No transactions found for ${stakeAddress}`);
      return [];
    }
    
    // Extract transaction hashes
    const txHashes = txResponse
      .filter(tx => tx.tx_hash)
      .map(tx => tx.tx_hash);
    
    if (txHashes.length === 0) {
      return [];
    }

    // Get detailed transaction information in batches
    const txDetails = [];

    for (let i = 0; i < txHashes.length; i += BATCH_SIZE) {
      const batchHashes = txHashes.slice(i, i + BATCH_SIZE);
      const [batchDetails, metadata] = await Promise.all([
        getTransactionDetails(batchHashes),
        getTransactionMetadata(batchHashes)
      ]);

      // Combine details with metadata
      if (batchDetails && batchDetails.length > 0) {
        const combined = batchDetails.map(tx => {
          const metaObj = metadata.find(m => m.tx_hash === tx.tx_hash);

          return {
            ...tx,
            metadata: JSON.stringify(metaObj?.metadata || ''),
          };
        });

        txDetails.push(...combined);
      }

    }

    const txDetailsMap = new Map(txDetails.map(tx => [tx.tx_hash, tx]));


    // ------------------ Fetch UTXO details ------------------
    const txUtxos = [];
    for (let i = 0; i < txHashes.length; i += BATCH_SIZE) {
      const batchHashes = txHashes.slice(i, i + BATCH_SIZE);
      const batchUtxos = getTransactionUtxos(batchHashes);
      if (batchUtxos && batchUtxos.length > 0) txUtxos.push(...batchUtxos);
    }
    const txUtxosMap = new Map(txUtxos.map(u => [u.tx_hash, u]));

    // ------------------ ADA price ------------------
     // Get USD price for the filter date
        const adaUsdPrice = getAdaUsdPrice(FILTER_DATE);
    const targetTimestamp = Math.floor(new Date(FILTER_DATE).getTime() / 1000);

    // ------------------ Process transactions ------------------
    const transactions = [];
    txResponse.forEach(tx => {
      if (!tx.tx_hash) return;

      const txDetail = txDetailsMap.get(tx.tx_hash);
      const txUtxo = txUtxosMap.get(tx.tx_hash);
      if (!txDetail || !txUtxo) return;

      const blockTime = txDetail.tx_timestamp || 0;

      // Check if transaction is after the filter date
      if (blockTime >= targetTimestamp) {
        const amountAda = lovelaceToAda(txDetail.total_output || "0");
        const feeAda = lovelaceToAda(txDetail.fee || "0");
        const transactionTime = formatTimestamp(blockTime);

      // ------------------ New Logic ------------------
      const inputStakeAddrs = txUtxo.inputs.map(i => i.stake_addr).filter(Boolean);
      const txType = inputStakeAddrs.includes(stakeAddress) ? "out" : "in";
      const outputSum = txUtxo.outputs
        .filter(o => !inputStakeAddrs.includes(o.stake_addr))
        .reduce((sum, o) => sum + parseInt(o.value || 0), 0);
      const outputAda = lovelaceToAda(outputSum);
      const amountUsd = outputAda * adaUsdPrice;
      let totalOutputAda = 0;
      (txType === "out") ? totalOutputAda=(outputAda+feeAda) : totalOutputAda=outputAda;
      transactions.push({
        bucket,
        label,
        controller,
        stakeAddress,
        transactionHash: tx.tx_hash,
        transactionTime,
        blockHeight: txDetail.block_height || 0,
        amountAda,
        feeAda,
        txType,
        outputAda,
        amountUsd,
        adaUsdPrice,
        totalOutputAda,
        metadata : txDetail.metadata || '',
      });
      }
    });

    return transactions;

  } catch (error) {
    console.error(`Error getting transactions for ${stakeAddress}:`, error.message);
    return [];
  }
}

/**
 * Set up headers for a bucket sheet
 * @param {Sheet} sheet - The sheet to set up
 */
function setupBucketSheetHeaders(sheet) {
  const headers = [
    "Bucket",
    "Label",
    "Controller",
    "Stake Address",
    "Transaction Hash",
    "Transaction Time",
    "Block Height",
    "Total Ouput Amount (ada)",
    "Transaction Fee (ada)",
    "Transaction Type",
    "Balance Delta (ada)",
    "Balance Delta (usd)",
    "Ada-USD rate",
    "Total balance delta (ada)",
    "Metadata",
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  
  // Format header row
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#4285f4");
  headerRange.setFontColor("white");
}

/**
 * Write transactions to a sheet
 * @param {Sheet} sheet - The sheet to write to
 * @param {Array} transactions - Array of transaction objects
 */
function writeTransactionsToSheet(sheet, transactions) {
  if (transactions.length === 0) return;

  // Convert transactions to rows
  const rows = transactions.map(tx => [
    tx.bucket,
    tx.label,
    tx.controller,
    tx.stakeAddress,
    tx.transactionHash,
    tx.transactionTime,
    tx.blockHeight,
    tx.amountAda,
    tx.feeAda,
    tx.txType,
    tx.outputAda,
    tx.amountUsd,
    tx.adaUsdPrice,
    tx.totalOutputAda,
    tx.metadata,

  ]);

  sheet.getRange(2, 1, rows.length, 15).setValues(rows);
  sheet.getRange(2,7, rows.length, 1).setNumberFormat("0"); // Block hight INT
  sheet.getRange(2, 8, rows.length, 1).setNumberFormat("0.000");  // Amount ada
  sheet.getRange(2, 9, rows.length, 1).setNumberFormat("0.000"); // Transaction fee
  sheet.getRange(2, 11, rows.length, 1).setNumberFormat("0.000"); // Balance delta ada
  sheet.getRange(2, 12, rows.length, 1).setNumberFormat("0.000"); // Balance delta in USD
  sheet.getRange(2,13,rows.length ,1).setNumberFormat("0.000000"); // ada - USD Rate 
  sheet.getRange(2,14,rows.length ,1).setNumberFormat("0.000"); // ada - USD Rate 
  sheet.autoResizeColumns(1, 15);
  sheet.getRange(1, 1, rows.length + 1, 15).setBorder(true, true, true, true, true, true);
}

// ============================================================================
// API Functions (same as before)
// ============================================================================

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

// function getPaymentAddresses(stakeAddress) { return apiCall(ACCOUNT_ADDRESSES_ENDPOINT, { _stake_addresses: [stakeAddress] })[0]?.addresses || []; }
// function getAddressTransactions(addresses) { return apiCall(ADDRESS_TXS_ENDPOINT, { _addresses: addresses }); }
function getStakeAddressesTransaction(stakeAddress) {return apiCall(STAKE_TXS_ENDPOINT, { _stake_address : stakeAddress}); }
function getTransactionDetails(txHashes) { return apiCall(TX_INFO_ENDPOINT, { _tx_hashes: txHashes }); }
function getTransactionUtxos(txHashes) { return apiCall(TX_UTXOS_ENDPOINT, { _tx_hashes: txHashes }); }
function lovelaceToAda(lovelace) { return parseFloat(lovelace) / 1000000; }
function getTransactionMetadata(txHashes) {return apiCall(TX_METADATA,{_tx_hashes: txHashes });} 

function getAdaUsdPrice(date) {
  try {
    const dateObj = new Date(date);
    const formattedDate = `${String(dateObj.getDate()).padStart(2,'0')}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${dateObj.getFullYear()}`;
    try {
      const response = UrlFetchApp.fetch(`https://api.coingecko.com/api/v3/coins/cardano/history?date=${formattedDate}`);
      const data = JSON.parse(response.getContentText());
      if (data.market_data?.current_price?.usd) return data.market_data.current_price.usd;
    } catch {}
    const currentPriceUrl = "https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd";
    const data = JSON.parse(UrlFetchApp.fetch(currentPriceUrl).getContentText());
    if (data.cardano?.usd) return data.cardano.usd;
    return 0.25;
  } catch { return 0.25; }
}

/**
 * Format timestamp to human readable
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Formatted date string
 */
function formatTimestamp(timestamp) { return Utilities.formatDate(new Date(timestamp*1000), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"); }

/**
 * Helper function to process with a specific spreadsheet ID
 * @param {string} spreadsheetId - The spreadsheet ID
 */
function processWithSpreadsheetId(spreadsheetId) {
  // Temporarily set the spreadsheet ID
  const originalId = SPREADSHEET_ID;
  // Note: We can't modify const variables, so we'll need to use a different approach
  
  // Use the direct method
  processAllStakeAddressesWithSpreadsheet(spreadsheetId);
}

/**
 * Helper function to process with a specific spreadsheet URL
 * @param {string} spreadsheetUrl - The spreadsheet URL
 */
function processWithSpreadsheetUrl(spreadsheetUrl) {
  const spreadsheetId = extractSpreadsheetIdFromUrl(spreadsheetUrl);
  if (!spreadsheetId) throw new Error("Invalid spreadsheet URL format");
  processAllStakeAddressesWithSpreadsheet(spreadsheetId);
}

/**
 * Process all stake addresses with a specific spreadsheet
 * @param {string} spreadsheetId - The spreadsheet ID
 */
function processAllStakeAddressesWithSpreadsheet(spreadsheetId) {
  try {
    console.log(`Processing with spreadsheet ID: ${spreadsheetId}`);
    
    // Get the source spreadsheet by ID
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    if (!spreadsheet) {
      throw new Error(`Could not open spreadsheet with ID: ${spreadsheetId}`);
    }
    
    // Get the source sheet
  const sourceSheet = spreadsheet.getSheetByName(SOURCE_SHEET_NAME);
    if (!sourceSheet) {
      throw new Error(`Could not find sheet: ${SOURCE_SHEET_NAME}`);
    }
    
    // Read the data from the source sheet
  const data = readStakeAddressData(sourceSheet);
    console.log(`Found ${data.length} stake addresses across ${Object.keys(data).length} buckets`);
    
    // Process each bucket
  for (const [bucketName, addresses] of Object.entries(data)) {
      console.log(`Processing bucket: ${bucketName} with ${addresses.length} addresses`);
    processBucket(bucketName, addresses, spreadsheet);
  }
    
    console.log("Batch processing completed successfully!");
    
  } catch (error) {
    console.error("Error in batch processing:", error.message);
    throw error;
  }
}

/**
 * Test function to run the batch processor
 * This is the function you'll run from Google Apps Script
 */
function myFunction() {
  processAllStakeAddresses();
}

/**
 * Example function showing how to use with spreadsheet ID
 * Replace the ID with your actual spreadsheet ID
 */
function runWithMySpreadsheet() {
  const mySpreadsheetId = "YOUR_SPREADSHEET_ID_HERE";
  processWithSpreadsheetId(mySpreadsheetId);
}

/**
 * Example function showing how to use with spreadsheet URL
 * Replace the URL with your actual spreadsheet URL
 */
function runWithMySpreadsheetUrl() {
  const mySpreadsheetUrl = "https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit";
  processWithSpreadsheetUrl(mySpreadsheetUrl);
}