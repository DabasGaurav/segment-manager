# Segment Manager

An internal API that checks the targeting segments publishers send in OpenRTB 2.6 bid requests.

- Segments already in a standard IAB format are passed through.
- Publisher-specific segment IDs are translated to IAB IDs only through human-approved mappings, and only where consent and the publisher's permission allow it.
- Every decision carries a reason code.

Built as the prototype for a Media.net Associate Product Manager case (Option 3: an internal API for targeting segments). **All publishers, personas and keys are synthetic.** Nothing here describes Media.net's real systems.

## Status: full prototype

| Area | State |
|---|---|
| Official IAB taxonomy files (Content 2.2 / 3.0 / 3.1, Audience 1.1), SHA-256 verified at load | **Live** |
| Signal detection per Data object and per segment, following the segtax rules | **Live** |
| Dictionary import, mapping proposals (exact, synonym, lexical ranking), sensitive blocking | **Live** |
| Human review (approve, choose another node, reclassify, leave unmapped, revoke), with separation of duties | **Live** |
| Publisher permissions (grant level, DSP allowlist, unmapped handling) | **Live** |
| Immutable, hashed mapping versions; activation and instant rollback | **Live** |
| `POST /v1/resolve`: pass through, translate, keep raw or remove, with reason codes | **Live** |
| TCF v2 consent check for vendor 142 and jurisdiction rules J1–J6 | **Live, illustrative policy** |
| Append-only audit log with no user IDs, consent strings or IPs | **Live** |

**Demo:** open the site, use the *Guided demo* (steps 1–4), or call the API with the public read-only demo key below.

**Known gaps (prototype scope):** GPP strings and US state privacy rules are not parsed (US audience data is removed); the rate limiter is per server instance; DEMO_MODE sign-in has no passwords by design; the benchmark is a 62-item hand-labelled synthetic set, not production data; latency figures come from the demo server, not a production bidder.

## What is real, synthetic and illustrative

- **Real:**
  - The IAB taxonomy files, checked byte-for-byte against `data/iab/SHA256SUMS.txt`.
  - The OpenRTB 2.6 field locations and segtax values (AdCOM 1.0 "List: Category Taxonomies").
  - All validation logic, the API, auth and storage.
- **Synthetic:** the publishers (DriveDesk India, Metro Daily), the demo personas, and the sample bid requests.
- **Illustrative:** the consent and jurisdiction policy pack, and the sensitive-category list. These are **not legal advice** and make no claim of compliance.

## How segtax is handled

`segtax` is the community extension `Data.ext.segtax`, an integer. It applies to **every** segment in that Data object. Without it, segment IDs are proprietary to the data provider.

| segtax | Meaning | Treatment |
|---|---|---|
| 4 | Audience 1.1 | Valid only in `user.data`; each ID is checked against the official file |
| 6 / 7 / 9 | Content 2.2 / 3.0 / 3.1 | Valid only in `site/app/dooh.content.data`; each ID is checked |
| 5 | Content 2.1 | Passed through with a warning (file not loaded) |
| 1, 2 | Deprecated content taxonomies | Whole Data object removed |
| 3, 8 | Ad Product taxonomies | Whole Data object removed (wrong place) |
| 500+ | Vendor-specific | Passed through, never translated |
| anything else | Not valid | Whole Data object removed |
| missing | Proprietary | Candidate for translation via approved mappings |

An unknown ID inside a valid object removes **only that segment**.

## API

All errors are `application/problem+json` with a stable `code` and a `request_id`. Paths also work under `/api/v1/...`.

| Method and path | Who |
|---|---|
| `GET /health` | public |
| `GET /v1/taxonomies/{content\|audience}/{version}/nodes/{id}` | signed-in persona or bidder key |
| `POST /v1/resolve` | bidder key, or the demo read-only key (60/min) |
| `POST /v1/publishers/{pid}/imports` (Idempotency-Key) | publisher_ops |
| `GET /v1/publishers/{pid}/proposals?status=` | publisher_ops, reviewer, admin |
| `POST /v1/publishers/{pid}/proposals/{id}/decision` | reviewer |
| `GET` / `PUT /v1/publishers/{pid}/grant` | read: ops, reviewer; write: publisher_ops |
| `GET` / `POST /v1/publishers/{pid}/mapping-versions` | read: ops, reviewer; publish: reviewer |
| `PUT /v1/publishers/{pid}/active-version` | reviewer |
| `GET /v1/publishers/{pid}/audit` | ops, reviewer, admin |
| `POST /v1/demo/sessions`, `POST /v1/demo/reset` | demo only |

Try the resolver with the public demo key (read-only, rate limited, synthetic data only):

```bash
curl -X POST https://segment-manager.vercel.app/v1/resolve \
  -H "Authorization: Bearer sm_demo_221a2fb7b219328915e3e40c" -H "Content-Type: application/json" \
  -d '{"publisher_id":"pub_metrodaily","dsp":"ttd","bid_request":{"id":"r1","imp":[{"id":"1"}],
       "user":{"data":[{"name":"metrodaily.example","ext":{"segtax":4},"segment":[{"id":"253"},{"id":"99999"}]}]},
       "device":{"geo":{"country":"IND"}},"regs":{"gdpr":0}}}'
```

## Security model

- **People:** `POST /v1/demo/sessions {persona}` sets an httpOnly, SameSite=Strict session cookie holding a signed JWT that lasts 8 hours.
  - It works only when `DEMO_MODE=true`, and only for seeded demo personas.
  - Writes made with a cookie must send a matching `Origin` header.
- **Services:** `Authorization: Bearer <key>`. Only the SHA-256 hash of each key is stored. A request that presents a bearer token is judged on that token alone.
- **Tenant isolation:** a publisher outside the caller's scope returns `404`, exactly like a publisher that doesn't exist.
- **Append-only storage:** a database trigger rejects `UPDATE` and `DELETE` on audit events and mapping versions. The only exception is the demo reset.
- **Limits:** bodies over 64 KB return 413. Requests with more than 50 Data objects or more than 500 segments return 422.

## Run locally

```bash
cp .env.example .env              # then set DATABASE_URL, SESSION_SECRET, keys
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev                       # http://localhost:3000
```

## Tests

```bash
npm test                          # Vitest: 153 unit, API-flow, consent and benchmark tests (needs a Postgres test DB)
npx playwright test --trace off   # end-to-end, against E2E_BASE_URL (default http://localhost:3000)
```

## Stack

- Next.js 16 (App Router) and TypeScript
- Prisma 6 with Postgres (Neon in production)
- zod and jose
- Vitest and Playwright

## Data sources

IAB Tech Lab Taxonomies repository (`InteractiveAdvertisingBureau/Taxonomies`, `main` branch), downloaded 23 Nov 2026. See `data/iab/SOURCE.txt` and `data/iab/SHA256SUMS.txt`.
