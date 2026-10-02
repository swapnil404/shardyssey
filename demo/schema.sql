CREATE TABLE IF NOT EXISTS events (
  user_id BIGINT NOT NULL,
  event_id BIGINT NOT NULL,
  category VARCHAR(32) NOT NULL,
  PRIMARY KEY (user_id, event_id)
);
