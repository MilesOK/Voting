# Awards voting backend

This service keeps the existing ballot UI and Google Form response sheet, but makes the database the source of truth for paid votes.

## Setup

1. Create a PostgreSQL database and run `db/schema.sql`.
2. Copy `.env.example` to `.env`, then enter the database URL, public application URL, Paystack secret key, Google Form ID, and Form entry IDs.
3. Add a short-answer **Payment reference** field to the existing Google Form. Put that field's `entry.XXXXXXXXX` ID in `GOOGLE_ENTRY_PAYMENT_REFERENCE`.
4. Run `npm.cmd install` and `npm.cmd start`.
5. In the Paystack dashboard, set the webhook URL to `https://your-domain.example/api/paystack/webhook`.

The production URL in `APP_URL` must use HTTPS. The service verifies the signed Paystack webhook and independently verifies the payment with Paystack before creating vote rows. Each payment reference is unique, and the database transaction ensures only one set of votes is recorded per paid transaction.

Google Form delivery is recorded in `google_form_deliveries` and retried after temporary failures. The payment reference is included in every Form response so results can be audited and deduplicated.
