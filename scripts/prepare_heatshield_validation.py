#!/usr/bin/env python3
"""Create HeatShift's auditable HEAT-SHIELD validation slice.

The source is the public CC BY 4.0 individual-session workbook published at
https://doi.org/10.6084/m9.figshare.25722300.v1. This script deliberately uses
only Python's standard library so regenerating the CSV does not add a runtime or
deployment dependency.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree


SOURCE_URL = "https://ndownloader.figshare.com/files/46004385"
SOURCE_MD5 = "e36962603afbdbd6e9856936aacab62f"
EXPECTED_ROWS = 566
EXPECTED_PARTICIPANTS = 32
ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT_DIR / "data/validation/heatshield_trials.csv"

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

SOURCE_TO_OUTPUT = {
    "Study": "study_id",
    "id": "participant_id",
    "actual Ta": "air_temperature_c",
    "actual RH": "relative_humidity_percent",
    "v2": "air_speed_mps",
    "Solar": "solar_exposure",
    "Coverall": "high_clothing_coverage",
    "Apparent Temp": "apparent_temperature_c",
    "Heat Index C": "heat_index_c",
    "wbgtout": "wbgt_outdoor_c",
    "UTCI Globe (climatechip)": "utci_c",
    "PWC_loss": "measured_pwc_loss_percent",
}


def _download_source() -> Path:
    request = urllib.request.Request(
        SOURCE_URL,
        headers={"User-Agent": "HeatShift-AI-validation/1.0"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = response.read()
    temporary = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    temporary.write(payload)
    temporary.close()
    return Path(temporary.name)


def _verify_source(path: Path) -> None:
    digest = hashlib.md5(path.read_bytes(), usedforsecurity=False).hexdigest()
    if digest != SOURCE_MD5:
        raise ValueError(f"source MD5 mismatch: expected {SOURCE_MD5}, got {digest}")


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        xml = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ElementTree.fromstring(xml)
    return [
        "".join(node.text or "" for node in item.findall(f".//{{{MAIN_NS}}}t"))
        for item in root.findall(f"{{{MAIN_NS}}}si")
    ]


def _data_sheet_path(archive: zipfile.ZipFile) -> str:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    sheet = next(
        item
        for item in workbook.findall(f".//{{{MAIN_NS}}}sheet")
        if item.attrib.get("name") == "Data"
    )
    relationship_id = sheet.attrib[f"{{{DOC_REL_NS}}}id"]
    relationships = ElementTree.fromstring(
        archive.read("xl/_rels/workbook.xml.rels")
    )
    target = next(
        item.attrib["Target"]
        for item in relationships.findall(f"{{{REL_NS}}}Relationship")
        if item.attrib.get("Id") == relationship_id
    )
    return str(Path("xl") / target.lstrip("/"))


def _column_index(cell_reference: str) -> int:
    letters = re.match(r"[A-Z]+", cell_reference)
    if letters is None:
        raise ValueError(f"invalid cell reference: {cell_reference}")
    index = 0
    for letter in letters.group():
        index = index * 26 + ord(letter) - ord("A") + 1
    return index - 1


def _cell_value(cell: ElementTree.Element, shared: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(
            node.text or "" for node in cell.findall(f".//{{{MAIN_NS}}}t")
        )
    value = cell.find(f"{{{MAIN_NS}}}v")
    if value is None or value.text is None:
        return ""
    if cell_type == "s":
        return shared[int(value.text)]
    if cell_type == "b":
        return "true" if value.text == "1" else "false"
    return value.text


def _rows(path: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(path) as archive:
        shared = _shared_strings(archive)
        sheet = ElementTree.fromstring(archive.read(_data_sheet_path(archive)))
    xml_rows = sheet.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row")
    if not xml_rows:
        raise ValueError("Data worksheet is empty")

    def values(row: ElementTree.Element) -> dict[int, str]:
        return {
            _column_index(cell.attrib["r"]): _cell_value(cell, shared)
            for cell in row.findall(f"{{{MAIN_NS}}}c")
        }

    header_by_index = values(xml_rows[0])
    index_by_header = {header: index for index, header in header_by_index.items()}
    missing_headers = set(SOURCE_TO_OUTPUT) - set(index_by_header)
    if missing_headers:
        raise ValueError(f"source workbook is missing columns: {sorted(missing_headers)}")

    selected: list[dict[str, str]] = []
    for xml_row in xml_rows[1:]:
        row = values(xml_row)
        study_value = row.get(index_by_header["Study"], "")
        if not study_value:
            continue
        study_id = int(float(study_value))
        if study_id not in range(1, 7):
            continue
        output = {
            output_name: row.get(index_by_header[source_name], "")
            for source_name, output_name in SOURCE_TO_OUTPUT.items()
        }
        output["study_id"] = str(study_id)
        output["solar_exposure"] = (
            "true" if output["solar_exposure"].upper() == "YES" else "false"
        )
        output["high_clothing_coverage"] = (
            "true"
            if output["high_clothing_coverage"].upper() == "YES"
            else "false"
        )
        selected.append(output)
    return selected


def _validate(rows: list[dict[str, str]]) -> None:
    if len(rows) != EXPECTED_ROWS:
        raise ValueError(f"expected {EXPECTED_ROWS} rows, found {len(rows)}")
    participants = {row["participant_id"] for row in rows}
    if len(participants) != EXPECTED_PARTICIPANTS:
        raise ValueError(
            f"expected {EXPECTED_PARTICIPANTS} participants, found {len(participants)}"
        )
    for number, row in enumerate(rows, start=2):
        missing = [name for name, value in row.items() if value == ""]
        if missing:
            raise ValueError(f"CSV row {number} has missing fields: {missing}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-xlsx",
        type=Path,
        help="Use a local source file instead of downloading the public Figshare file.",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    source = args.source_xlsx or _download_source()
    _verify_source(source)
    rows = _rows(source)
    _validate(rows)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=list(SOURCE_TO_OUTPUT.values()),
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} validated records to {args.output}")


if __name__ == "__main__":
    main()
