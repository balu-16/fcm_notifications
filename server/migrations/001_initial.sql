CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub text NOT NULL UNIQUE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'admin')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_lower_email_idx ON users (lower(email));
CREATE TABLE device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('web', 'android')),
  user_agent text,
  is_active boolean NOT NULL DEFAULT true,
  deactivated_reason text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_active_user_idx ON device_tokens (user_id) WHERE is_active;
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  image_url text,
  click_action text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_type text NOT NULL CHECK (target_type IN ('all', 'users', 'platform')),
  target_user_ids uuid[],
  target_platform text CHECK (target_platform IN ('web', 'android')),
  skipped_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  status text NOT NULL CHECK (status IN ('pending', 'sending', 'completed', 'partial', 'failed')),
  total_devices integer NOT NULL CHECK (total_devices >= 0),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (created_by, idempotency_key)
);
CREATE INDEX notifications_created_at_idx ON notifications (created_at DESC);
CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  device_token_id uuid REFERENCES device_tokens(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('web', 'android')),
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  fcm_message_id text,
  error_code text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, device_token_id)
);
CREATE INDEX notification_deliveries_notification_status_idx ON notification_deliveries (notification_id, status);
