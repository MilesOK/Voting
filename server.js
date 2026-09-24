import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const pricePerVote = 100;

const required = ['DATABASE_URL', 'APP_URL', 'PAYSTACK_SECRET_KEY', 'GOOGLE_FORM_ID'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} must be configured`);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const nominees = {
  cat1: { category: 'Best Class Rep', values: ['David Nkabu - 500L', 'Idongesit Mark - 400L', 'Villian - 300L', 'Divine Bob - 200L'] },
  cat2: { category: 'Best Student Leader', values: ['Victor Umoh', 'Rt. Hon. Wilfred Ogechukwu', 'Sen. Nduka Nelson', 'Hon. Victor Wilson'] },
  cat3: { category: 'Brand of the Year', values: ['Vklassics', 'DJ Slimmz', 'Styler Profiles', 'Victor Wilson Photography', 'iDesign'] },
  cat4: { category: 'Entrepreneur of the Year', values: ['Idongesit Mark - Stylers Profiles', 'Stella Obidi', 'Victoria Edet', 'Catherine Idobo'] },
  cat5: { category: 'Outstanding Student of the Year', values: ['Joseph Ifeanyi', 'Mfonido Bassey', 'Enotobong', 'Precious Bassey', 'Charles Wisdom'] },
  cat6: { category: 'Artist of the Year', values: ['Allen songz', 'Larry Khee'] }
};

const entryIds = {
  voterName: process.env.GOOGLE_ENTRY_VOTER_NAME,
  voterEmail: process.env.GOOGLE_ENTRY_VOTER_EMAIL,
  cat1: process.env.GOOGLE_ENTRY_CAT1,
  cat2: process.env.GOOGLE_ENTRY_CAT2,
  cat3: process.env.GOOGLE_ENTRY_CAT3,
  cat4: process.env.GOOGLE_ENTRY_CAT4,
  cat5: process.env.GOOGLE_ENTRY_CAT5,
  cat6: process.env.GOOGLE_ENTRY_CAT6,
  votes: process.env.GOOGLE_ENTRY_VOTES,
  paymentReference: process.env.GOOGLE_ENTRY_PAYMENT_REFERENCE
};

function validVoteRequest(body) {
  const voterName = String(body.voterName || '').trim();
  const voterEmail = String(body.voterEmail || '').trim().toLowerCase();
  const votes = Number(body.votes);
  const selections = body.selections;

  if (!voterName || voterName.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(voterEmail)) return null;
  if (!Number.isInteger(votes) || votes < 1 || votes > 999 || !selections || typeof selections !== 'object') return null;

  const cleanSelections = {};
  for (const [key, value] of Object.entries(selections)) {
    if (!nominees[key] || typeof value !== 'string' || !nominees[key].values.includes(value)) return null;
    cleanSelections[key] = value;
  }
  return Object.keys(cleanSelections).length ? { voterName, voterEmail, votes, selections: cleanSelections } : null;
}

async function paystack(pathname, options = {}) {
  const response = await fetch(`https://api.paystack.co${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status) throw new Error(data.message || 'Paystack request failed');
  return data.data;
}

async function markPaymentAsPaid(reference) {
  const payment = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (payment.status !== 'success') return { status: 'pending' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [intent] } = await client.query('SELECT * FROM payment_intents WHERE reference = $1 FOR UPDATE', [reference]);
    if (!intent) throw new Error('Unknown payment reference');
    if (intent.status === 'paid') {
      await client.query('COMMIT');
      return { status: 'paid' };
    }
    if (payment.amount !== intent.amount_kobo || payment.currency !== intent.currency || payment.customer?.email?.toLowerCase() !== intent.voter_email) {
      throw new Error('Payment details did not match the stored intent');
    }

    await client.query("UPDATE payment_intents SET status = 'paid', paid_at = NOW() WHERE reference = $1", [reference]);
    for (const [key, nominee] of Object.entries(intent.selections)) {
      await client.query(
        'INSERT INTO recorded_votes (payment_reference, category, nominee, quantity) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [reference, nominees[key].category, nominee, intent.votes]
      );
    }
    await client.query('INSERT INTO google_form_deliveries (payment_reference) VALUES ($1) ON CONFLICT DO NOTHING', [reference]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  void deliverGoogleForm(reference).catch((error) => console.error('Google Form delivery failed:', error.message));
  return { status: 'paid' };
}

async function deliverGoogleForm(reference) {
  const client = await pool.connect();
  let intent;
  try {
    await client.query('BEGIN');
    const { rows: [delivery] } = await client.query(
      "SELECT * FROM google_form_deliveries WHERE payment_reference = $1 AND state = 'pending' AND next_attempt_at <= NOW() FOR UPDATE SKIP LOCKED",
      [reference]
    );
    if (!delivery) {
      await client.query('COMMIT');
      return;
    }
    const { rows } = await client.query('SELECT * FROM payment_intents WHERE reference = $1', [reference]);
    intent = rows[0];
    await client.query('UPDATE google_form_deliveries SET attempts = attempts + 1, next_attempt_at = NOW() + INTERVAL \'5 minutes\' WHERE payment_reference = $1', [reference]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const data = { voterName: intent.voter_name, voterEmail: intent.voter_email, votes: intent.votes, ...intent.selections, paymentReference: reference };
  const body = new URLSearchParams();
  for (const [field, entryId] of Object.entries(entryIds)) {
    if (entryId && data[field] !== undefined) body.append(entryId, String(data[field]));
  }
  try {
    const response = await fetch(`https://docs.google.com/forms/d/e/${process.env.GOOGLE_FORM_ID}/formResponse`, { method: 'POST', body, redirect: 'manual' });
    if (!response.ok && response.status !== 0 && response.status !== 302) throw new Error(`Google Form returned ${response.status}`);
    await pool.query("UPDATE google_form_deliveries SET state = 'delivered', delivered_at = NOW(), last_error = NULL WHERE payment_reference = $1", [reference]);
  } catch (error) {
    await pool.query('UPDATE google_form_deliveries SET last_error = $2 WHERE payment_reference = $1', [reference, String(error.message).slice(0, 500)]);
    throw error;
  }
}

function isValidWebhook(request) {
  const signature = request.get('x-paystack-signature');
  if (!signature || !request.body) return false;
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(request.body).digest('hex');
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

app.post('/api/paystack/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
  if (!isValidWebhook(request)) return response.sendStatus(401);
  let event;
  try {
    event = JSON.parse(request.body.toString('utf8'));
  } catch {
    return response.sendStatus(400);
  }
  if (event.event === 'charge.success' && event.data?.reference) {
    try { await markPaymentAsPaid(event.data.reference); } catch (error) { console.error('Webhook processing failed:', error.message); return response.sendStatus(500); }
  }
  return response.sendStatus(200);
});

app.use(express.json({ limit: '20kb' }));
app.use('/assets', express.static(path.join(rootDir, 'assets'), { index: false }));
app.get('/', (_request, response) => response.sendFile(path.join(rootDir, 'index.html')));
app.get('/index.css', (_request, response) => response.sendFile(path.join(rootDir, 'index.css')));
app.get('/script.js', (_request, response) => response.sendFile(path.join(rootDir, 'script.js')));

app.post('/api/payments', async (request, response) => {
  const vote = validVoteRequest(request.body);
  if (!vote) return response.status(400).json({ message: 'Please provide valid voter details and selections.' });
  const reference = `vote_${crypto.randomUUID()}`;
  const amountKobo = Object.keys(vote.selections).length * vote.votes * pricePerVote * 100;
  try {
    await pool.query(
      'INSERT INTO payment_intents (reference, voter_name, voter_email, selections, votes, amount_kobo) VALUES ($1, $2, $3, $4, $5, $6)',
      [reference, vote.voterName, vote.voterEmail, JSON.stringify(vote.selections), vote.votes, amountKobo]
    );
    const transaction = await paystack('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({ email: vote.voterEmail, amount: amountKobo, reference, callback_url: `${process.env.APP_URL}/?reference=${encodeURIComponent(reference)}` })
    });
    return response.status(201).json({ authorizationUrl: transaction.authorization_url });
  } catch (error) {
    console.error('Payment initialization failed:', error.message);
    return response.status(502).json({ message: 'Unable to start payment. Please try again.' });
  }
});

app.get('/api/payments/:reference', async (request, response) => {
  const { reference } = request.params;
  try {
    const { rows: [intent] } = await pool.query('SELECT status FROM payment_intents WHERE reference = $1', [reference]);
    if (!intent) return response.sendStatus(404);
    if (intent.status === 'pending') await markPaymentAsPaid(reference);
    const { rows: [updated] } = await pool.query('SELECT status FROM payment_intents WHERE reference = $1', [reference]);
    return response.json({ status: updated.status });
  } catch (error) {
    console.error('Payment status failed:', error.message);
    return response.status(502).json({ message: 'Unable to verify payment yet.' });
  }
});

app.use('/api', (_request, response) => {
  response.status(404).json({ message: 'Payment service endpoint was not found.' });
});

app.use((error, _request, response, _next) => {
  console.error('Request failed:', error.message);
  if (response.headersSent) return;
  response.status(error.status || 500).json({ message: 'Payment service is temporarily unavailable.' });
});

setInterval(() => {
  pool.query("SELECT payment_reference FROM google_form_deliveries WHERE state = 'pending' AND next_attempt_at <= NOW() ORDER BY next_attempt_at LIMIT 20")
    .then(({ rows }) => Promise.allSettled(rows.map(({ payment_reference }) => deliverGoogleForm(payment_reference))))
    .catch((error) => console.error('Google Form retry scan failed:', error.message));
}, 60_000).unref();

app.listen(port, () => console.log(`Voting server listening on port ${port}`));
