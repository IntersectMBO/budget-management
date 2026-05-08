# 2026-04-07 Modify Input Output Engineering Core Development Proposal (5of6)

## Transaction ID : ``

## Transaction Inputs

The UTxO marked `UTXO-EC-0002-25-05`

#### UTXO:`b49d27563e6757ff1d61c8c42d6812680bbfbea5c4b8d48d6792f0d24fe76e5f#0`

## Transaction Outputs

Milestones 14 through 18 have been cancelled, each with a budget of 540,800 ada for a total of 2,704,000 ada. This amount should be returned to the treasury contract, while the remaining balance of 6,292,016 ada should remain within vendor contract, with all other milestones.

### Treasury reserve contract

#### DESTINATION:`addr1xxzc8pt7fgf0lc0x7eq6z7z6puhsxmzktna7dluahrj6g6v9swzhujsjlls7dajp59u95re0qdk9vh8mumlemw89535s4ecqxj`

#### AMOUNT_LOVELACE:`2704000000000`

### Change for Vendor Contract

#### CHANGE_AMOUNT:`6292016000000`

#### ADDRESS:`addr1xxyzewehw7dh78ea62mkgdnzmcdlcxqt4u39a7pqc0v0at5g9janwaum0u0nm54hvsmx9hsmlsvqhteztmuzps7cl6hq7d35th`

## Datum

- M-6 new payment date
  - 2026-07-30 00:00:00
  - 1785369600000
- M-9 new payment date
  - 2026-07-30 00:00:00
  - 1785369600000
- Removal of milestones with identifiers : M-14, M-15, M-16, M-17, M-18

## Required Signatures

- Oversight Committee
  - Sundae Labs keyhash : 1880102b04725318eb7a6f9f481815c82473c2f50cfe9932c85a3bf8
  - DQuadrant keyhash : 679ad28e567eb42ddb30a5cf6b5f066b2defbce393f19968d711f658
- Intersect Leadership
  - Leadership 2 keyhash: 91f5b1d436080c1beca93fbbb96596312d8f615b0ad9e94470af2224
- Intersect Admin
  - Admin 2 keyhash : a664de561ccd2ca9a07c060d4dd7cea4dc68ba89d4bf04b21ff0726f
  - Admin 1 keyhash : 1be0008bf2994524c0eaf0efdae4431e4a61ef7d974804fa794110b7
- The vendor
  - Vendor payment keyhash : 33afc56ecef7fc370f59d5574416826d6bd3d1f88e0f449ed5ae79f5
  - Vendor wallet address : addr1qye6l3twemmlcdc0t824w3qksfkkh573lz8q73y76kh8na0ua8vtvcf4r53sgychpd696knp4suy8f3mwgyt7d33cjds499p2r

## Transaction Metadata

See [metadata.json](./metadata.json).
