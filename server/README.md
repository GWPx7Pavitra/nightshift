# Nightshift sync server

A small single-user server that makes Nightshift's sync live. Chrome and Brave push your screen
time every minute, and again the moment you switch browsers. To-dos, notes and settings go up
within a second. Any open new tab or Screen Time page gets a live stream of changes.

It only ever stores **encrypted** blobs. Encryption happens in your browser with your passphrase,
which never reaches the server. Without the passphrase, the data on disk (`data/state.json`) is
unreadable.

No dependencies. Node 18 or newer, one file.

## Run it on the Pelican panel (panel.cre8ivize.com)
1. Create a server with a **Node.js** egg (the generic one). Give it a port, e.g. `20011`, about
   128 MB RAM and 1 GB disk.
2. Upload `server.js` and `package.json` to it. Set the startup command to `node server.js`.
   The server listens on the panel's `SERVER_PORT` automatically.
3. Start it. The console prints a token that starts with `ns_`. Copy it. It's also saved in
   `data/token`. To choose your own token instead, set a `NIGHTSHIFT_TOKEN` variable of at least
   24 characters.

## Put it behind Caddy on the VPS (TLS)
Add a DNS record `sync.cre8ivize.com` pointing at the VPS, then add this to the Caddyfile and
reload Caddy:

```
sync.cre8ivize.com {
	reverse_proxy 127.0.0.1:20011 {
		flush_interval -1
	}
}
```

`flush_interval -1` passes the live stream through right away. Like `raven-web`, keep the raw
port reachable only through Caddy, so traffic always goes over HTTPS.

Check it: `https://sync.cre8ivize.com/healthz` should answer `{"ok":true,...}`.

## Connect your browsers
In each browser, open Nightshift → Options → **Sync browsers** → **Your server · live**, then enter:
- the address: `https://sync.cre8ivize.com`
- the `ns_…` token
- your passphrase (the same one in every browser)

If you were on Gist sync, use **Switch to your server**. Your other browsers' history comes along.

`*.cre8ivize.com` is already allowed. For any other address, Nightshift asks for permission when
you connect.

## API (for the curious)
All `/v1` routes need `Authorization: Bearer <token>`.
- `GET /healthz`: liveness, no auth.
- `GET /v1/items?since=<rev>`: everything changed since a revision (`0` = everything).
- `PUT /v1/items/<name>` with body `{"data": "<encrypted string>"}`: store an item.
- `DELETE /v1/items/<name>`: remove an item (used by "Remove" in the browsers list).
- `GET /v1/events`: server-sent events, one `change` event per write.

Items: `meta` (salt plus an encrypted check value), `shared`, and for each browser `hist.<id>`
(older days) and `live.<id>` (today and yesterday).
