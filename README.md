# London Venue RFPs

A small web app for Impact Analytics to shortlist London restaurants for a private event of 15 to 20 guests. It sends each venue a prefilled RFP through [Resend](https://resend.com) and tracks which venues you have contacted.

## What's inside

| Path | What it is |
|------|------------|
| `data/venues.json` | Venue data: website, emails (with source pages), phone, address, chef, speciality, signature dishes, menu, prices, private rooms, capacity, fit for 15 to 20, Instagram, photos |
| `data/venues.csv` | The same data as a spreadsheet (`npm run csv` rebuilds it) |
| `lib/app.js` | The API: venue list, Resend sending, outreach tracking, photo lookup |
| `lib/store.js` | Storage: Upstash Redis when configured, JSON files otherwise |
| `server.js` | Local server (`npm start`) |
| `api/index.js`, `middleware.js`, `vercel.json` | Vercel function entry, password protection, routing |
| `public/` | The web app (no build step) |
| `data/outreach.json` | Local only. Stores status and history per venue (git-ignored); Vercel uses Redis |

## Run it

```bash
npm install
cp .env.example .env      # add your Resend key and sender address
npm start                 # http://localhost:3000
```

With no `RESEND_API_KEY` (or with `DRY_RUN=1`) the app runs in **dry run** mode. It logs sends and updates statuses but sends no email. Use this to try the flow first.

### Resend setup

1. Create an API key at <https://resend.com/api-keys>.
2. Verify your sending domain (for example `impactanalytics.co`) under **Domains** in Resend. Resend only delivers mail from verified domains. `onboarding@resend.dev` can only send to your own account address.
3. Set `FROM_EMAIL`, `REPLY_TO` (where venue replies land) and, if you like, `BCC_EMAIL` in `.env`.

## Using the app

- **Event details & template**: add your name, title, phone, preferred and alternative dates, timing and budget. Edit the subject and body template here. Placeholders such as `{{venue}}` and `{{room}}` are filled in per venue. These settings are stored in your browser.
- **Send RFP** on a card opens the prefilled email. Check it and click **Send email**. The venue moves to *Contacted* and the send is logged.
- **Send to all not contacted** sends the template to every venue you have not contacted yet, after you confirm.
- **Details** shows the full venue profile, photos, outreach history and a status picker (Contacted, Replied, Shortlisted, Declined, Booked). Add notes such as phone calls.
- Filter chips and search narrow the grid. The stats bar shows progress.

### Photos

Cover images come from `cover_image` / `photos` in `venues.json` if set. Otherwise the server reads the venue's own website (`og:image` plus large images) the first time the app loads, then caches the result for a week (in Redis, or `data/photos-cache.json` locally). To pin a specific photo, paste its URL into `cover_image`.

## Data notes

- Emails were collected from each restaurant's official contact or private dining page; `email_sources` lists the pages. Staff inboxes change, so check before a big send.
- **Hide** does not publish an email address, so its card asks you to call 020 3146 8666. Paste the address into the compose box, or into `venues.json`.
- **Alain Ducasse** lists a named private dining manager, so its RFP goes to both that person and the reservations inbox.
- **Aulis** seats at most 12, so it cannot host 15 to 20. **Da Terra** and **Frog** need a buyout or exclusive hire for groups that size.

## Deploy to Vercel

The repo is ready for Vercel: `public/` is served as static files, `api/index.js` runs the API as a serverless function, and `middleware.js` puts a password in front of everything.

1. In Vercel, click **Add New → Project** and import `mon97-crypto/london-venue`. Keep the defaults (Framework preset: Other). `vercel.json` sets the rest.
2. **Storage → Create → Upstash (Redis)** from the Vercel Marketplace, and connect it to the project. Choose the free plan. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Vercel's filesystem is read-only, so without Redis the app cannot save outreach tracking.
3. **Settings → Environment Variables**, add:
   - `APP_PASSWORD`: the password your team will type. Without it, anyone with the URL could send email from your Resend account.
   - `RESEND_API_KEY`, `FROM_EMAIL`, `REPLY_TO` and optionally `BCC_EMAIL` (see Resend setup above).
4. **Deployments → Redeploy** so the new variables take effect.

When you open the site, the browser asks for a username and password. Any username works; the password is `APP_PASSWORD`.

To deploy from your own terminal instead: `npm i -g vercel`, then `vercel` in the repo folder, then `vercel --prod`.

## Other hosts

Any Node 22 host works with `npm start` (Render, Railway, Fly.io, a VM). Set the same env vars. Without Redis variables, tracking is saved to `data/outreach.json`, so use a persistent disk.
