-- Hapus tabel jika sudah ada (berguna saat development)
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS likes;
DROP TABLE IF EXISTS users;

-- Tabel Users
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    name TEXT,
    location_city TEXT,
    location_country TEXT,
    gender TEXT,            -- 'MALE', 'FEMALE', 'NON-BINARY'
    preference TEXT,        -- 'MALE', 'FEMALE', 'EVERYONE'
    bio TEXT,
    photo_url TEXT,
    language TEXT DEFAULT 'id', -- Default bahasa 'id'
    is_onboarding_complete BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Likes (Mencatat siapa menyukai siapa)
CREATE TABLE likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    liker_telegram_id INTEGER NOT NULL,
    liked_telegram_id INTEGER NOT NULL,
    status TEXT DEFAULT 'PENDING', -- 'PENDING', 'MATCHED', 'REJECTED'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(liker_telegram_id, liked_telegram_id),
    FOREIGN KEY(liker_telegram_id) REFERENCES users(telegram_id),
    FOREIGN KEY(liked_telegram_id) REFERENCES users(telegram_id)
);

-- Indexing untuk mempercepat pencarian (Discovery Feed)
CREATE INDEX idx_users_location ON users(location_city, location_country);
CREATE INDEX idx_likes_status ON likes(status);