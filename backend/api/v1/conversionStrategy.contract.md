# Conversion Strategy API Contract (Phase 1 — Design Only)

## GET /api/v1/business-contexts/:businessId/conversion-strategy

Returns the derived conversion strategy for a business.

### Response (200)

```json
{
  "conversionStrategy": {
    "resolvedPrimaryGoal": "both",
    "requiredSlots": [
      {
        "slot": "call",
        "logicalCategory": "call",
        "required": true,
        "resolution": "existing",
        "externalId": "12345",
        "resourceName": "customers/789/conversionActions/12345"
      },
      {
        "slot": "form",
        "logicalCategory": "form",
        "required": true,
        "resolution": "create",
        "externalId": null,
        "resourceName": null
      }
    ],
    "derivedFrom": "user_confirmed_goals",
    "derivedAt": "2026-06-10T15:30:00.000Z"
  }
}
```

### Response (404)

Strategy not yet derived (goals not confirmed or workflow not run).

## POST /api/v1/business-contexts/:businessId/conversion-strategy/confirm

User confirms the proposed strategy. No changes to conversion actions;
this records user consent before the workflow creates missing actions.

### Request Body

```json
{ "confirmed": true }
```

### Response (200)

```json
{ "confirmed": true, "confirmedAt": "2026-06-10T15:31:00.000Z" }
```
