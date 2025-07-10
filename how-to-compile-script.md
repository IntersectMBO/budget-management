# Guide: How to compile Treasury Contracts with Intersect configuration

This guide will help compile Intersect's 2025 Budget [Treasury Contracts](https://github.com/SundaeSwap-finance/treasury-contracts) instances.

Aiming to be able to verify the configuration and permissions of the script addresses.

## Prerequisites

- [Bun](https://bun.sh/)

## Steps

### 1. Clone the Treasury Contracts Github Repository

```shell
git clone https://github.com/SundaeSwap-finance/treasury-contracts.git
```

todo: checkout a specific version?

### 2. Navigate to the off-chain directory

```shell
cd ./treasury-contracts/off-chain
```

### 3. Install packages

```shell
bun install
```

### 4. Test that CLI works

```shell
bun run ./cli/cli.js -h
```

If this doesn't show you the help menu,
then something has gone wrong.

### 5. Run initialize

```shell
bun run ./cli/cli.js initialize
```

### 6. Follow the directions of the CLI


Choose your provider (Blockfrost or Maestro) and enter a project key for them

use blockfrost and project id of mainnetEbBouKVmh8AuDDsHxU9Q8JtjrcHuAja6

```shell
✔ Select the provider type Blockfrost
✔ Enter the Blockfrost project ID mainnet...
```

Enter Intersect's wallet address `addr1qyr5l2h8gelmp4qph7kzpzkqtky3mv9yvgkmwvdm3xweu3qu5zwsv0wyc267my62pruyl0ruw3gwjj0v9nucpqhn2gxsv56tkv`

```shell
✔ Enter the address of the wallet addr1qyr5l2h8gelmp4qph7kzpzkqtky3mv9yvgkmwvdm3xweu3qu5zwsv0wyc267my62pruyl0ruw3gwjj0v9nucpqhn2gxsv56tkv
```

Choose to register a new instance

``` shell
✔ Select saved configuration or register a new one Register a new instance
```

Choose manual for bootstrap UTxO selection

```shell
✔ How do you want to declare the bootstrap UTxO? Manual
```

Enter Intersect's bootstrap UTxO Enter Intersect's bootstrap UTxO: `31c2df71553c3c395fe3ae1ab0eb6e57aac28a0f5436ed413c3c8d2139c03a6d#0`

```shell
✔ Enter some transaction output (txId#idx) to spend to ensure the registry NFT is unique  31c2df71553c3c395fe3ae1ab0eb6e57aac28a0f5436ed413c3c8d2139c03a6d#0`
```