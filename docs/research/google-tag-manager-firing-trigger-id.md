# Google Tag Manager API — `firingTriggerId` / Trigger ID Research

**Date researched:** 2026-07-25  
**API version:** Tag Manager API v2 (`tagmanager/v2`)  
**Triggering incident:** `GTM tags create failed (400): Invalid firingTriggerId (base 10 number expected): 'accounts/6357971694/containers/253902272/workspaces/2/triggers/7' (badRequest)`

## Summary

The GTM Tag Manager API expects **numeric trigger IDs** in `Tag.firingTriggerId[]`, not full trigger resource paths. When creating a tag, each entry in `firingTriggerId` must be the trigger's `triggerId` (e.g. `"7"`), not its `path` (e.g. `accounts/.../triggers/7`).

**Recommended fix:** When building tag payloads, extract `triggerId` from the trigger create response (or parse the trailing segment from `path`) before setting `firingTriggerId`. Continue storing full `path` values in `resourcePaths` / artifacts for idempotency and persistence; only transform at tag-create time.

---

## Problem context

### Observed error

```
GTM tags create failed (400): Invalid firingTriggerId (base 10 number expected):
'accounts/6357971694/containers/253902272/workspaces/2/triggers/7' (badRequest)
```

### Local code path

1. `runGtmConversionSetupActivity` → `runGtmConversionSetup` in `backend/services/capabilities/gtmConversionSetupService.js`
2. Triggers are created first; `createGtmWorkspaceResource` returns `resourcePath` (the full GTM `path` from the API response).
3. `resourcePaths` map stores those full paths keyed by logical name (e.g. `page_view_trigger`).
4. When creating tags, the service maps `firingTriggerLogicalKeys` → values from `resourcePaths` and passes them directly as `firingTriggerId`:

```javascript
const firingTriggerIds = (spec.firingTriggerLogicalKeys ?? [])
  .map((key) => resourcePaths.get(key))
  .filter(Boolean);

const tagPayload = {
  ...spec.gtmPayload,
  firingTriggerId: firingTriggerIds,
};
```

The same pattern appears in `dev-tools/backend/services/dev/gtmCreationDiagnosticsService.js` (diagnostic tag creation).

### Error classification

- **HTTP 400** = invalid request payload → **non-retryable** (correct classification).
- Retrying without changing the payload will not succeed.

---

## Key facts (verified from official sources)

### 1. API version and transport

- Official GTM REST API version: **Tag Manager API v2**
- This repo calls `https://tagmanager.googleapis.com/tagmanager/v2` directly via Axios in `backend/services/integrations/googleTagManagerClient.js` — not the `googleapis` Node SDK.
- Official REST reference: [Tag Manager API v2](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces.tags)

### 2. `tags.create` parent path

`tags.create` creates a tag under a **workspace parent path**:

```
POST https://tagmanager.googleapis.com/tagmanager/v2/{parent}/tags
```

Where `parent` = `accounts/{account}/containers/{container}/workspaces/{workspace}`.

- Source: [tags.create](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces.tags/create)

### 3. `Tag.firingTriggerId[]` is a top-level field

`firingTriggerId` is a **top-level** array on the Tag resource, not a tag `parameter[]` entry.

From the official Tag resource docs:

> `firingTriggerId[]` (string) — Firing trigger IDs. A tag will fire when any of the listed triggers are true and all of its blockingTriggerIds (if any specified) are false.

- Source: [Tag resource](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces.tags)

### 4. Trigger resource exposes both `path` and `triggerId`

The Trigger resource has separate fields:

| Field | Example | Purpose |
|-------|---------|---------|
| `path` | `accounts/6357971694/containers/253902272/workspaces/2/triggers/7` | Full resource name for GET/UPDATE/DELETE |
| `triggerId` | `7` | Numeric ID used when referencing the trigger from other resources |

Also present: `accountId`, `containerId`, `workspaceId`.

- Source: [Trigger resource](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces.triggers)

### 5. Official developer guide uses `triggerId`, not `path`

The GTM API v2 Developer Guide explicitly associates tags with triggers using `trigger['triggerId']`:

**Python:**
```python
tag['firingTriggerId'] = [trigger['triggerId']]
```

**JavaScript:**
```javascript
tag['firingTriggerId'] = [trigger.triggerId];
```

- Source: [GTM API v2 Developer Guide](https://developers.google.com/tag-platform/tag-manager/api/v2/devguide)

### 6. Official Node client schema confirms shape

The generated `googleapis` Node client schema for Tag Manager v2 represents:

```typescript
firingTriggerId?: string[] | null;  // on Tag
triggerId?: string | null;         // on Trigger
path?: string | null;              // on Trigger
```

- Source: [`google-api-nodejs-client` — `tagmanager/v2.ts`](https://raw.githubusercontent.com/googleapis/google-api-nodejs-client/main/src/apis/tagmanager/v2.ts)

Note: IDs are typed as `string` in the generated client, but the API validates them as base-10 numbers (hence the error message).

---

## Working code references

### Official GTM API Developer Guide

Pattern for tag creation after trigger creation:

```javascript
tag['firingTriggerId'] = [trigger.triggerId];
```

- Link: https://developers.google.com/tag-platform/tag-manager/api/v2/devguide

### `clichedmoog/gtm-cli` (real CLI using GTM API)

Passes numeric trigger IDs from CLI flags, not resource paths:

```bash
gtm tags create --name "GA4 - Page View" --type gaawc \
  --firing-trigger-id 2 \
  --params '{"measurementId":"G-XXXXXXX"}'
```

- Link: https://github.com/clichedmoog/gtm-cli

This aligns with the runtime error (`base 10 number expected`).

### Unofficial API reference (consistent with official docs)

```python
'firingTriggerId': [trigger['triggerId']]
```

- Link: https://raw.githubusercontent.com/henkisdabro/wookstar-claude-plugins/HEAD/plugins/google-tagmanager/skills/google-tagmanager/references/api.md

---

## Version / mismatch notes

| Topic | Notes |
|-------|-------|
| API version | Official docs are **Tag Manager API v2**, matching this repo's `tagmanager/v2` endpoint. |
| Transport | Local backend uses **Axios + REST**, not `googleapis` SDK. SDK schema is still valid as a generated representation of the same API. |
| `trigger_reference` parameter | Some third-party sources suggest using a `trigger_reference` parameter type inside `parameter[]`. That is a valid `Parameter` type for certain tag templates, but it is **not** the documented way to set top-level tag firing triggers. Official Tag resource and developer guide use `firingTriggerId[]` at the top level. |
| String vs number | API accepts trigger IDs as strings containing numeric values (e.g. `"7"`). The error explicitly says "base 10 number expected", confirming numeric string format. |

---

## Open questions / conflicts

| Question | Resolution |
|----------|------------|
| Should `firingTriggerId` use `path` or `triggerId`? | **No conflict in official sources.** All point to `triggerId`. Runtime error confirms `path` is rejected. |
| What exact value to send? | Send `"7"` (string containing the numeric ID), not the full path. |
| Should we change what we store in artifacts? | **No.** Keep storing full `path` in `IntegrationArtifact.externalId` for stable resource identity. Transform only when building tag create payloads. |
| Does idempotent reuse affect this? | No. Resource reuse logic in `googleTagManagerClient.js` operates on paths for variables/triggers/tags. The `firingTriggerId` fix is isolated to tag payload construction in `gtmConversionSetupService.js` (and diagnostics). |

---

## Recommended implementation

### Minimal change

In `gtmConversionSetupService.js`, when resolving firing triggers for tag creation, extract the numeric ID from the stored path:

```javascript
function gtmResourceIdFromPath(resourcePath) {
  if (!resourcePath || typeof resourcePath !== 'string') return null;
  const segment = resourcePath.split('/').pop();
  return segment && /^\d+$/.test(segment) ? segment : null;
}

const firingTriggerIds = (spec.firingTriggerLogicalKeys ?? [])
  .map((key) => gtmResourceIdFromPath(resourcePaths.get(key)))
  .filter(Boolean);
```

Alternatively, capture `triggerId` from the trigger create API response (`res.data.triggerId`) at creation time and store it alongside the path — but parsing the path suffix is sufficient given GTM's stable path format.

### Files to update

| File | Change |
|------|--------|
| `backend/services/capabilities/gtmConversionSetupService.js` | Extract `triggerId` before setting `firingTriggerId` on tag payloads |
| `dev-tools/backend/services/dev/gtmCreationDiagnosticsService.js` | Same fix for diagnostic tag creation (same bug pattern) |
| `backend/tests/` | Add/adjust unit test asserting tag payload uses numeric IDs, not paths |

### Out of scope for this fix

- Changes to `googleTagManagerClient.js` resource reuse logic (already correct for path-based identity)
- Retry policy changes (400 remains non-retryable)
- GTM provisioning / workflow ordering (separate Phase 8 work, already addressed)

---

## Research methodology

This document follows the same approach used for Google Ads API issues (Phase 7):

1. Start from the **exact runtime error** and trace the local code path.
2. Read **official REST documentation** for the specific resource and method (`Tag`, `Trigger`, `tags.create`).
3. Cross-check with the **official developer guide** code examples (Python + JavaScript).
4. Validate against **generated SDK schemas** (`google-api-nodejs-client` tagmanager v2).
5. Find **real working code** on GitHub (CLI tools, not blog tutorials).
6. Flag any source conflicts; defer to official docs when they disagree.

---

## Source index

| Source | URL |
|--------|-----|
| Tag resource (REST v2) | https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces.tags |
| Trigger resource (REST v2) | https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces.triggers |
| tags.create | https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces.tags/create |
| GTM API v2 Developer Guide | https://developers.google.com/tag-platform/tag-manager/api/v2/devguide |
| Node.js generated schema | https://raw.githubusercontent.com/googleapis/google-api-nodejs-client/main/src/apis/tagmanager/v2.ts |
| gtm-cli (working example) | https://github.com/clichedmoog/gtm-cli |
