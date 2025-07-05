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
    event_location TEXT,
    event_type VARCHAR(20) CHECK (event_type IN ('private', 'public')),
    guests TEXT,
    creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rsvps (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('going', 'not_going')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
    UNIQUE(event_id, user_id)
);


CREATE TABLE IF NOT EXISTS invitations (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    inviter INTEGER REFERENCES users(id) ON DELETE CASCADE,
    invitee INTEGER REFERENCES users(id) ON DELETE CASCADE,
    invitee_email VARCHAR(255),
    invitee_phone_number VARCHAR(25),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'going', 'not_going')),
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

/*
ALTER TABLE rsvps
ADD CONSTRAINT unique_user_event_rsvp UNIQUE (user_id, event_id);
*/

/*
INSERT INTO users (first_name, last_name, username, email) VALUES
('John', 'Smith', 'johnsmith', 'john.smith@email.com'),
('Emma', 'Johnson', 'emmaj', 'emma.johnson@email.com'),
('Michael', 'Brown', 'mikebrown', 'michael.brown@email.com'),
('Sarah', 'Davis', 'sarahdavis', 'sarah.davis@email.com'),
('David', 'Wilson', 'davidw', 'david.wilson@email.com'),
('Lisa', 'Miller', 'lisamiller', 'lisa.miller@email.com'),
('James', 'Taylor', 'jamestaylor', 'james.taylor@email.com'),
('Anna', 'Anderson', 'annaanderson', 'anna.anderson@email.com'),
('Robert', 'Thomas', 'robthomas', 'robert.thomas@email.com'),
('Jessica', 'Jackson', 'jessicaj', 'jessica.jackson@email.com'),
('William', 'White', 'willwhite', 'william.white@email.com'),
('Ashley', 'Harris', 'ashleyh', 'ashley.harris@email.com'),
('Christopher', 'Martin', 'chrismartin', 'christopher.martin@email.com'),
('Amanda', 'Garcia', 'amandagarcia', 'amanda.garcia@email.com'),
('Matthew', 'Robinson', 'mattrobinson', 'matthew.robinson@email.com'),
('Michelle', 'Clark', 'michelleclark', 'michelle.clark@email.com'),
('Daniel', 'Rodriguez', 'danrodriguez', 'daniel.rodriguez@email.com'),
('Stephanie', 'Lewis', 'stephlewis', 'stephanie.lewis@email.com'),
('Anthony', 'Lee', 'anthonylee', 'anthony.lee@email.com'),
('Jennifer', 'Walker', 'jenniferw', 'jennifer.walker@email.com');
*/