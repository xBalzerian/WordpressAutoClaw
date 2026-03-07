# FIXES.md - Issue Resolution Documentation

## Issue: Google OAuth `invalid_grant` Error

**Date:** 2026-03-08
**Status:** FIXED

### Problem
Auto Post and Content Generation kept failing with:
- `Get Google Doc error: invalid_grant`
- `Google Sheets error: Invalid Credentials`
- Tokens would work briefly then expire

### Root Cause
Google OAuth refresh tokens have limitations:
- Limited lifetime (expire after certain period)
- Get invalidated if too many tokens issued
- Not designed for long-running automation

### Solution: Google Service Account

Replaced OAuth with **Service Account** authentication:
- No refresh tokens (uses JSON key file)
- Never expires
- Designed for automation/server-to-server

### Implementation Steps

1. **Created Service Account in Google Cloud Console**
   - URL: https://console.cloud.google.com/iam-admin/serviceaccounts
   - Name: `wordpress-claw-bot`
   - Role: Editor

2. **Enabled APIs**
   - Google Docs API
   - Google Sheets API
   - Google Drive API

3. **Downloaded JSON Key**
   - Added to Render Environment: `GOOGLE_SERVICE_ACCOUNT_KEY`

4. **Shared Spreadsheet**
   - Added service account email as Editor
   - Email format: `wordpress-claw-bot@wordpress-claw.iam.gserviceaccount.com`

5. **Modified Code**
   - `google-oauth-service.js`: Added Service Account support
   - `server.js`: Updated auth checks to use `hasGoogleAuth()` helper

### Code Changes

```javascript
// Check if Service Account is available
const hasGoogleAuth = () => {
  return googleService.hasServiceAccount() || (storedTokens !== null);
};

// Helper to set Google credentials (Service Account preferred)
const setGoogleCredentials = () => {
  if (googleService.hasServiceAccount()) {
    console.log('Using Service Account for authentication');
    return true;
  } else if (storedTokens) {
    console.log('Using OAuth tokens for authentication');
    googleService.setCredentialsFromTokens(storedTokens);
    return true;
  }
  return false;
};
```

### Result
- ✅ Content generation works reliably
- ✅ Auto Post updates WordPress
- ✅ Spreadsheet updates work
- ✅ No more `invalid_grant` errors
- ✅ Permanent solution (no re-auth needed)

### Prevention
- Documented this fix in FIXES.md
- Service Account JSON key is permanent
- Only need to share spreadsheet once

---

## Issue: ERR_HTTP_HEADERS_SENT

**Date:** 2026-03-08
**Status:** FIXED

### Problem
Error: `Cannot set headers after they are sent to the client`

### Root Cause
Duplicate `res.json()` calls in the generate-content endpoint.

### Solution
Removed duplicate response:
```javascript
// REMOVED - Duplicate response
// res.json({...}); 

// KEPT - Single response
res.json({
  success: true,
  title: keyword,
  content: content,
  // ... other fields
});
```

### Result
- ✅ No more duplicate response errors
- ✅ Content generation endpoint works correctly

---

## Maintenance Notes

### If Service Account Stops Working:
1. Check if `GOOGLE_SERVICE_ACCOUNT_KEY` env var is set
2. Verify JSON is valid (not corrupted)
3. Ensure spreadsheet is still shared with service account
4. Check if service account was deleted in Google Cloud

### To Add New Spreadsheet:
1. Open new spreadsheet
2. Click Share
3. Add: `wordpress-claw-bot@wordpress-claw.iam.gserviceaccount.com`
4. Set permission: Editor

### Environment Variables Required:
- `GOOGLE_SERVICE_ACCOUNT_KEY` - JSON key content
- `SPREADSHEET_ID` - Your Google Sheet ID
- `WP_URL`, `WP_USERNAME`, `WP_APP_PASSWORD` - WordPress credentials
