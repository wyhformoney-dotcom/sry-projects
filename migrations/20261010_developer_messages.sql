CREATE TABLE IF NOT EXISTS developer_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  game_title TEXT NOT NULL,
  game_title_zh TEXT NOT NULL DEFAULT '',
  game_title_ko TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL,
  sender_name_zh TEXT NOT NULL DEFAULT '',
  sender_name_ko TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL,
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  request_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
  read_at TEXT,
  UNIQUE(sender_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON developer_messages(recipient_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_expiry ON developer_messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender_time ON developer_messages(sender_id, created_at);
