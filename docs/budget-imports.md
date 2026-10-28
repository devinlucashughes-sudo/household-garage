# Cost-only fuel imports

Prepare a normalized JSON batch from your own export outside the app. No budgeting service credentials are needed. Payments without gallons or odometer readings affect recorded spending and interrupt MPG intervals; they do not create fill-up readings.

```json
{
  "version": 1,
  "cars": [{"id": 1, "make": "Example", "model": "Sedan", "count": 1, "totalCents": 3000}],
  "rows": [{
    "carId": 1,
    "date": "2026-01-15",
    "totalCents": 3000,
    "payee": "Synthetic station",
    "memo": "Example payment",
    "sourceFile": "synthetic-budget.csv",
    "sourceRecord": 2,
    "sourceKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }]
}
```

This is a synthetic format example. Replace the car controls with the exact ID, make and model in your installation. Each car control contains its row count and total cents. Generate each `sourceKey` as a stable SHA-256 hex digest identifying that original source record, so retries use the same key. Keep source labels free of private directory paths.

Pipe the JSON into `npm run import:budget-fuel -- --check` to validate counts, amounts and possible duplicates without importing. After reviewing the result, pipe the same file into `npm run import:budget-fuel -- --apply`. Use your shell's file-to-stdin mechanism. Conflicting repeated source keys and possible duplicates against existing fill-ups abort the batch. An exact retry skips payments already imported.
