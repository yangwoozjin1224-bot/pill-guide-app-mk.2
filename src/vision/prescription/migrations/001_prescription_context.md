# Migration 001 — PrescriptionContext (local schema v1)

**Type:** Client localStorage schema (no server DB)  
**Key:** `pillguide:prescription`  
**Version field:** `schemaVersion: 1`

## Purpose
Persist medicine-bag / prescription OCR drug list so pill recognition can
narrow matching to a `candidatePool` (Phase 1).

## Document shape

```json
{
  "id": "rx_1710000000000",
  "updatedAt": 1710000000000,
  "schemaVersion": 1,
  "drugs": [
    {
      "name": "타이레놀정500밀리그램",
      "itemSeq": "123456789",
      "entpName": "…",
      "imageUrl": "…",
      "mark": "TYLENOL",
      "PRINT_FRONT": "TYLENOL",
      "PRINT_BACK": "",
      "color": "하양",
      "COLOR_CLASS1": "하양",
      "shape": "원형",
      "DRUG_SHAPE": "원형",
      "source": "bag_ocr"
    }
  ],
  "rawStructured": null
}
```

## Upgrade rules
- If `schemaVersion` ≠ 1 → ignore and treat as empty (safe reset).
- Future migrations must bump `schemaVersion` and convert in code;
  do not mutate this file in place for breaking changes — add `002_*.md`.

## Privacy
- Stores drug names / itemSeq only (from public catalog + OCR).
- Does **not** store raw prescription photo bytes.
- User may clear via `clearPrescriptionContext()`.
