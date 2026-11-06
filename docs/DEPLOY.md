# Deploying Vela for free (Vercel Hobby + Supabase free)

Everything below uses free plans: **Vercel Hobby** runs the Next.js app, and one **Supabase free project** (used only for Vela) provides Postgres and file storage. Run every command from the `web/` folder.

Total time: about 20 minutes the first time, then one command per deploy.

## Live deployment

- **Production URL:** <https://vela-drab-psi.vercel.app> (Vercel project `aks-projects4/vela`, first deployed 2026-11-06).
- Database and storage: Vela's own Supabase project `sfxtotgrrhamubczrdys` (ap-northeast-2), migrations 001–013 applied, 12 demo vendors seeded.
- Admin sign-in is at `/login` (the `/admin` area returns 404 to everyone else by design).

## 1. Create the Supabase project

1. Sign up at <https://supabase.com> (GitHub login is fine) and choose **New project**.
2. Name it `vela`, set a strong database password (save it in your password manager) and pick the region closest to your users (Mumbai `ap-south-1` or Seoul `ap-northeast-2` for Kerala). Plan: **Free**.
3. Wait until the project shows "Healthy".

## 2. Copy the values into `web/.env.deploy.local`

```bash
cp .env.deploy.example .env.deploy.local
```

Fill it in from the Supabase dashboard:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | **Connect** (top bar) → **Transaction pooler** (port **6543**). Replace `[YOUR-PASSWORD]` and URL-encode special characters (`@` → `%40`, `#` → `%23`, `/` → `%2F`). |
| `DATABASE_URL_SESSION` | Same dialog → **Session pooler** (port **5432**). Used only for migrations. |
| `SUPABASE_URL` | **Project Settings → Data API** → Project URL (`https://<ref>.supabase.co`). |
| `SUPABASE_SECRET_KEY` | **Project Settings → API Keys → Secret keys** → create/copy one (`sb_secret_…`). It is server-only. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same page, **Publishable key** (`sb_publishable_…`). Not used by the app yet; safe to share. |
| `STORAGE_DRIVER` | `supabase` |
| `STORAGE_BUCKET` | `vela-media` |
| `SESSION_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |

**Buckets.** You don't have to create them: `npm run deploy` creates `vela-media` (public: approved vendor photos) and `vela-media-private` (private: vendor documents) if they are missing. To make them by hand instead: **Storage → New bucket**, `vela-media` with "Public bucket" on, `vela-media-private` with it off, file size limit 50 MB.

**No S3 keys are needed** for Supabase: the app talks to Supabase Storage over its HTTP API with the secret key. S3 keys are only for the S3 driver (Cloudflare R2, MinIO, or Supabase's S3 endpoint): **Storage → Settings → S3 Connection → New access key** gives `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, and the endpoint shown there is `S3_ENDPOINT`. Then set `STORAGE_DRIVER=s3`.

## 3. Create a Vercel account and log in

1. Sign up at <https://vercel.com/signup> with the **Hobby** plan (GitHub login is fine).
2. On this computer:
   ```bash
   npx vercel login
   npx vercel whoami     # prints your username
   ```

## 4. Deploy

```bash
npm install
npm run deploy -- --dry-run   # checks .env.deploy.local and prints the plan, changes nothing
npm run deploy
```

`npm run deploy` (`scripts/deploy.mjs`) runs these steps and stops at the first error:

1. checks `.env.deploy.local` with the same rules the app uses at startup (`lib/env.ts`), listing every missing variable;
2. creates the storage buckets if missing;
3. applies database migrations (`db/migrate.mjs`, through `DATABASE_URL_SESSION`);
4. links the Vercel project on the first run (`vercel link --yes --project vela`, saved in `web/.vercel/`, git-ignored);
5. pushes every runtime variable to Vercel's **production** environment with `vercel env` (values go through stdin, never the command line);
6. runs `vercel deploy --prod` (Vercel installs and builds) and prints the URL.

Flags: `--skip-migrate`, `--skip-env`, `--skip-storage`, `--env-file <file>`.

The app is built from the `web/` folder, so in the Vercel dashboard the project's root directory is the uploaded folder itself (no setting needed when you deploy with the CLI). If you later connect the GitHub repo for automatic deploys, set **Root Directory = `web`**.

## 5. First data

```bash
npm run admin:create:deploy -- --email you@example.com --name "Your Name"   # asks for a password (12+ chars)
npm run db:seed:demo:deploy     # optional: sample vendors for an empty site
```

The demo seed only runs on an **empty** database (no vendors, enquiries, reviews, favourites or non-admin users; admins are fine) and refuses otherwise, even with `--force`. It adds the 12 approved sample vendors with photos (uploaded to the bucket), flagged `is_demo` and shown with a **Demo listing** label, with no phone numbers and no "Verified" badges. Remove them once real vendors are live:

```sql
DELETE FROM vendors WHERE is_demo;   -- Supabase → SQL editor
```

(Their photos stay in the bucket under `vendors/<id>/`; delete those folders in **Storage** if you want the space back.)

Never run plain `npm run db:seed` against production: it wipes vendor data and adds test fixtures, so it refuses any non-local database.

Other commands against production: `npm run db:migrate:deploy` (migrations only).

## 6. Custom domain (optional)

Vercel → Project → **Settings → Domains** → add your domain and follow the DNS steps. Then set `NEXT_PUBLIC_SITE_URL=https://your-domain` in `.env.deploy.local` and run `npm run deploy` again. Without it, canonical links, `robots.txt` and `sitemap.xml` use the project's `*.vercel.app` production domain.

## Environment variables (complete list)

| Variable | Needed | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres URL. Transaction pooler (6543) in production. SSL is turned on automatically for non-local hosts. |
| `SESSION_SECRET` | yes | 32+ random characters. Changing it signs everyone out. |
| `STORAGE_DRIVER` | yes in production | `supabase`, `s3` or `r2`. `local` (the development default) is refused in production because Vercel's disk is read-only. |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | for `supabase` | `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT key) also works. |
| `STORAGE_BUCKET` | no | Default `vela-media` (public). |
| `STORAGE_PRIVATE_BUCKET` | no | Default `<STORAGE_BUCKET>-private`. Holds `private/…` keys (vendor documents). |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | for `s3` / `r2` | Path-style requests, AWS Signature V4. |
| `S3_REGION` | no | Default `auto` (r2) or `us-east-1`. |
| `S3_PUBLIC_URL` | no | Public base URL of the media bucket. Without it, approved media is served through short-lived signed links. |
| `NEXT_PUBLIC_SITE_URL` | no | Public `https://` origin. Defaults to `VERCEL_PROJECT_PRODUCTION_URL` on Vercel. |
| `DATABASE_URL_SESSION` | deploy only | Session pooler, used by migrations. |
| `DATABASE_SSL` | no | `disable`, `require` (default for remote hosts) or `verify-full`. |
| `DATABASE_SSL_CA` | no | PEM text of the database CA to verify the certificate (Supabase → Database → SSL). |
| `DB_POOL_MAX` | no | Connections per instance; default 3 on Vercel, 10 elsewhere. |
| `MEDIA_VIDEO_UPLOADS` | no | `true` to allow MP4 uploads in production (off by default; links to YouTube/Vimeo always work). |
| `STORAGE_ALLOW_LOCAL` | no | `1` only when self-hosting on a server with a persistent disk. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no | Reserved for a browser client. |
| `VERCEL_PROJECT`, `VERCEL_SCOPE`, `VERCEL_TOKEN` | deploy only | Project name (default `vela`), team slug, CI token. |

If a variable is missing, the server refuses to start and the Vercel function log lists every missing one at once (`instrumentation.ts` → `lib/env.ts`).

## How production storage works

- Vendor uploads go **straight from the browser to the bucket** through a signed upload URL (Vercel functions accept at most 4.5 MB per request). The server then downloads the raw file, checks it, makes the WebP variants with sharp and stores them in the bucket.
- **Approved** media is loaded from the bucket's public URL (Supabase's CDN). Media that is pending review, rejected or hidden goes through `/media/<key>`, which checks the viewer (owner or admin) and redirects to a 5-minute signed URL; everyone else gets 404.
- **Vendor documents** live in the private bucket and are only reachable through `/api/admin/documents/<id>/file` (admins), which redirects to a 60-second signed URL. Documents are limited to 4 MB, because they are posted through a function.
- Photos already uploaded with another driver keep working: each `media_assets` row records the driver that stored it.

## Free-tier limits

- **Supabase free:** 500 MB database, 1 GB storage, 5 GB egress a month, 50 MB per file. The project **pauses after 7 days without activity**; open the dashboard and press **Restore**.
- **Vercel Hobby:** for personal, **non-commercial** use; 100 GB bandwidth a month; function requests up to 4.5 MB. Move to Pro before charging vendors.
- The in-memory rate limits (login, sign-up, enquiries) are per function instance, so on Vercel they are looser than on one server. Fine for launch; a shared store (for example Upstash Redis free) can replace them later.
