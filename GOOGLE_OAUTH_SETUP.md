# Google OAuth Setup Guide

## Step 1: Create Google Cloud Project

1. Go to https://console.cloud.google.com/
2. Click **Select a project** → **New Project**
3. Name it: `WordPress Auto Claw`
4. Click **Create**

## Step 2: Enable APIs

1. In your project, go to **APIs & Services** → **Library**
2. Search and enable:
   - **Google Sheets API**
   - **Google Drive API**
3. Click on each and click **Enable**

## Step 3: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Configure consent screen:
   - Click **Configure Consent Screen**
   - Select **External** (for testing)
   - Fill in app name: `WordPress Auto Claw`
   - Add your email as support email
   - Click **Save and Continue**
   - Click **Save and Continue** again
   - Click **Back to Dashboard**

4. Now create OAuth client ID:
   - Click **Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Name: `WordPress Claw Web`
   - Authorized redirect URIs:
     - `https://wordpress-claw.onrender.com/auth/google/callback`
   - Click **Create**

5. Copy the **Client ID** and **Client Secret**

## Step 4: Update Server

1. Open `google-credentials.json` in your repo
2. Replace:
   - `YOUR_GOOGLE_CLIENT_ID` with your Client ID
   - `YOUR_GOOGLE_CLIENT_SECRET` with your Client Secret

## Step 5: Deploy

```bash
# Rename server file
git rm server.js
git mv server-oauth.js server.js
git add -A
git commit -m "Add Google OAuth support"
git push
```

## Step 6: Add Environment Variable

In Render dashboard, add:
- **Key:** `SESSION_SECRET`
- **Value:** (any random string, e.g., `your-random-secret-12345`)

## Step 7: Test

1. Open your app
2. Click **"Connect Google Account"**
3. Sign in with Google
4. Grant permissions for Google Sheets
5. Your spreadsheets will appear automatically

## How It Works

Once connected, you can:
- **List all your spreadsheets** - No manual sharing needed
- **Read any sheet** - Access all your Google Sheets
- **Update cells** - Write status, URLs back to sheets
- **Switch between sheets** - Work on multiple clients

## Security

- Tokens are stored in session (server-side)
- No credentials exposed to frontend
- User can disconnect anytime
