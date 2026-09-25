# London Venue RFPs

A small web app for Impact Analytics to shortlist London restaurants for a private event of 15 to 20 guests. It sends each venue a prefilled RFP through [Resend](https://resend.com) and tracks which venues you have contacted.

## What's inside

| Path | What it is |
|------|------------|
| `data/venues.json` | Venue data: website, emails (with source pages), phone, address, chef, speciality, signature dishes, menu, prices, private rooms, capacity, fit for 15 to 20, Instagram, photos |
| `data/venues.csv` | The same data as a spreadsheet (`npm run csv` rebuilds it) |
| `server.js` | Express server: venue API, Resend sending, outreach tracking, photo lookup |
| `public/` | The web app (no build step) |
| `data/outreach.json` | Created on first use. Stores status and history per venue (git-ignored) |

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

Cover images come from `cover_image` / `photos` in `venues.json` if set. Otherwise the server reads the venue's own website (`og:image` plus large images) the first time the app loads, then caches the result for a week in `data/photos-cache.json`. To pin a specific photo, paste its URL into `cover_image`.

## Data notes

- Emails were collected from each restaurant's official contact or private dining page; `email_sources` lists the pages. Staff inboxes change, so check before a big send.
- **Hide** does not publish an email address, so its card asks you to call 020 3146 8666. Paste the address into the compose box, or into `venues.json`.
- **Alain Ducasse** lists a named private dining manager, so its RFP goes to both that person and the reservations inbox.
- **Aulis** seats at most 12, so it cannot host 15 to 20. **Da Terra** and **Frog** need a buyout or exclusive hire for groups that size.

## Deploy

Any Node 18+ host works (Render, Railway, Fly.io, a VM). Set the same env vars. Outreach tracking lives in `data/outreach.json`, so use a host with a persistent disk, or swap `loadOutreach` / `updateOutreach` in `server.js` for a database.
