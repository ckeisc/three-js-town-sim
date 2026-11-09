DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE towns (
  id INTEGER PRIMARY KEY,
  grid TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
