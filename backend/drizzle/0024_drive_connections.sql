-- GOI-91: a user's connected cloud drive, where briefs get filed as PDFs.
--
-- One row per (user, provider) so a second provider can be connected later
-- without displacing Google Drive.
CREATE TABLE IF NOT EXISTS drive_connections (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       text NOT NULL,
  refresh_token  text NOT NULL,
  account_email  text,
  folder_name    text NOT NULL DEFAULT 'Afisz.ka',
  folder_id      text,
  last_error     text,
  last_upload_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);
