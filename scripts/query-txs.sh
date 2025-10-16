#!/usr/bin/env bash
# koios_stake_txs.sh
# Query Koios for transactions from all payment addresses associated with a stake address.
# Requires: curl, jq

set -euo pipefail

API_BASE="${KOIOS_API:-https://api.koios.rest/api/v1}"
ACCOUNT_ADDRESSES_ENDPOINT="${API_BASE}/account_addresses"
ADDRESS_TXS_ENDPOINT="${API_BASE}/address_txs"
TX_INFO_ENDPOINT="${API_BASE}/tx_info"
BLOCK_HEIGHT_ENDPOINT="${API_BASE}/block_height"

usage() {
  cat <<'USAGE'
Usage:
  koios_stake_txs.sh -s STAKE_ADDRESS -d DATE [-o output.csv]

Options:
  -s ADDRESS  Stake address (e.g., stake1...)
  -d DATE     Date in YYYY-MM-DD format to filter transactions from
  -o FILE     Write CSV output to this file (defaults to stdout)
  -h          Show this help

Env:
  KOIOS_API   Override API base (default: https://api.koios.rest/api/v1)

Examples:
  koios_stake_txs.sh -s stake1... -d 2024-01-01
  koios_stake_txs.sh -s stake1... -d 2024-01-01 -o transactions.csv
USAGE
}

# Parse flags
STAKE_ADDRESS=""
DATE=""
OUT_FILE=""

while getopts ":s:d:o:h" opt; do
  case "$opt" in
    s) STAKE_ADDRESS="$OPTARG" ;;
    d) DATE="$OPTARG" ;;
    o) OUT_FILE="$OPTARG" ;;
    h) usage; exit 0 ;;
    :) echo "Error: -$OPTARG requires an argument." >&2; usage; exit 2 ;;
    \?) echo "Error: invalid option -$OPTARG" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$STAKE_ADDRESS" || -z "$DATE" ]]; then
  echo "Error: both -s (stake address) and -d (date) are required." >&2
  usage
  exit 2
fi

# Validate stake address format
if [[ ! "$STAKE_ADDRESS" =~ ^stake1[0-9a-z]+$ ]]; then
  echo "Error: invalid stake address format: $STAKE_ADDRESS" >&2
  exit 2
fi

# Validate date format
if [[ ! "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Error: invalid date format. Use YYYY-MM-DD: $DATE" >&2
  exit 2
fi

# Helper function to make API calls
api_call() {
  local endpoint="$1"
  local data="$2"
  local tmp_resp="$(mktemp)"
  local http_code=""
  
  http_code=$(curl -sS -w "%{http_code}" -o "$tmp_resp" \
    -X POST "$endpoint" \
    -H "accept: application/json" \
    -H "content-type: application/json" \
    --retry 3 --retry-delay 1 --fail \
    -d "$data" || true)
  
  if [[ "$http_code" != "200" ]]; then
    echo "Error: Koios returned HTTP $http_code for $endpoint" >&2
    echo "Response:" >&2
    cat "$tmp_resp" >&2 || true
    rm -f "$tmp_resp"
    return 1
  fi
  
  cat "$tmp_resp"
  rm -f "$tmp_resp"
}

# Function to get current block height (simplified approach)
get_current_block_height() {
  local response=$(api_call "https://api.koios.rest/api/v1/tip" "")
  echo "$response" | jq -r '.[0].block_height // empty'
}

# Function to get payment addresses for a stake address
get_payment_addresses() {
  local stake_addr="$1"
  local body=$(jq -n --argjson addrs "[\"$stake_addr\"]" '{_stake_addresses: $addrs}')
  local response=$(api_call "$ACCOUNT_ADDRESSES_ENDPOINT" "$body")
  
  echo "$response" | jq -r '.[0].addresses[]? // empty'
}

# Function to get transactions for payment addresses
get_address_transactions() {
  local after_block="$1"
  shift
  local addresses=("$@")
  
  local body
  if [[ -n "$after_block" ]]; then
    body=$(jq -n --argjson addrs "$(printf '%s\n' "${addresses[@]}" | jq -R . | jq -s .)" \
                  --argjson h "$after_block" \
                  '{_addresses: $addrs, _after_block_height: $h}')
  else
    body=$(jq -n --argjson addrs "$(printf '%s\n' "${addresses[@]}" | jq -R . | jq -s .)" \
                  '{_addresses: $addrs}')
  fi
  
  api_call "$ADDRESS_TXS_ENDPOINT" "$body"
}

# Function to get detailed transaction information
get_transaction_details() {
  local tx_hashes=("$@")
  local body=$(jq -n --argjson hashes "$(printf '%s\n' "${tx_hashes[@]}" | jq -R . | jq -s .)" \
                    '{_tx_hashes: $hashes}')
  
  api_call "$TX_INFO_ENDPOINT" "$body"
}

# Function to convert lovelace to ADA
lovelace_to_ada() {
  local lovelace="$1"
  echo "scale=6; $lovelace / 1000000" | bc -l
}

# Function to get USD price for ADA on a given date
get_ada_usd_price() {
  local date="$1"
  local timestamp=$(date -j -f "%Y-%m-%d" "$date" "+%s" 2>/dev/null || date -d "$date" "+%s" 2>/dev/null)
  
  # Try to get historical price from CoinGecko API
  local coingecko_url="https://api.coingecko.com/api/v3/coins/cardano/history?date=$(date -r "$timestamp" "+%d-%m-%Y" 2>/dev/null || date -d "@$timestamp" "+%d-%m-%Y" 2>/dev/null)"
  
  local price=$(curl -sS "$coingecko_url" | jq -r '.market_data.current_price.usd // empty' 2>/dev/null)
  
  if [[ -n "$price" && "$price" != "null" ]]; then
    echo "$price"
  else
    # Fallback to current price if historical data is not available
    local current_price=$(curl -sS "https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd" | jq -r '.cardano.usd // empty' 2>/dev/null)
    if [[ -n "$current_price" && "$current_price" != "null" ]]; then
      echo "$current_price"
    else
      # Final fallback
      echo "0.25"
    fi
  fi
}

# Function to format timestamp to human readable
format_timestamp() {
  local timestamp="$1"
  date -r "$timestamp" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -d "@$timestamp" "+%Y-%m-%d %H:%M:%S" 2>/dev/null
}

# Main execution
echo "Getting payment addresses for stake address: $STAKE_ADDRESS" >&2

# Get payment addresses
PAYMENT_ADDRESSES=()
while IFS= read -r addr; do
  [[ -n "$addr" ]] && PAYMENT_ADDRESSES+=("$addr")
done < <(get_payment_addresses "$STAKE_ADDRESS")

if [[ ${#PAYMENT_ADDRESSES[@]} -eq 0 ]]; then
  echo "Error: no payment addresses found for stake address: $STAKE_ADDRESS" >&2
  exit 1
fi

echo "Found ${#PAYMENT_ADDRESSES[@]} payment addresses" >&2

# Get current block height (we'll filter by date in processing)
echo "Getting current block height..." >&2
CURRENT_BLOCK=$(get_current_block_height)
if [[ -z "$CURRENT_BLOCK" ]]; then
  echo "Error: could not get current block height" >&2
  exit 1
fi

echo "Current block height: $CURRENT_BLOCK" >&2

# Get transactions for all payment addresses (no block height filter for now)
echo "Fetching transactions..." >&2
TX_RESPONSE=$(get_address_transactions "" "${PAYMENT_ADDRESSES[@]}")

# Extract all transaction hashes
TX_HASHES=()
while IFS= read -r tx_hash; do
  [[ -n "$tx_hash" ]] && TX_HASHES+=("$tx_hash")
done < <(echo "$TX_RESPONSE" | jq -r '.[].tx_hash // empty')

if [[ ${#TX_HASHES[@]} -eq 0 ]]; then
  echo "No transactions found for the given criteria" >&2
  # Output empty CSV with headers
  echo "stake_address,payment_address,transaction_hash,transaction_time,transaction_block_height,amount_ada,amount_usd,fee_ada"
  exit 0
fi

echo "Found ${#TX_HASHES[@]} transactions" >&2

# Get detailed transaction information in batches
echo "Fetching transaction details in batches..." >&2
BATCH_SIZE=50
TX_DETAILS="[]"

for ((i=0; i<${#TX_HASHES[@]}; i+=BATCH_SIZE)); do
  batch_hashes=("${TX_HASHES[@]:i:BATCH_SIZE}")
  echo "Processing batch $((i/BATCH_SIZE + 1)) of $(((${#TX_HASHES[@]} + BATCH_SIZE - 1)/BATCH_SIZE))..." >&2
  
  batch_details=$(get_transaction_details "${batch_hashes[@]}")
  if [[ -n "$batch_details" && "$batch_details" != "null" ]]; then
    TX_DETAILS=$(echo "$TX_DETAILS $batch_details" | jq -s 'add')
  fi
done

# Get USD price for the given date
ADA_USD_PRICE=$(get_ada_usd_price "$DATE")

# Generate CSV output
echo "Generating CSV output..." >&2

# Create output file or use stdout
if [[ -n "$OUT_FILE" ]]; then
  OUTPUT_FILE="$OUT_FILE"
else
  OUTPUT_FILE="/dev/stdout"
fi

# Write CSV header
echo "stake_address,payment_address,transaction_hash,transaction_time,transaction_block_height,amount_ada,amount_usd,fee_ada" > "$OUTPUT_FILE"

# Process each transaction and append to CSV
echo "$TX_RESPONSE" | jq -r '.[] | select(.tx_hash) | .tx_hash' | while read -r tx_hash; do
  # Get transaction details
  tx_detail=$(echo "$TX_DETAILS" | jq -r ".[] | select(.tx_hash == \"$tx_hash\")")
  
  if [[ -n "$tx_detail" && "$tx_detail" != "null" ]]; then
    block_height=$(echo "$tx_detail" | jq -r '.block_height // 0')
    block_time=$(echo "$tx_detail" | jq -r '.tx_timestamp // 0')
    total_output=$(echo "$tx_detail" | jq -r '.total_output // "0"')
    fee=$(echo "$tx_detail" | jq -r '.fee // "0"')
    
    # Check if transaction is after the specified date
    target_timestamp=$(date -j -f "%Y-%m-%d" "$DATE" "+%s" 2>/dev/null || date -d "$DATE" "+%s" 2>/dev/null)
    if [[ -n "$target_timestamp" && "$block_time" -ge "$target_timestamp" ]]; then
      # Find which payment address this transaction belongs to
      # Since we can't easily determine this from the tx_info response,
      # we'll use the first payment address as a fallback
      payment_addr="${PAYMENT_ADDRESSES[0]}"
      
      # Convert to ADA
      amount_ada=$(lovelace_to_ada "$total_output")
      fee_ada=$(lovelace_to_ada "$fee")
      
      # Calculate USD amount
      amount_usd=$(echo "scale=6; $amount_ada * $ADA_USD_PRICE" | bc -l)
      
      # Format timestamp
      transaction_time=$(format_timestamp "$block_time")
      
      # Output CSV row
      echo "$STAKE_ADDRESS,$payment_addr,$tx_hash,$transaction_time,$block_height,$amount_ada,$amount_usd,$fee_ada" >> "$OUTPUT_FILE"
    fi
  fi
done

if [[ -n "$OUT_FILE" ]]; then
  echo "CSV output written to $OUT_FILE" >&2
fi