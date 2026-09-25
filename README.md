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

- **Customise email** (optional): add your name, title, phone, the Gmail account to send from, date, timing and budget. Blank fields fall back to neutral wording, so the Gmail button always works. Edit the subject and body template here. Placeholders such as `{{venue}}` and `{{room}}` are filled in per venue. These settings are stored in your browser.
- **Email via Gmail** on a card opens a new Gmail tab with the recipient, subject and RFP body filled in. The tracker and the card update straight away (*Contacted*).
- **Mark sent** confirms you pressed Send in Gmail. The card turns green with a *Sent* ribbon. Click again to undo.
- **♥ Favourite** any venue, then filter by *Favourites*.
- **Bulk RFP** (toolbar) switches on selection. Tick venues, or use *Select favourites* / *Select not contacted*, then:
  - **One Gmail to all (BCC)**: a single draft with every selected venue in BCC and neutral wording ("Hello," instead of the venue name).
  - **Personalised, one by one**: steps through the selection, opening a personalised Gmail draft for each venue.
  - **Mark all sent** once you have sent them.
- **Sort** by most popular, price (high to low or low to high), Michelin stars, largest groups or name.
- **Filters**: Michelin stars, guests to host (min and max, with a 15 to 20 shortcut) and max price per head.
- **Details** shows the full venue profile, photos, outreach history, a status picker (Contacted, Replied, Shortlisted, Declined, Booked) and notes.
- The **Gmail account** setting under *Customise email* picks which signed-in Google account opens the draft.
- **Reset** (top right of the progress card) clears Contacted, Sent and status marks, notes and history for every venue, for everyone using the site. Favourites and cover photos are kept.
- Press `/` to jump to search.

Tracking is saved on the server (Upstash Redis on Vercel). If the server cannot save, for example before Redis is connected, changes are kept in your browser, a note appears in the progress card, and they are sent to the server on your next visit.

"Most popular" is an editorial ranking in `venues.json` (`popularity`, 0 to 100) based on Michelin stars, World's 50 Best listings and profile. Guest ranges (`capacity_min`, `capacity_max`) and prices (`price_min`, `price_max`, £ per head for food) are also there; blank capacity means the venue does not publish it, and such venues stay in guest-filtered results.

### Photos

Each card tries these in order and shows the first photo that loads:

1. A cover photo you paste in a venue's **Details → Cover photo** (saved for everyone).
2. `cover_image` / `photos` in `venues.json`.
3. Photos the server reads from the venue's own website (`og:image` plus large images), cached for a week.
4. The website's share image through [Microlink](https://microlink.io), straight from the browser.

If none loads, the card shows the venue's initials.

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
