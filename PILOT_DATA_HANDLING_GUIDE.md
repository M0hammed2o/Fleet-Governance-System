# Pilot Data Handling Guide

Use only the deterministic synthetic tenant, `example.test` addresses, fictional identifiers, synthetic/no-op providers, non-biometric sentinels, and text evidence that explicitly says synthetic. Do not enter real names, phones, emails, registrations, VINs, addresses, routes, coordinates, faces, identity documents, credentials, payment data, or customer records.

Generated reports, UAT evidence, screenshots, APKs, database dumps, backups, `.env` files, keys, tokens, raw serials, and device/browser artifacts stay untracked. Store temporary internal evidence under ignored `.data`; minimize it, restrict access, and delete it under the approved evidence schedule. Never copy raw biometric material into logs, reports, tickets, email, chat, or source control. Use only SHA-256 hashes for APK and device-serial correlation.

Reset is limited to the fixed synthetic tenant on loopback databases and preserves unrelated tenants. Production is refused. Run seed verification after every reset.
