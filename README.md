# Nightshift 2.3

A browser extension for Chrome and Brave. It replaces your new tab with a calm startup page
and tracks how much time you spend on each website, across both browsers, with end-to-end
encrypted sync.

## New tab / startup page
- Clock in six styles: **Rolling**, **Flip**, **Soft fade**, **Stacked**, **Analog**, **In words**. Pick from 12 fonts, a weight, a size and a colour (solid, accent, gradient, outline, glow).
- Greeting, date and **weather** (Open-Meteo, no account needed).
- Animated background: Aurora, Night sky, Bing photo of the day, or your own image.
- Search with prefixes: `gh` `yt` `py` `npm` `mdn` `so` `w` `pc` `sv` `cl` `r` `img`.
- **Ctrl+K / ⌘K** (or `k`) opens the command palette: one search box for open tabs, important pages, bookmarks and history, plus actions like "Add to-do".
- **Important pages**: real site icons, or a coloured letter when the browser has no icon. Hover the row for **+ Add** and **Edit**, or drop a link (or a tab's URL) onto the row to add it.
- **Screen time today**: your total, the split by category, top sites, the split between browsers, and your **daily limits** as progress bars.
- **In the background**: time YT Music or the Raven dashboard played while you were on something else. It's shown on its own and doesn't count toward your screen time.
- **The one thing today**: one pinned priority, above the to-do list.
- **To-do**, **Notes**.
- **Dev card**: CI status, latest commit, open PRs, and how long you spent in each repo on GitHub this week.
- **This week**: total since Monday compared with last week, your main category, top site, the biggest change, and a 7-day chart by category.
- Server status for Raven, Cre8ivize and the Pelican panel (top right).
- Keys: `/` search · `k` palette · `t` to-do · `n` notes · `s` Screen Time · `c` customise.

## Customise (Options → Customise)
A live preview of your new tab sits at the top, and every change shows up in it (and in any open new tab) as you make it.
- **Clock**: style, font, weight, size, colour, 24-hour, seconds, date.
- **Fonts**: the interface font for every Nightshift page (Geist, Inter, Manrope, Space Grotesk, Outfit, Bricolage, JetBrains Mono).
- **Colour**: five presets or any colour.
- **Background**: Aurora, Night sky, Bing photo of the day or your own image; darken it; film grain on or off.
- **Cards**: opacity, blur, corner radius, density, and motion (Full, Calm or Off).
- **Layout**: Dashboard, Focus (clock, search, pages) or Zen (just the time). You can also switch each widget on or off.
Your look syncs to your other browsers along with everything else.

## Categories
Building, **Study**, **Background**, Social, Entertainment and Other are built in. `music.youtube.com` and `raven.cre8ivize.com` count as Background, so YT Music no longer counts as entertainment and a YouTube limit doesn't include it.
Make your own in Options → Categories (name, colour, and whether it counts as productive). You can also choose “New category…” from any category menu.

## Toolbar icon (pin it)
- The badge shows today's time on the current site and **turns red once you're over its limit**.
- The popup shows that site's time, lets you change its category, and sets a daily limit (Off / 15m / 30m / 1h / 2h).
- It can also add the page to Important pages, or stop tracking the site.

## Screen Time dashboard (`Alt+Shift+S`)
- Today / Yesterday / 7 / 30 days, filterable by browser.
- **By category** cards: click one to filter the list.
- Chart coloured by category or by browser.
- Every website gets a category menu, so you can recategorise it right there.
- github.com expands into **time per repo**.

## Daily limits and the weekly recap
- Limits never block anything. When you pass one you get **one notification** that day, the badge goes red, and the new tab shows it.
- On **Sunday evening** a notification sums up your week: total, change from last week, top site and biggest change.

## Live sync with your own server (recommended)
Run the tiny server in [`server/`](server/README.md) (for example on the Pelican panel, behind Caddy at
`sync.cre8ivize.com`). Then Options → Sync browsers → **Your server · live**. Browsers push every minute and the
moment you switch between them, and open pages update within a second or two. It's still end-to-end encrypted:
the server stores scrambled data only.

Old installs show up as extra browsers (each new install folder gets a new identity). Remove them from the
**Browsers in sync** list. The new tab only counts browsers that were used today.

## Sync between Chrome and Brave through a Gist (end-to-end encrypted)
Options → **Sync browsers** → **GitHub Gist**:
1. Create a GitHub token. The `gist` permission is already ticked; tick `repo` too if you want the Dev card to see your private repos.
2. Paste the token, choose a **passphrase** (8+ characters) and click **Connect & encrypt**.
3. In the other browser, enter the same token and the same passphrase.

Everything is encrypted with AES-256-GCM in your browser before upload. The key comes from
your passphrase (PBKDF2, 310k rounds) and never leaves your devices, so GitHub (or anyone who
finds the gist link) only sees scrambled data. Shared settings upload only when they change, and
screen time at most every 30 minutes, which keeps the gist's revision history small.
If you used 2.0's unencrypted sync, connecting moves that data into the encrypted gist and
**deletes the old one**.

Sync covers: screen time from every browser, to-dos, notes, the one thing, important pages,
categories, limits, look and Dev-card repos. Tokens, the encryption key and an uploaded
background image stay on each device.

## Updates from your private GitHub repo
Nightshift can update itself from a GitHub repo (`GWPx7Pavitra/nightshift` by default):
1. Push the extension files to that repo, with `manifest.json` at the top level.
2. Options → **Dev card**: save a token that can read the repo (classic token with `repo`, or a fine-grained token with Contents: read).
3. Options → **Updates** → **Choose folder**: pick the folder you loaded in `chrome://extensions`. Choose “Allow on every visit” when Chrome asks.
4. To release a version, bump `"version"` in `manifest.json` and push. Every browser checks every 3 hours (or click Check now). With auto-install on, a new tab downloads the update quietly and Nightshift restarts once you've left its pages. You can also press **Update now**, or use the button that appears in the new tab's top bar.
Only files that changed are downloaded, and everything is verified before anything is written. The extension's id comes from its folder, so your screen time, to-dos and settings stay put.
**Brave:** folder access is off by default. Turn on `brave://flags/#file-system-access-api` once, then pick the folder.

## Install / update
1. Unzip to a folder you'll keep (to update, replace the files in the same folder).
2. `chrome://extensions` (or `brave://extensions`) → **Developer mode** → **Load unpacked** → pick the folder.
   If you're updating instead, click ↻ on Nightshift.
3. Choose **Keep it** for the new tab page, and pin Nightshift from the puzzle-piece menu.

Version 2.1 asks for a few new permissions:
- **notifications**: limits and the weekly recap.
- **bookmarks and history**: the Ctrl+K palette. It's searched locally and never synced or uploaded.
- **location**: weather. Only used if you don't pin a city in Options.
