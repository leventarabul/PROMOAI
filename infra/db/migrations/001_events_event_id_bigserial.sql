-- Migration: change events.event_id to BIGSERIAL and make it server-generated

-- If you have existing non-numeric event_id values, recreate the table instead.

ALTER TABLE events DROP CONSTRAINT events_pkey;

ALTER TABLE events
  ALTER COLUMN event_id TYPE BIGINT
  USING event_id::bigint;

CREATE SEQUENCE IF NOT EXISTS events_event_id_seq;

ALTER SEQUENCE events_event_id_seq OWNED BY events.event_id;

ALTER TABLE events
  ALTER COLUMN event_id SET DEFAULT nextval('events_event_id_seq');

ALTER TABLE events ADD PRIMARY KEY (event_id);
