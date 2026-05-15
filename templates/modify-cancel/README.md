# YYYY-MM-DD Modify/Cancel [INSERT-TITLE]

## Transaction ID : ``

## Transaction Inputs

The UTxO marked `insert label`

#### UTXO:`tx-hash#index`

## Transaction Outputs

[Describe the cancelled milestones, the amount returned to the treasury, and the remaining balance redirected to the vendor contract.]

### Treasury reserve contract

#### DESTINATION:`treasury-address`

#### AMOUNT_LOVELACE:`amount-in-lovelace`

### Change for Vendor Contract

#### CHANGE_AMOUNT_LOVELACE:`amount-in-lovelace`

#### ADDRESS:`vendor-contract-address`

## Datum

[Describe the removal of cancelled milestones from the datum and the modified ones]

## Required Signatures

- Oversight Committee
  - [org] keyhash : [keyhash]
  - [org] keyhash : [keyhash]
- Intersect Leadership
  - Leadership [n] keyhash: [keyhash]
- Intersect Admin
  - Admin [n] keyhash : [keyhash]
  - Admin [n] keyhash : [keyhash]
- The vendor
  - Vendor payment keyhash : [keyhash]
  - Vendor wallet address : [address]

## Transaction Metadata

See [metadata.json](./metadata.json).
