# Domains: `afisz.cc` (frontend) and `api.afisz.cc` (backend)

The site runs on two hostnames under one domain, served by two different
providers. Both need a DNS record *and* the provider's own custom-domain
setting — one without the other fails silently, in ways that look like an
application bug.

| Hostname | Serves | Provider | DNS record |
|---|---|---|---|
| `afisz.cc` | the SPA (GitHub Pages) | GitHub Pages | four `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
| `www.afisz.cc` | redirect to the apex | GitHub Pages | `CNAME` → `<owner>.github.io` |
| `api.afisz.cc` | the tRPC backend | Railway | `CNAME` → the target Railway prints when the custom domain is added |

DNS for `afisz.cc` is hosted at Namecheap (`dns1/dns2.registrar-servers.com`),
so the records live in **Namecheap → Domain List → afisz.cc → Advanced DNS**.

## Checking it end to end

```bash
# Frontend: must answer with the four GitHub Pages IPs.
getent hosts afisz.cc

# Backend: must resolve (to a Railway CNAME target), and answer {"ok":true}.
getent hosts api.afisz.cc
curl https://api.afisz.cc/health

# What the deployed bundle actually calls — the value is baked in at build
# time, so this is the source of truth, not the repo variable.
curl -s https://afisz.cc/ | grep -o '/assets/index-[^"]*\.js'
curl -s https://afisz.cc/assets/index-XXXX.js | grep -o 'https://[a-z.]*/trpc'
```

## Adding the API subdomain

1. **Railway** → backend service → **Settings → Networking → Custom Domain** →
   enter `api.afisz.cc`. Railway shows a CNAME target (`…up.railway.app`) and
   waits for DNS before it issues the TLS certificate.
2. **Namecheap → Advanced DNS → Add New Record**: type `CNAME Record`, Host
   `api`, Value the target from step 1, TTL Automatic.
3. Wait for propagation (usually minutes), then re-check the Railway domain
   row — it goes green once it can verify the record and mint the cert.
4. Smoke-test `https://api.afisz.cc/health`.

Both halves are required. Adding the domain in Railway without the CNAME
leaves the hostname `NXDOMAIN`; adding the CNAME without registering the
domain in Railway gets the request to Railway's edge, which then has no route
for that `Host` header and answers with its own 404.

## Env vars that follow the domain

Changing the hostnames means changing the places that hard-code them. All of
these are configuration, not code:

| Where | Name | Value |
|---|---|---|
| GitHub → Settings → Secrets and variables → Actions → Variables | `VITE_API_URL` | `https://api.afisz.cc` |
| Railway → backend → Variables | `APP_URL` | `https://afisz.cc` |
| Railway → backend → Variables | `API_PUBLIC_URL` | `https://api.afisz.cc` |
| Google Cloud Console → OAuth client → Authorized redirect URIs | — | `https://api.afisz.cc/auth/google/callback` |

`VITE_API_URL` is read by Vite at **build** time, so editing the repo variable
changes nothing until **Actions → Deploy frontend → Run workflow** rebuilds the
bundle. `APP_URL` and `API_PUBLIC_URL` are read at runtime; Railway restarts
the service when they change.

CORS needs no change — the backend runs `cors({ origin: '*' })` (see
`backend/src/app.ts`), so it accepts the new frontend origin as-is.

## When events stop loading

The whole home feed comes from one tRPC call, so anything that breaks
`https://api.afisz.cc/trpc` empties the page. Work outward from the browser:

1. **DevTools → Network**, reload, look at the `/trpc` request.
   - `net::ERR_NAME_NOT_RESOLVED` → the `api` DNS record is missing or wrong.
     Confirm with `getent hosts api.afisz.cc`; NXDOMAIN means the record was
     never created (or was added to the wrong domain/zone).
   - TLS warning / certificate error → DNS is right but Railway hasn't issued
     the certificate yet; check the domain row in Railway's Networking tab.
   - `404` with a Railway-branded body → the CNAME points at Railway but the
     custom domain isn't registered on the service.
   - Request goes to `https://afisz.cc/trpc` (the Pages origin) instead of the
     API host → `VITE_API_URL` was unset for that build; Pages answers with
     `index.html` and the client fails on `Unexpected token '<'`.
2. **`curl https://api.afisz.cc/health`.** `{"ok":true}` clears DNS, TLS and
   routing in one shot, and points the investigation at the app instead.
3. **`curl 'https://api.afisz.cc/trpc/events.listDefault'`.** An empty list here
   means the database is empty (no successful scrape) or `DATABASE_URL` is
   unset on the service, not a domain problem.
