

## Problem

The `billet-check-status` edge function receives ONZ responses where the actual billet data is nested inside a `data` property: `{"data": {"status": "LIQUIDATED", ...}}`. The code reads `statusData.status` which is `undefined`, so every poll returns `internal_status: "pending"` even when the provider says `LIQUIDATED`. The app gets stuck on "Aguardando confirmação" forever, then times out.

## Root Cause

In `callOnzViaProxy`, the proxy response is `{"data": {"data": {...actual billet...}}}`. The helper does `data.data || data` which unwraps one level, yielding `{"data": {...actual billet...}}`. But `billet-check-status` then does `statusData = result.data` which is still `{"data": {...}}` — one level of nesting remains.

## Fix

**File: `supabase/functions/billet-check-status/index.ts`**

After line 116 (`statusData = result.data;`), add unwrapping logic:

```typescript
// ONZ responses may be nested in a "data" wrapper
if (statusData && statusData.data && typeof statusData.data === 'object' && statusData.data.status) {
  statusData = statusData.data;
}
```

This ensures `statusData.status` correctly reads `"LIQUIDATED"`, which maps to `"completed"`, unblocking the polling loop and showing the success screen.

## Technical Details

- Only the ONZ branch is affected (Transfeera responses are flat)
- The fix is defensive — it only unwraps when `.data.status` exists
- No frontend changes needed; the polling logic in `BoletoPaymentDrawer` already handles `is_completed` correctly
- Deploy via `supabase--deploy_edge_functions`

