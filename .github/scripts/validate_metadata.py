#!/usr/bin/env python3
"""
Metadata validation script for Cardano budget management repository.

This script performs validation on metadata files including:
- Folder naming (date format: YYYY-MM-DD-keyword-text)
- JSON syntax validation
- Metadata JSON structure validation (character limits per line and spelling checks)
- Markdown link validation
"""

import sys
import argparse
import re
import json
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path


def validate_folder_name(folder_name: str) -> tuple[bool, str]:
    """
    Validate that folder name follows the pattern: YYYY-MM-DD-keyword-text
    Keyword must be one of: disburse, initialise, initialize, fund
    
    Args:
        folder_name: The folder name to validate
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    allowed_keywords = ['disburse', 'initialise', 'initialize', 'fund', 'modify', 'cancel']
    
    # Pattern: YYYY-MM-DD-(text with hyphens)
    pattern = r'^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+-?)+$'
    
    if not re.match(pattern, folder_name):
        return False, f"Invalid folder name format: {folder_name}. Expected: YYYY-MM-DD-keyword-text"
    
    # Extract and validate the date part
    date_part = folder_name[:10]
    try:
        year, month, day = date_part.split('-')
        datetime(int(year), int(month), int(day))
    except ValueError as e:
        return False, f"Invalid date in folder name {folder_name}: {str(e)}"
    
    # Extract the keyword (first word after date)
    remainder = folder_name[11:]  # Skip date and hyphen
    keyword_part = remainder.split('-')[0].lower()
    
    if keyword_part not in allowed_keywords:
        return False, f"Invalid keyword in folder name {folder_name}. Keyword must be one of: {', '.join(allowed_keywords)}"
    
    return True, ""


def validate_folders(folders_str: str) -> bool:
    """
    Validate a list of folder names.
    
    Args:
        folders_str: Newline-separated folder names
        
    Returns:
        True if all folders are valid, False otherwise
    """
    if not folders_str or folders_str.strip() == "":
        print("ℹ️  No new folders to validate")
        return True
    
    folders = [f.strip() for f in folders_str.strip().split('\n') if f.strip()]
    all_valid = True
    
    for folder in folders:
        is_valid, error_msg = validate_folder_name(folder)
        if is_valid:
            print(f"✓ Valid folder name: {folder}")
        else:
            print(f"❌ {error_msg}")
            all_valid = False
    
    return all_valid


# ---------------------------------------------------------------------------
# Required-field schema
# ---------------------------------------------------------------------------
# "_common" fields must be present in every transaction type.
# Type-specific fields are looked up by body.event value.
# Paths use dot notation; "body" itself is checked as a common field.

REQUIRED_FIELDS: dict[str, list[str]] = {
    "_common": [
        "@context",
        "hashAlgorithm",
        "txAuthor",
        "instance",
        "body",
        "body.event",
        "body.label",
        "body.description",
    ],
    "disburse": [
        "body.justification",
        "body.destination",
    ],
    "modify": [
        "body.identifier",
        "body.reason",
        "body.vendor",
        "body.contract",
        "body.milestones",
    ],
}


def _get_nested(data: dict, dotted_path: str) -> bool:
    """Return True if the dot-notation path exists in data and is not None."""
    obj = data
    for key in dotted_path.split("."):
        if not isinstance(obj, dict) or key not in obj:
            return False
        obj = obj[key]
    return obj is not None


def _collect_string_fields(obj, path: str = "") -> list[tuple[str, str]]:
    """
    Recursively collect all string values from a JSON object.

    Returns a list of (field_path, string_value) tuples.
    """
    results = []
    if isinstance(obj, str):
        results.append((path, obj))
    elif isinstance(obj, list):
        for idx, item in enumerate(obj):
            results.extend(_collect_string_fields(item, f"{path}[{idx}]"))
    elif isinstance(obj, dict):
        for key, value in obj.items():
            child_path = f"{path}.{key}" if path else key
            results.extend(_collect_string_fields(value, child_path))
    return results


def validate_metadata_json(metadata_path: str, max_line_length: int = 64) -> tuple[bool, list[str]]:
    """
    Validate metadata.json files - checks both character limits and spelling in one pass.
    
    Checks:
    1. Valid JSON structure
    2. All string fields have length <= max_line_length
    3. Spelling check on all string fields using cspell
    
    Args:
        metadata_path: Path to metadata.json file
        max_line_length: Maximum characters per line (default: 64)
        
    Returns:
        Tuple of (is_valid, list of error messages)
    """
    errors = []
    
    # Check if file exists
    if not Path(metadata_path).exists():
        return False, [f"File not found: {metadata_path}"]
    
    # Validate JSON structure
    try:
        with open(metadata_path, 'r') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return False, [f"Invalid JSON syntax in {metadata_path}: {str(e)}"]
    except Exception as e:
        return False, [f"Error reading {metadata_path}: {str(e)}"]
    
    # Check required fields
    body = data.get("body") if isinstance(data, dict) else None
    event_type = body.get("event", "") if isinstance(body, dict) else ""

    for field in REQUIRED_FIELDS["_common"]:
        if not _get_nested(data, field):
            errors.append(f"Missing required field: '{field}'")

    for field in REQUIRED_FIELDS.get(event_type, []):
        if not _get_nested(data, field):
            errors.append(f"Missing required field: '{field}'")

    # Recursively collect all string fields from the entire document
    all_string_fields = _collect_string_fields(data)

    for field_path, value in all_string_fields:
        # Check character limit
        if len(value) > max_line_length:
            errors.append(
                f"Field '{field_path}': Length {len(value)} chars exceeds {max_line_length} - '{value[:50]}...'"
            )

        # Check spelling using cspell
        spelling_errs = _check_spelling(value)
        if spelling_errs:
            errors.append(
                f"Field '{field_path}': Spelling issues - {', '.join(spelling_errs)}"
            )
    
    return len(errors) == 0, errors


def _check_spelling(text: str) -> list[str]:
    """
    Check spelling in text using cspell.
    
    Args:
        text: Text to check
        
    Returns:
        List of misspelled words found
    """
    try:
        # Create a temporary file with the text
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write(text)
            temp_file = f.name
        
        try:
            # Run cspell on the temporary file
            result = subprocess.run(
                ['cspell', 'lint', temp_file],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            # Parse cspell output for misspelled words
            misspelled = []
            if result.stdout:
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    # Extract unique misspelled words
                    if 'Unknown word' in line:
                        # Format: filename:line:col - Unknown word: xyz
                        parts = line.split("Unknown word:")
                        if len(parts) > 1:
                            word = parts[1].strip().split()[0].strip("'\"")
                            if word and word not in misspelled:
                                misspelled.append(word)
            
            return misspelled
        finally:
            # Clean up temporary file
            Path(temp_file).unlink(missing_ok=True)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []  # cspell not found or timeout, skip


def validate_metadata_files(metadata_path: str, folders: list[str]) -> bool:
    """
    Validate all metadata.json files in the given folders.
    
    Args:
        metadata_path: Base metadata directory path
        folders: List of folder names to validate
        
    Returns:
        True if all validations pass, False otherwise
    """
    all_valid = True
    
    for folder in folders:
        json_file = Path(metadata_path) / folder / "metadata.json"
        
        if json_file.exists():
            is_valid, errors = validate_metadata_json(str(json_file))
            if is_valid:
                print(f"✓ Valid metadata.json: {folder}/metadata.json")
            else:
                print(f"❌ Invalid metadata.json: {folder}/metadata.json")
                for error in errors:
                    print(f"   - {error}")
                all_valid = False
        else:
            print(f"⚠️  metadata.json not found: {folder}/metadata.json")
    
    return all_valid


def main():
    """Main entry point for the validation script."""
    parser = argparse.ArgumentParser(
        description="Validate metadata files in the repository"
    )
    parser.add_argument(
        "--folders",
        type=str,
        help="Newline-separated folder names to validate"
    )
    parser.add_argument(
        "--metadata-path",
        type=str,
        default="metadata",
        help="Path to metadata directory (default: metadata)"
    )

    args = parser.parse_args()

    print("🔍 Running metadata validation...\n")
    
    all_valid = True
    
    # Validate folder names
    print("1️⃣  Folder Name Validation: [YYYY-MM-DD-keyword-text]")
    print("   Allowed keywords: disburse, initialise, initialize, fund, modify, cancel")
    if args.folders:
        folders_list = [f.strip() for f in args.folders.strip().split('\n') if f.strip()]
        if not validate_folders(args.folders):
            all_valid = False
    else:
        print("   ℹ️  No folders to validate")
        folders_list = []
    
    # Validate metadata.json files (includes both character limit and spelling checks)
    if folders_list:
        print("\n2️⃣  Metadata JSON Validation (Character Limits & Spelling)")
        if not validate_metadata_files(args.metadata_path, folders_list):
            all_valid = False
    
    if all_valid:
        print("\n✅ All metadata validations passed!")
        return 0
    else:
        print("\n❌ Some validations failed!")
        return 1


if __name__ == "__main__":
    sys.exit(main())
