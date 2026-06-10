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