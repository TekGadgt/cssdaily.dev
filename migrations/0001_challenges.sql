-- One row per published challenge. The challenge text lives here; its
-- target screenshot lives in R2 at targets/<mode>/<target_image>.
CREATE TABLE challenges (
  mode         TEXT    NOT NULL CHECK (mode IN ('css', 'tailwind')),
  date         TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  difficulty   TEXT    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  title        TEXT    NOT NULL,
  time_limit   INTEGER NOT NULL,
  target_image TEXT    NOT NULL,
  -- JSON {"starter":…,"target":…}, exactly as in the original files
  body         TEXT    NOT NULL,
  -- 1 = pre-multi-difficulty day (unsuffixed file); it counts as complete
  -- for every difficulty, so the generator never adds siblings to it
  legacy       INTEGER NOT NULL DEFAULT 0 CHECK (legacy IN (0, 1)),
  -- JSON generation metadata (provider/model; exemplars in Phase 6)
  generation   TEXT,
  -- ms since epoch at insert
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (mode, date, difficulty)
);
