-- Approximate anonymous submission counts. No user, IP, or user-agent data —
-- by design. D1 enforces the foreign key, so plays for challenges that
-- don't exist are rejected.
CREATE TABLE plays (
  mode       TEXT    NOT NULL CHECK (mode IN ('css', 'tailwind')),
  date       TEXT    NOT NULL,
  difficulty TEXT    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  -- UTC day the submission happened
  day        TEXT    NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mode, date, difficulty, day),
  FOREIGN KEY (mode, date, difficulty) REFERENCES challenges (mode, date, difficulty)
);
