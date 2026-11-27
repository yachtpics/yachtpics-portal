# YouTube upload: setup (for Charlie)

This switches on **Admin → YouTube** and the **Upload to YouTube** button under each video on an admin listing page. Until you've done every step here, the feature stays off: the listing page just shows a small grey line, "YouTube isn't set up yet."

It's admin only. Brokers and assistants never see any of it.

You need about 30 minutes, your computer (not your phone) and the Google account that owns your YouTube channels.

Google renames buttons in its Cloud Console from time to time. Where a step below says **(check on the page)**, the wording on your screen may be a little different. Look for the closest match.

---

## Part 1: Google Cloud (one time)

1. Go to **https://console.cloud.google.com** and sign in with the Google account that owns your YouTube channels.
2. At the top left, click the project picker (next to "Google Cloud"), then **New project**.
   - Project name: `YachtPics Portal`
   - Click **Create**. Wait a few seconds, then make sure the picker at the top shows **YachtPics Portal**.
3. Switch on the YouTube API:
   - In the search bar at the top, type `YouTube Data API v3` and click it.
   - Click **Enable**.
4. Set up the sign-in screen (Google calls it the **OAuth consent screen**; newer screens call it **Google Auth Platform** with **Branding**, **Audience**, **Data access** and **Clients** on the left) **(check on the page)**:
   - If it asks for a user type, choose **External**.
   - App name: `YachtPics Portal`
   - User support email: your email.
   - Developer contact email: your email.
   - Save.
5. Add the two permissions (under **Data access** or **Scopes**, **Add or remove scopes**) **(check on the page)**. Paste each of these into the "manually add scopes" box, one at a time:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
   - Click **Update**, then **Save**.
6. Add yourself as a test user (under **Audience** or **Test users**) **(check on the page)**:
   - Click **Add users**, type the Google account email that owns the channels, and save.
   - Leave the app in **Testing** for now.
   - **Important**: while the app is in Testing, Google ends the Portal's permission after **7 days**. When that happens, Admin → YouTube shows the channel in red with **Connect again**. Click it and sign in again. This stops once the app is published (see Part 4).
7. Create the sign-in keys (under **Clients**, or **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**
   - Name: `YachtPics Portal`
   - Under **Authorized redirect URIs**, click **Add URI** and paste exactly this, with nothing extra:
     ```
     https://portal.yachtpics.com/api/admin/youtube/callback
     ```
   - Click **Create**.
   - Google shows a **Client ID** and a **Client secret**. Keep this window open for Part 2. (If you close it, you can open the client again from the same page. Newer screens may only show the secret once. If so, copy it now **(check on the page)**.)

## Part 2: Vercel (one time)

1. Go to **https://vercel.com**, open the **yachtpics-portal** project.
2. Click **Settings**, then **Environment Variables**.
3. Add the first one:
   - Key: `GOOGLE_OAUTH_CLIENT_ID`
   - Value: the Client ID from Google (it ends in `.apps.googleusercontent.com`)
   - Environment: tick **Production** only
   - Click **Save**.
4. Add the second one the same way:
   - Key: `GOOGLE_OAUTH_CLIENT_SECRET`
   - Value: the Client secret from Google
   - Environment: **Production**
   - Click **Save**.
5. Redeploy so they take effect: click **Deployments**, then the **⋯** on the top (newest) one, then **Redeploy**, then **Redeploy** again. Wait until it says **Ready** (a minute or two).

The secret also locks the YouTube permissions the Portal stores. If you ever make a new Client secret in Google and change it in Vercel, connect each channel again afterwards.

## Part 3: Database (one time)

1. Open **https://supabase.com/dashboard**, open the YachtPics project, then **SQL Editor** on the left, then **New query**.
2. In VS Code, open `supabase/migrations/20261127_youtube_upload.sql`, select everything (Ctrl+A), copy (Ctrl+C).
3. Paste it into the Supabase SQL Editor and click **Run**. You should see "Success". The last line returns a number; any number is fine.
4. Replace everything in the editor with this line and click **Run**:
   ```
   select * from public.demo_readonly_gaps();
   ```
   You should see **no rows**. If you see rows, send them to Claude.

## Part 4: Connect your channels

1. Open **https://portal.yachtpics.com/admin/youtube** (use that exact address: Google only accepts sign-ins that start from it).
2. Click **Connect a channel**.
3. Google asks which account to use. Pick the account, and if Google then asks which channel or **Brand Account**, pick the channel you want.
4. Google may warn **"Google hasn't verified this app"**. That's expected while the app is in Testing. Click **Continue** (sometimes under **Advanced**) **(check on the page)**.
5. Tick both permission boxes if Google shows them, then **Continue**.
6. You're back on Admin → YouTube with "Channel connected." and the channel listed.
7. **Do it again for your second channel**: click **Connect a channel** again and pick the other channel on Google's screen. One sign-in = one channel.

## Part 5: Test with one video

1. Admin → Listings → open a boat that has a listing video.
2. Under the video, click **Upload to YouTube**.
3. Check the title and description, pick the channel (if you connected two), choose **Unlisted** for this test, and untick **Put the YouTube link on this listing** for the test.
4. Click **Upload**. The line under the video shows **Uploading to YouTube: 12%**, then **YouTube is processing it**, then **On YouTube** with **Open** and **Copy link**.
5. You can close the page while it uploads. Come back later and it carries on showing where it got to.
6. Click **Open**. The video is on YouTube, and **Private** for now (see below). Open **YouTube Studio** to see it.

If something goes wrong, the line under the video says what happened in a sentence. Admin → Jobs shows the upload's log too ("Upload a listing video to YouTube").

---

## Getting uploads to go public: Google's audit

Until Google audits the Portal's app, **YouTube locks every upload made through the Portal to Private**, whatever you pick in the dialog. You can still open and watch the video in YouTube Studio. Don't count on switching it to Public there by hand: YouTube may show it as "locked" private until the audit passes **(check on the page)**. If you need a video public before then, upload that one from YouTube Studio yourself.

To lift that:

1. Fill in Google's **YouTube API Services audit and quota extension form**. Search for "YouTube API Services Audit and Quota Extension Form" **(check on the page)**.
2. What they ask for (expect roughly this, **check on the page**):
   - What the app does: "An internal tool for YachtPics, a yacht photography business. The owner uploads listing videos he made for yacht brokers to his own YouTube channels. No other users."
   - Your Google Cloud project number (Cloud Console → the project's dashboard).
   - A **privacy policy** web address, and usually terms of service. They have to describe what the Portal does with YouTube data (it only uploads videos and reads the channel name and the upload's processing status).
   - Screenshots or a short screen recording of Connect a channel and Upload to YouTube.
3. Google replies by email. It can take a few weeks.
4. When it passes, tell Claude: one switch (`YOUTUBE_APP_AUDITED` in `src/lib/youtube/config.ts`) removes the "keeps uploads private" line from the dialog.

Separately, so you don't have to reconnect every 7 days, the sign-in screen can be **published** (Audience → **Publish app** **(check on the page)**). Because the YouTube permissions are "sensitive", Google may ask for its own app verification before publishing, or keep showing the "hasn't verified this app" warning. That's a different review from the YouTube audit above **(check on the page)**.

**Daily allowance**: a new Google Cloud project gets a daily allowance of YouTube API "units" (10,000 a day by default), and every upload uses a large share of it **(check the YouTube Data API's quota page for the current cost of an upload)**. If the allowance runs out, the upload stops with "YouTube's daily upload allowance for the Portal is used up. Try again tomorrow." The audit form above is also where you ask for more.
