# Demo account and synthetic data guide

## Local configuration

Copy `.env.example` to the ignored `.env`/`.env.test` files using the repository setup guide. Set `DEMO_SELF_SERVICE_ENABLED=true` only in local development. For an interactive seeded login, set a local `DEMO_SEED_PASSWORD` of at least 12 characters; never commit or paste it into evidence. If omitted, the seed uses an unrevealed random password and remains suitable for automated verification, while interactive access should use a newly registered workspace.

Start the existing local PostgreSQL dependency, apply migrations, seed shared reference data, then reset the synthetic demonstration:

```powershell
docker compose up -d
npx prisma migrate deploy
npm run seed
npm run demo:reset
npm run demo:verify
npm run dev
```

`npm run demo:reset` is the one-command destructive-and-recreate operation for exactly `genbridge-synthetic-fleet-pilot`. Its safety guard refuses production, remote databases, unapproved database names and any tenant whose fixed ID/slug/name do not all match. It never prints the password. Other tenants are not touched.

## Data included

The repeatable dataset contains 15 invented drivers, 15 invented vehicles across trucks (including 8- and 18-tonne examples), bakkie/pickup, van, sales, passenger, plant/equipment, light commercial, other and trailers; assigned and unassigned drivers; green/yellow/red rating cases; an approved assigned guard and a pending guard; separate operational roles; expiring/valid documents; open and resolved operational history; gate movements, reconciliations, investigations and synthetic tracker records.

Profile “images” are generated one-pixel colour swatches containing no person or real vehicle. Evidence text files state that they are synthetic. Biometric template fixtures are fixed non-person sentinels, not images, descriptors, embeddings or data derived from a person.

## Allowed and prohibited data

- Allowed: invented `example.test` addresses, synthetic identifiers, abstract generated images and fabricated documents.
- Prohibited: real names, faces, licence/identity numbers, contact details, registrations, VINs, locations, provider credentials, tracking feeds, customer documents or biometric material.
- No invitation email is sent. A local one-time invitation URL may be copied only within the controlled development session.
- Uploaded objects are private, tenant-prefixed and accessed via authorized, short-lived signed routes. Filenames, extensions, MIME types, file signatures and sizes are validated; deceptive/executable paths are rejected; images are re-encoded with metadata removed.

## Fresh prospect workflow

For the customer-creation portion of a demonstration, use `/register` to create a new invented tenant, rather than editing the fixed seed. Delete test tenants only through an approved local cleanup procedure after the demonstration; do not point reset tooling at customer or hosted databases.
