# London Venue RFPs

A small web app for Impact Analytics to shortlist London restaurants for a private event of 15 to 20 guests. One click opens a prefilled RFP email to the venue in Gmail, and the app tracks which venues you have contacted.

## What's inside

| Path | What it is |
|------|------------|
| `data/venues.json` | Venue data: website, emails (with source pages), phone, address, chef, speciality, signature dishes, menu, prices, private rooms, capacity, fit for 15 to 20, Instagram, photos |
| `data/venues.csv` | The same data as a spreadsheet (`npm run csv` rebuilds it) |
| `lib/app.js` | The API: venue list, outreach tracking, photo lookup |
| `lib/store.js` | Storage: Upstash Redis when configured, JSON files otherwise |
| `server.js` | Local server (`npm start`) |
| `api/index.js`, `vercel.json` | Vercel function entry and routing |
| `public/` | The web app (no build step) |
| `data/outreach.json` | Local only. Stores status and history per venue (git-ignored); Vercel uses Redis |

## Run it locally

```bash
npm install
npm start                 # http://localhost:3000
```

## Using the app

- **Event details & template**: add your name, title, phone, the Gmail account to send from, preferred and alternative dates, timing and budget. Edit the subject and body template here. Placeholders such as `{{venue}}` and `{{room}}` are filled in per venue. These settings are stored in your browser.
- **Email via Gmail** on a card opens a new Gmail tab with the recipient, subject and RFP body filled in. Review it and press Send in Gmail. The venue moves to *Contacted* and the draft is logged. The app cannot see whether you pressed Send, so if you close the draft, set the status back in Details.
- The **Gmail account** setting picks which signed-in Google account opens the draft, useful if you are signed in to more than one.
- **Details** shows the full venue profile, photos, outreach history and a status picker (Contacted, Replied, Shortlisted, Declined, Booked). Add notes such as phone calls.
- Filter chips and search narrow the grid. The stats bar shows progress.

### Photos

Cover images come from `cover_image` / `photos` in `venues.json` if set. Otherwise the server reads the venue's own website (`og:image` plus large images) the first time the app loads, then caches the result for a week (in Redis, or `data/photos-cache.json` locally). To pin a specific photo, paste its URL into `cover_image`.

## Data notes

- Emails were collected from each restaurant's official contact or private dining page; `email_sources` lists the pages. Staff inboxes change, so check before a big send.
- **Hide** does not publish an email address, so its card asks you to call 020 3146 8666. Add the address in Gmail, or put it in `venues.json`.
- **Alain Ducasse** lists a named private dining manager, so its Gmail draft is addressed to both that person and the reservations inbox.
- **Aulis** seats at most 12, so it cannot host 15 to 20. **Da Terra** and **Frog** need a buyout or exclusive hire for groups that size.

## Deploy to Vercel

The repo is ready for Vercel: `public/` is served as static files and `api/index.js` runs the API as a serverless function.

1. In Vercel, click **Add New → Project** and import `mon97-crypto/london-venue`. Keep the defaults (Framework preset: Other). `vercel.json` sets the rest.
2. **Storage → Create → Upstash (Redis)** from the Vercel Marketplace, and connect it to the project. Choose the free plan. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Vercel's filesystem is read-only, so without Redis the app cannot save outreach tracking.
3. **Deployments → Redeploy** so the Redis variables take effect.

The site has no login, so anyone with the URL can see the list and change statuses. Keep the URL within the team.

To deploy from your own terminal instead: `npm i -g vercel`, then `vercel` in the repo folder, then `vercel --prod`.

## Other hosts

Any Node 22 host works with `npm start` (Render, Railway, Fly.io, a VM). Set the same env vars. Without Redis variables, tracking is saved to `data/outreach.json`, so use a persistent disk.
