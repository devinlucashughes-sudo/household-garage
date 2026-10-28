# Desktop imports

The garage does not call an AI service. Extract the receipt or schedule on your desktop, then submit its JSON and originals to the private import API. Imports remain drafts until a signed-in household member reviews them. Drafts and rejected imports do not change mileage, service history, maintenance due lists or spending.

## Create and revoke desktop access

Sign in and open `/imports/access`. Give the desktop access a name, create it, and copy the credential while it is displayed. The garage stores only its SHA-256 hash and cannot show it again. Keep the credential in your desktop's private secret storage. Do not put it in source files, chat transcripts, shell history, logs or shared documents.

Revoke access on the same page when it is no longer needed. Revocation immediately blocks further API requests. Existing drafts and originals remain available to household reviewers. Access permits only car listing, draft submission and uploading originals to that credential's own pending drafts. It cannot read originals, edit drafts, approve, reject or change completed records.

## Endpoints

Use HTTPS against your garage origin. Supply `Authorization: Bearer <credential>` privately on every desktop request. No credential is accepted in a URL. Responses use `Cache-Control: private, no-store`. There is no remote URL fetch feature.

| Method and path | Purpose |
| --- | --- |
| `GET /api/imports/cars` | Return `{cars: [{id, name, vin}]}` for selecting the exact car. |
| `POST /api/imports` | Submit JSON with `Content-Type: application/json`. Return `{id, carId, type, status, revision}`. |
| `POST /api/imports/{id}/originals?carId=1&revision=1` | Upload raw original bytes. Send a URL-encoded filename in `X-File-Name`. Return `{id, revision}`. |

The original-upload body is the file itself, without multipart encoding or JSON. Supported signatures: PDF, JPEG, PNG, WebP and HEIC. The limit is 10 MB per file, with at most 10 originals per draft. Names are sanitized; the file signature determines its stored content type. Keep the latest returned draft revision for the next original upload. Uploaded originals increment the revision so an older review cannot approve an unseen original.

JSON is limited to 128 KB, including bodies sent without Content-Length. Every submission needs a fresh UUID `requestId`. Reuse that same ID and source JSON when retrying an ambiguous request. The same credential and source payload return the existing draft, including after review. JSON key order and whitespace outside strings may differ. A request ID reused by another credential, for another car or with different source values fails with 409. Corrections in the signed-in review do not change this original source binding.

Retry an ambiguous file upload with the same bytes and request parameters. An identical original already on the pending draft returns its existing ID and the current revision. New bytes with a stale revision fail with 409. Upload all originals before household approval. Approved and rejected drafts cannot accept more originals.

## Naming

Keep titles short, plain and in household words: two to four words, the way you'd say it out loud. Use "Oil change", "Tire rotation", "Cabin air filter", "Battery" or "Two rear tires", not "Oil and filter: oil-life alert plus annual maximum" or "Four Road Hugger GTP AS/02 tires installed". Add "(DIY)" when the household did the work. Brands, part numbers, oil grades, codes, findings and manual wording go in `notes` or line items, never in the title. Schedule titles name the job ("Spark plugs", "Coolant flush"), with no "Replace", no manual section names and no qualifiers like "first replacement".

Schedule notes hold only what helps do the job: specs, part numbers, fluid types, a short checklist, and when to do it sooner. Leave out source links, page numbers, checksums, approval or policy notes, history and explanations of how due dates are worked out; the schedule page already shows the interval and its calculation.

## Service JSON

This example is synthetic. Replace the car ID, date and UUID with the actual selected car, source date and a freshly generated UUID.

```json
{
  "type": "service",
  "carId": 1,
  "requestId": "c3986f76-e9f6-497b-a242-533dd10140aa",
  "sourceLabel": "Synthetic receipt example",
  "data": {
    "kind": "service",
    "title": "Oil and filter change",
    "date": "2026-01-15",
    "shop": null,
    "miles": 42000,
    "totalCents": 7599,
    "lineItems": [{ "description": "Oil and filter", "costCents": null }],
    "notes": null
  }
}
```

Use `kind: "quote"` for a quote. Quotes never add mileage or paid spending. Dates are actual calendar dates in `YYYY-MM-DD` format, up to today. All numbers are domain values: whole miles and whole cents, without currency symbols. A missing cost is `null`; free work is `0`. Line item costs are descriptive and are not added on top of the total paid. At most 30 line items are supported. Optional shop, miles, totalCents, notes and lineItems can be omitted; they default to null or an empty array. An optional `category` names the kind of cost: `oil`, `tires`, `maintenance`, `repairs` or `body`. Left out, it is guessed from the title (an oil change is `oil`, a broken part is `repairs`), and it can be changed after approval.

## Maintenance JSON

This example is synthetic and provides no invented baseline or past completion.

```json
{
  "type": "maintenance",
  "carId": 1,
  "requestId": "5194191a-acb5-4c6e-9d1d-4f83f5cdf685",
  "sourceLabel": "Synthetic schedule example",
  "data": {
    "title": "Oil and filter",
    "intervalMiles": 5000,
    "intervalMonths": 6,
    "baselineDate": null,
    "baselineMiles": null,
    "lastServiceId": null,
    "enabled": true,
    "optional": false,
    "asksTread": false,
    "notes": null
  }
}
```

At least one positive interval is required. Optional numeric and date fields default to null, enabled defaults to true, optional defaults to false, and notes defaults to null. Set `optional` to true for work the owner's manual doesn't call for: it stays in the plan as a reminder but never counts as overdue or sends a notification. Set `asksTread` to true for tread checks and tire rotations: Mark done then asks for the four tread depths. A baseline must be supplied from known information. Zero baseline miles is valid and differs from an unknown baseline. A linked service must be completed service for the same car. Its current date and mileage supply the baseline; manual baseline fields are cleared when a service is linked. An unknown linked mileage remains unknown. The schedule and original source draft stay linked after approval.

## Review, corrections and paste fallback

Open `/imports` while signed in. Review the car, type, saved details and originals. Correct fields in the review form, using dollars for displayed cost inputs and whole miles for mileage. Leave unknown values blank. Save corrections before approving. Car and import type are fixed: reject a submission assigned to the wrong car and submit a new request with a fresh UUID.

The paste form accepts the full JSON envelope above and uses the same validation and request-ID protection. It creates a pending draft. Add originals on its review page before approving. Corrections and uploads retain entered values on errors. A stale revision requires opening the latest saved import before trying again; retain any unsaved corrections separately if necessary.

Approval saves the record once. Service approval calls the normal service saver and copies originals to service receipts in the same SQLite transaction. A failure rolls back the service, mileage changes, copied receipts and approval status together. Maintenance approval calls the maintenance saver with its source draft ID. Both retain the originals on the draft. Retrying the original approval revision returns the same approved result without another completed record. Rejection retains the source draft and files without adding a completed record.

Signed-in source access is `/api/imports/{id}/originals/{receiptId}`. Append `?download=1` for a download. Desktop credentials cannot open these files. Original bytes, drafts and credential hashes are stored in SQLite and travel with the garage's existing database backup and restore.

## Errors and recovery

| Status | Recovery |
| --- | --- |
| 400 | Correct malformed JSON, values, signatures or missing upload parameters. |
| 401 | Supply valid unrevoked desktop access, or sign in for household-only actions. |
| 404 | Check the car and draft; another credential's drafts are unavailable. |
| 409 | Resolve a request-ID conflict, stale revision or already-reviewed draft. |
| 413 | Reduce JSON or file size to its documented limit. |
| 415 | Send JSON using application/json. |
| 500 | Retry the same submission request ID and original payload after checking connectivity. |

Do not automatically approve records from desktop automation. Always complete household review in the signed-in UI.
