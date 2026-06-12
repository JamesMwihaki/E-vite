CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    first_name TEXT, 
    last_name TEXT, 
    username VARCHAR(255) UNIQUE NOT NULL,
    email  VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
); 

CREATE TABLE IF NOT EXISTS events(
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    event_time TIME NOT NULL,
    location TEXT,
    event_type VARCHAR(20) CHECK (event_type IN ('private', 'public')),
    creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rsvps (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) CHECK (status IN ('going', 'not_going')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
    UNIQUE(event_id, user_id)
);


CREATE TABLE IF NOT EXISTS invitations (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    inviter INTEGER REFERENCES users(id) ON DELETE CASCADE,
    invitee_email VARCHAR(255),
    invitee_phone_number VARCHAR(25),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    token VARCHAR(255) UNIQUE, 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
);

CREATE TABLE IF NOT EXISTS ai_events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    event_time TIME NOT NULL,
    location TEXT,
    source_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_message TEXT,
    ai_response TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Auth: password hash column for new signups. Existing rows (e.g. legacy sarah seed) stay NULL and can't log in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE TABLE IF NOT EXISTS friendships (
    id SERIAL PRIMARY KEY,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
);

-- Direct in-platform invitations (by user id) live alongside the email-based ones.
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invitee_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Exclusive events forked from a public event keep a pointer to their source,
-- so the detail page can show "Based on: <public event>". If the source is
-- deleted the fork lives on, just without the link.
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL;

-- Event-scout agent: users opt in by setting a city on their profile. The
-- timezone is captured silently from the browser so the agent can run at
-- 5 AM in each user's local time. Coordinates (from device geolocation or
-- geocoding the city) power radius-based visibility of discovered events.
ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Agent-discovered events live in the regular events table (public, RSVP-able,
-- forkable) with extra provenance columns. external_key dedupes re-discoveries
-- of the same event (normalized title|date|venue); city scopes events to the
-- user cluster they were found for.
ALTER TABLE events ADD COLUMN IF NOT EXISTS discovered BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS external_key TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE events ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
CREATE UNIQUE INDEX IF NOT EXISTS events_external_key_uniq ON events(external_key);

-- The agent's knowledge base: places it has learned host events ("this bar is
-- known for live music"). Consulted on every run and grown over time.
CREATE TABLE IF NOT EXISTS agent_venues (
    id SERIAL PRIMARY KEY,
    city TEXT NOT NULL,
    name TEXT NOT NULL,
    notes TEXT,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(city, name)
);

-- Listing sites that have yielded events for a city before (songkick.com,
-- a venue's own calendar, ...). Fed back to the agent as "check these first";
-- hits counts how many events each source has produced over time.
CREATE TABLE IF NOT EXISTS agent_sources (
    id SERIAL PRIMARY KEY,
    city TEXT NOT NULL,
    domain TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(city, domain)
);

-- One row per city per local date keeps the hourly cron idempotent: a cluster
-- runs once after 5 AM local time and is skipped for the rest of that day.
CREATE TABLE IF NOT EXISTS agent_runs (
    id SERIAL PRIMARY KEY,
    city TEXT NOT NULL,
    run_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('ok', 'error')),
    events_found INTEGER DEFAULT 0,
    detail TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(city, run_date)
);

-- System user that owns agent-discovered events. password_hash stays NULL so
-- nobody can log in as it.
INSERT INTO users (username, email, first_name, last_name)
VALUES ('evite_scout', 'scout@evite.internal', 'E-vite', 'Scout')
ON CONFLICT DO NOTHING;