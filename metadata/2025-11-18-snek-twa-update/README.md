# 2025-11-18 Snek Loan Treasury Withdrawal Documentation Update

This transaction aims to anchor on-chain an updated documentation.

Superseding the draft executive summary published as part of the governance action.

## On-Chain Details

Transaction ID: `78feee8bb9435f445f204d72e9d2ac827858c94863b2a34c41d60d7b337fc0ef`

### Transaction Metadata

See [metadata.json](./metadata.json).

### How to verify author witnesses

For ease of verification we provide a method to verify the validity of provided author witnesses.

We will take the [metadata.json](./metadata.json),
make some superficial tweaks and then feed it into standard CIP-100 tooling -- https://verifycardanomessage.cardanofoundation.org/method=cip100.
Crucially, the body of the metadata never gets modified.

Due to this metadata being in transaction metadata, strings have been split into 64 chars max. For the  verifycardanomessage tooling we will have to combine these split strings.
Additionally we have used a linked context object, the tooling does not support this, so we will have to copy back in the full object.

#### 1. Add in full @context object

Unfortunately verifycardanomessage does not support context objects via URL,
so to validate the metadata we will have to manually copy in the whole CIP-100 @context object.

This can be found at https://raw.githubusercontent.com/cardano-foundation/CIPs/refs/heads/master/CIP-0100/cip-0100.common.jsonld

#### 2. Recombine Signatures

Recombine signature strings which have been split across multiple 64 char chunks.
This ensures that verifycardanomessage can read the signatures.

#### 3. Test on verifycardanomessage

You should have converted [metadata.json](./metadata.json) to now look like [metadata-to-validate.json](./metadata-to-validate.json).
And this should work with verifycardanomessage.

With the signatures both being valid, and from the expected keys matching the previous governance actions.
