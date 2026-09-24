CREATE TABLE payment_intents (
  reference TEXT PRIMARY KEY,
  voter_name TEXT NOT NULL,
  voter_email TEXT NOT NULL,
  selections JSONB NOT NULL,
  votes INTEGER NOT NULL CHECK (votes BETWEEN 1 AND 999),
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recorded_votes (
  payment_reference TEXT NOT NULL REFERENCES payment_intents(reference),
  category TEXT NOT NULL,
  nominee TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (payment_reference, category)
);

CREATE TABLE google_form_deliveries (
  payment_reference TEXT PRIMARY KEY REFERENCES payment_intents(reference),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'delivered')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX google_form_deliveries_pending_idx
  ON google_form_deliveries (next_attempt_at)
  WHERE state = 'pending';
