#!/usr/bin/env python3
"""
README validation script for Cardano budget management repository.

Validates README.md files in metadata folders against their expected template
(disburse, modify, or modify-cancel) and performs on-chain UTXO checks.

Checks performed:
1. Heading structure matches the template in strict order
2. UTXO exists on-chain, belongs to the expected address, and is not spent
3. Change amount is correct (varies by type)
4. Required keyhashes satisfy the intersect.ak quorum rules
"""

from __future__ import annotations

import sys
import argparse
import re
import json
import urllib.request
import urllib.error
from pathlib import Path

# --- Constants ---

TREASURY_ADDRESS = (
    "addr1xxzc8pt7fgf0lc0x7eq6z7z6puhsxmzktna7dluahrj6g6v9swzhujsjlls7dajp59u95re0qdk9vh8mumlemw89535s4ecqxj"
)
VENDOR_ADDRESS = (
    "addr1xxyzewehw7dh78ea62mkgdnzmcdlcxqt4u39a7pqc0v0at5g9janwaum0u0nm54hvsmx9hsmlsvqhteztmuzps7cl6hq7d35th"
)

KOIOS_API_BASE = "https://api.koios.rest/api/v1"

# Template directory relative to repo root
TEMPLATE_DIR = Path("templates")

# Map folder keywords to transaction types
KEYWORD_TYPE_MAP = {
    "disburse": "disburse",
    "fund": "disburse",
    "initialise": "disburse",
    "initialize": "disburse",
    "modify": "modify",
    "modification": "modify",
    "modify-cancel": "modify-cancel",
}

# Expected address per transaction type
TYPE_ADDRESS_MAP = {
    "disburse": TREASURY_ADDRESS,
    "modify": VENDOR_ADDRESS,
    "modify-cancel": VENDOR_ADDRESS,
}


# --- Heading extraction ---

def extract_headings(text: str) -> list[str]:
    """
    Extract markdown headings from text, returning them in order.
    Only the heading prefix and tag are kept (e.g. '#### UTXO:').
    For h4 headings with a colon, everything after the colon is stripped
    (that is user input). For h1/h2 headings the full line is kept.

    Returns a list of normalised heading strings.
    """
    headings: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        m = re.match(r'^(#{1,6})\s+(.*)', stripped)
        if m:
            level = m.group(1)
            content = m.group(2).strip()
            if level in ("##", "####"):
                # Keep only the tag before the colon (plus the colon);
                # everything after is user-supplied data (tx hash, amounts…)
                colon_idx = content.find(":")
                if colon_idx != -1:
                    content = content[:colon_idx + 1]
            headings.append(f"{level} {content}")
    return headings


def load_template_headings(template_type: str, repo_root: Path) -> list[str]:
    """Load headings from the template README for the given type."""
    template_path = repo_root / TEMPLATE_DIR / template_type / "README.md"
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")
    return extract_headings(template_path.read_text())


# --- README field extraction ---

def extract_h4_fields(text: str) -> dict[str, str]:
    """
    Extract all h4 fields as key-value pairs.
    Example: '#### UTXO:`abc#0`' -> {'UTXO': 'abc#0'}
    """
    fields: dict[str, str] = {}
    for line in text.splitlines():
        m = re.match(r'^####\s+([A-Z_]+):\s*`?([^`]*)`?\s*$', line.strip())
        if m:
            fields[m.group(1)] = m.group(2)
    return fields


# --- Koios UTXO query ---

def query_utxo(utxo_ref: str) -> tuple[dict | None, bool]:
    """
    Query a single UTXO via Koios /utxo_info endpoint.

    Args:
        utxo_ref: UTXO reference in format 'tx_hash#index'

    Returns:
        (utxo_data, api_error) — api_error is True when the API could not be
        reached or returned an unexpected response (network/HTTP/parse failure).
        When api_error is True, emit a warning instead of a validation error.
    """
    url = f"{KOIOS_API_BASE}/utxo_info"
    payload = json.dumps({"_utxo_refs": [utxo_ref], "_extended": False}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "accept": "application/json",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            if isinstance(data, list) and len(data) > 0:
                return data[0], False
            return None, False  # API reachable but UTXO not found
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as e:
        print(f"  ⚠️  Koios API unreachable: {e}")
        return None, True  # API error — caller should warn, not fail


# --- Validation functions ---

def validate_heading_structure(
    readme_text: str,
    template_type: str,
    repo_root: Path,
) -> tuple[bool, list[str]]:
    """
    Validate that the README headings match the template in strict order.

    Returns (is_valid, list of error messages).
    """
    errors: list[str] = []
    try:
        expected = load_template_headings(template_type, repo_root)
    except FileNotFoundError as e:
        return False, [str(e)]

    actual = extract_headings(readme_text)

    # Skip h1 (title) — it is always user-provided content
    expected = [h for h in expected if not h.startswith("# ") or h.startswith("## ")]
    actual = [h for h in actual if not h.startswith("# ") or h.startswith("## ")]

    # Strict ordered comparison
    if len(actual) < len(expected):
        missing = expected[len(actual):]
        errors.append(
            f"Missing headings at end: {missing}"
        )
    elif len(actual) > len(expected):
        extra = actual[len(expected):]
        errors.append(
            f"Extra headings beyond template: {extra}"
        )

    for i, (exp, act) in enumerate(zip(expected, actual)):
        if exp != act:
            errors.append(
                f"Heading mismatch at position {i + 1}: "
                f"expected '{exp}', got '{act}'"
            )

    return len(errors) == 0, errors


def validate_utxo_onchain(
    utxo_ref: str,
    expected_address: str,
) -> tuple[bool, list[str], int | None, bool]:
    """
    Validate that the UTXO exists on-chain, belongs to the expected address,
    and is not spent.

    Returns (is_valid, errors, utxo_value_lovelace or None, api_unavailable).
    api_unavailable=True means Koios could not be reached; the caller should
    emit a warning and skip amount checks rather than treating it as a failure.
    """
    errors: list[str] = []

    # Basic format check
    if "#" not in utxo_ref:
        return False, [f"Invalid UTXO format '{utxo_ref}' — expected 'tx_hash#index'"], None, False

    parts = utxo_ref.split("#")
    if len(parts) != 2:
        return False, [f"Invalid UTXO format '{utxo_ref}' — expected 'tx_hash#index'"], None, False

    tx_hash, index_str = parts
    if not re.match(r'^[0-9a-fA-F]{64}$', tx_hash):
        return False, [f"Invalid tx_hash in UTXO: '{tx_hash}' — must be 64 hex chars"], None, False
    if not index_str.isdigit():
        return False, [f"Invalid index in UTXO: '{index_str}' — must be a number"], None, False

    utxo_data, api_error = query_utxo(utxo_ref)
    if api_error:
        return True, [], None, True  # API unreachable — not a validation failure
    if utxo_data is None:
        return False, [f"UTXO '{utxo_ref}' not found on-chain via Koios"], None, False

    # Check address
    onchain_address = utxo_data.get("address", "")
    if onchain_address != expected_address:
        errors.append(
            f"UTXO address mismatch: on-chain='{onchain_address}', "
            f"expected='{expected_address}'"
        )

    # Check spent status
    is_spent = utxo_data.get("is_spent", False)
    if is_spent:
        errors.append(f"UTXO '{utxo_ref}' has already been spent")

    # Extract value
    value_str = utxo_data.get("value", "0")
    try:
        value_lovelace = int(value_str)
    except (ValueError, TypeError):
        errors.append(f"Could not parse UTXO value: '{value_str}'")
        value_lovelace = None

    return len(errors) == 0, errors, value_lovelace, False


def validate_disburse_change(
    fields: dict[str, str],
    utxo_value_lovelace: int | None,
) -> tuple[bool, list[str]]:
    """
    For disburse: verify CHANGE_AMOUNT_LOVELACE = UTXO value - AMOUNT_LOVELACE.
    All values are in lovelace.

    If CHANGE_AMOUNT_LOVELACE is 'N/A', the full UTXO is being disbursed;
    we verify UTXO value == AMOUNT_LOVELACE.

    Returns (is_valid, errors).
    """
    errors: list[str] = []

    amount_str = fields.get("AMOUNT_LOVELACE", "")
    change_str = fields.get("CHANGE_AMOUNT_LOVELACE", "")

    if not amount_str:
        errors.append("Missing AMOUNT_LOVELACE field")
        return False, errors

    try:
        amount_lovelace = int(amount_str)
    except ValueError:
        errors.append(f"Invalid AMOUNT_LOVELACE value: '{amount_str}' — must be an integer")
        return False, errors

    if utxo_value_lovelace is None:
        errors.append("Cannot verify change amount: UTXO value unknown")
        return False, errors

    if change_str.upper() == "N/A" or change_str == "":
        if utxo_value_lovelace != amount_lovelace:
            errors.append(
                f"CHANGE_AMOUNT_LOVELACE is N/A but UTXO value ({utxo_value_lovelace}) != "
                f"AMOUNT_LOVELACE ({amount_lovelace}). "
                f"Expected change of {utxo_value_lovelace - amount_lovelace} lovelace"
            )
    else:
        try:
            change_lovelace = int(change_str)
        except ValueError:
            errors.append(
                f"Invalid CHANGE_AMOUNT_LOVELACE value: '{change_str}' — must be an integer or 'N/A'"
            )
            return False, errors

        expected_change = utxo_value_lovelace - amount_lovelace
        if change_lovelace != expected_change:
            errors.append(
                f"CHANGE_AMOUNT_LOVELACE mismatch: got {change_lovelace}, "
                f"expected {expected_change} "
                f"(UTXO {utxo_value_lovelace} - AMOUNT_LOVELACE {amount_lovelace})"
            )

    return len(errors) == 0, errors


def validate_modify_cancel_change(
    fields: dict[str, str],
    utxo_value_lovelace: int | None,
) -> tuple[bool, list[str]]:
    """
    For modify-cancel: verify AMOUNT_LOVELACE + CHANGE_AMOUNT_LOVELACE == UTXO value.
    AMOUNT_LOVELACE is returned to the treasury reserve contract;
    CHANGE_AMOUNT_LOVELACE stays in the vendor contract.

    Returns (is_valid, errors).
    """
    errors: list[str] = []

    amount_str = fields.get("AMOUNT_LOVELACE", "")
    change_str = fields.get("CHANGE_AMOUNT_LOVELACE", "")

    if not amount_str:
        errors.append("Missing AMOUNT_LOVELACE field")
    if not change_str:
        errors.append("Missing CHANGE_AMOUNT_LOVELACE field")
    if errors:
        return False, errors

    try:
        amount_lovelace = int(amount_str)
    except ValueError:
        return False, [f"Invalid AMOUNT_LOVELACE value: '{amount_str}' — must be an integer"]

    try:
        change_lovelace = int(change_str)
    except ValueError:
        return False, [f"Invalid CHANGE_AMOUNT_LOVELACE value: '{change_str}' — must be an integer"]

    if utxo_value_lovelace is None:
        errors.append("Cannot verify amounts: UTXO value unknown")
        return False, errors

    actual_total = amount_lovelace + change_lovelace
    if actual_total != utxo_value_lovelace:
        errors.append(
            f"Amount mismatch: AMOUNT_LOVELACE ({amount_lovelace}) + "
            f"CHANGE_AMOUNT_LOVELACE ({change_lovelace}) = {actual_total}, "
            f"expected {utxo_value_lovelace} (UTXO value)"
        )

    return len(errors) == 0, errors


def validate_modify_change(
    fields: dict[str, str],
    utxo_value_lovelace: int | None,
) -> tuple[bool, list[str]]:
    """
    For modify: verify CHANGE_AMOUNT_LOVELACE == UTXO value.
    No ada should be spent from the vendor contract, so the full
    value must be returned.

    Returns (is_valid, errors).
    """
    errors: list[str] = []

    change_str = fields.get("CHANGE_AMOUNT_LOVELACE", "")

    if not change_str:
        errors.append("Missing CHANGE_AMOUNT_LOVELACE field")
        return False, errors

    try:
        change_lovelace = int(change_str)
    except ValueError:
        errors.append(
            f"Invalid CHANGE_AMOUNT_LOVELACE value: '{change_str}' — must be an integer (lovelace)"
        )
        return False, errors

    if utxo_value_lovelace is None:
        errors.append("Cannot verify change amount: UTXO value unknown")
        return False, errors

    if change_lovelace != utxo_value_lovelace:
        errors.append(
            f"CHANGE_AMOUNT_LOVELACE mismatch: got {change_lovelace}, "
            f"expected {utxo_value_lovelace} "
            f"(no ada should be spent from the vendor contract)"
        )

    return len(errors) == 0, errors


# --- Keyhash validation ---

def extract_intersect_keyhashes(readme_text: str) -> list[str]:
    """
    Extract keyhashes from the Required Signatures section of a README,
    excluding the vendor sub-section (vendor keys are contract-specific
    and not present in intersect.ak).

    Returns a list of lowercase 56-char hex keyhashes.
    """
    # Isolate the Required Signatures section
    sig_section = ""
    in_section = False
    for line in readme_text.splitlines():
        if re.match(r'^##\s+Required Signatures', line.strip()):
            in_section = True
            continue
        if re.match(r'^##\s+', line.strip()) and in_section:
            break
        if in_section:
            sig_section += line + "\n"

    # Drop everything from "- The vendor" onwards
    vendor_match = re.search(r'^\s*-\s+The vendor', sig_section, re.MULTILINE)
    if vendor_match:
        sig_section = sig_section[: vendor_match.start()]

    return [
        kh.lower()
        for kh in re.findall(r'keyhash\s*:\s*([0-9a-fA-F]{56})', sig_section, re.IGNORECASE)
    ]


def load_keyhash_config(repo_root: Path) -> dict:
    """
    Load the keyhash registry and quorum rules from
    .github/scripts/keyhashes.json relative to the repo root.
    """
    config_path = repo_root / ".github" / "scripts" / "keyhashes.json"
    if not config_path.exists():
        raise FileNotFoundError(f"Keyhash config not found: {config_path}")
    with open(config_path) as f:
        return json.load(f)


def validate_keyhashes(
    readme_text: str,
    repo_root: Path,
    rule_key: str,
) -> tuple[bool, list[str]]:
    """
    Validate Required Signatures keyhashes against the quorum rules defined
    in keyhashes.json for the given rule_key.

    Supported rule keys (expand quorum_rules in keyhashes.json to add more):
      - "modify"  — used for modify and modify-cancel transaction types
      - "cancel"  — for full cancellation (when rules are defined)
      - "disburse" — for disbursement transactions

    Each rule specifies a label, a list of entity names, and the minimum
    number of distinct entities that must be present.

    Returns (is_valid, list of error messages).
    """
    errors: list[str] = []

    try:
        config = load_keyhash_config(repo_root)
    except FileNotFoundError as e:
        return False, [str(e)]

    entities: dict = config["entities"]
    rules: list = config["quorum_rules"].get(rule_key, [])

    # Build reverse lookup: keyhash (lowercase) -> entity name
    kh_to_entity: dict[str, str] = {
        kh.lower(): name
        for name, entity in entities.items()
        for kh in entity["keyhashes"]
    }

    keyhashes = extract_intersect_keyhashes(readme_text)
    if not keyhashes:
        return False, ["No Intersect keyhashes found in Required Signatures section"]

    # Map each keyhash to its entity; flag anything unrecognised
    signed_entities: set[str] = set()
    unknown: list[str] = []
    for kh in keyhashes:
        entity = kh_to_entity.get(kh)
        if entity:
            signed_entities.add(entity)
        else:
            unknown.append(kh)

    if unknown:
        errors.append(f"Unrecognised keyhash(es) not in keyhashes.json: {unknown}")

    # Apply each quorum rule from the config
    for rule in rules:
        label    = rule["label"]
        group    = set(rule["entities"])
        required = rule["required"]
        signed   = signed_entities & group
        if len(signed) < required:
            errors.append(
                f"Insufficient {label} signatures: {len(signed)} recognised, "
                f"need at least {required} of ({', '.join(rule['entities'])})"
            )

    return len(errors) == 0, errors


# --- Main validation orchestrator ---

def detect_type_from_folder(folder_name: str) -> str | None:
    """
    Detect the transaction type from the folder keyword.
    Folder format: YYYY-MM-DD-keyword[-keyword2]-text

    Checks for compound keywords first (e.g. 'modify-cancel'),
    including the legacy 'modify-to-cancel' naming.
    """
    parts = folder_name.split("-")
    if len(parts) < 4:
        return None
    # Check compound keyword (parts[3]-parts[4])
    if len(parts) > 4:
        compound = f"{parts[3].lower()}-{parts[4].lower()}"
        if compound in KEYWORD_TYPE_MAP:
            return KEYWORD_TYPE_MAP[compound]
        # Legacy: modify-to-cancel → modify-cancel
        if len(parts) > 5 and compound == "modify-to" and parts[5].lower() == "cancel":
            return "modify-cancel"
    keyword = parts[3].lower()
    return KEYWORD_TYPE_MAP.get(keyword)


def validate_readme(
    readme_path: Path,
    folder_name: str,
    repo_root: Path,
    skip_onchain: bool = False,
) -> tuple[bool, list[str]]:
    """
    Run all README validations for a single metadata folder.

    Args:
        readme_path: Path to the README.md file
        folder_name: Name of the metadata folder (e.g. '2026-02-05-disburse-foo')
        repo_root: Repository root path
        skip_onchain: If True, skip on-chain UTXO checks

    Returns:
        (all_valid, list of error messages)
    """
    all_errors: list[str] = []

    if not readme_path.exists():
        return False, [f"README.md not found: {readme_path}"]

    readme_text = readme_path.read_text()
    tx_type = detect_type_from_folder(folder_name)

    if tx_type is None:
        return False, [
            f"Cannot determine type from folder '{folder_name}'. "
            f"Expected keyword: {', '.join(KEYWORD_TYPE_MAP.keys())}"
        ]

    # 1. Heading structure validation
    valid, errs = validate_heading_structure(readme_text, tx_type, repo_root)
    if not valid:
        all_errors.extend(errs)

    # 2. Extract h4 fields
    fields = extract_h4_fields(readme_text)
    utxo_ref = fields.get("UTXO", "")
    if not utxo_ref:
        all_errors.append("Missing #### UTXO field in README")

    if skip_onchain:
        print("  ℹ️  Skipping on-chain UTXO checks (--skip-onchain)")
    elif utxo_ref:
        # 3. On-chain UTXO validation
        expected_address = TYPE_ADDRESS_MAP[tx_type]
        valid, errs, utxo_value, api_unavailable = validate_utxo_onchain(utxo_ref, expected_address)
        if api_unavailable:
            print("  ⚠️  Koios API unreachable — UTXO not checked, amounts skipped")
        else:
            if not valid:
                all_errors.extend(errs)

            # 4. Change amount validation
            if tx_type == "disburse":
                valid, errs = validate_disburse_change(fields, utxo_value)
                if not valid:
                    all_errors.extend(errs)
            elif tx_type == "modify-cancel":
                valid, errs = validate_modify_cancel_change(fields, utxo_value)
                if not valid:
                    all_errors.extend(errs)
            elif tx_type == "modify":
                valid, errs = validate_modify_change(fields, utxo_value)
                if not valid:
                    all_errors.extend(errs)

    # 5. Keyhash quorum validation (driven by type_rule_map in keyhashes.json)
    try:
        kh_config = load_keyhash_config(repo_root)
        rule_key = kh_config.get("type_rule_map", {}).get(tx_type)
        if rule_key:
            valid, errs = validate_keyhashes(readme_text, repo_root, rule_key)
            if not valid:
                all_errors.extend(errs)
    except FileNotFoundError as e:
        all_errors.append(str(e))

    return len(all_errors) == 0, all_errors


def validate_readmes(
    metadata_path: str,
    folders: list[str],
    repo_root: str,
    skip_onchain: bool = False,
) -> bool:
    """
    Validate README.md files for all given metadata folders.

    Returns True if all pass, False otherwise.
    """
    repo = Path(repo_root)
    all_valid = True

    for folder in folders:
        readme_file = Path(metadata_path) / folder / "README.md"
        print(f"\n📄 Validating README: {folder}/README.md")

        valid, errors = validate_readme(readme_file, folder, repo, skip_onchain)
        if valid:
            print(f"  ✓ All README checks passed")
        else:
            print(f"  ❌ README validation failed:")
            for err in errors:
                print(f"     - {err}")
            all_valid = False

    return all_valid


def main():
    parser = argparse.ArgumentParser(
        description="Validate README.md files against templates and on-chain data"
    )
    parser.add_argument(
        "--folders",
        type=str,
        required=True,
        help="Newline-separated folder names to validate",
    )
    parser.add_argument(
        "--metadata-path",
        type=str,
        default="metadata",
        help="Path to metadata directory (default: metadata)",
    )
    parser.add_argument(
        "--repo-root",
        type=str,
        default=".",
        help="Path to repository root (default: current directory)",
    )
    parser.add_argument(
        "--skip-onchain",
        action="store_true",
        help="Skip on-chain UTXO checks (for offline testing)",
    )

    args = parser.parse_args()

    folders = [f.strip() for f in args.folders.strip().split("\n") if f.strip()]
    if not folders:
        print("ℹ️  No folders to validate")
        return 0

    print("🔍 Running README validation...\n")

    success = validate_readmes(
        args.metadata_path, folders, args.repo_root, args.skip_onchain
    )

    if success:
        print("\n✅ All README validations passed!")
        return 0
    else:
        print("\n❌ Some README validations failed!")
        return 1


if __name__ == "__main__":
    sys.exit(main())
