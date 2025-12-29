-- Users (from Telegram)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    telegram_name TEXT,
    telegram_username TEXT,
    is_superadmin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Choirs (spaces)
CREATE TABLE IF NOT EXISTS choirs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    owner_id INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Choir members
CREATE TABLE IF NOT EXISTS choir_members (
    choir_id INTEGER REFERENCES choirs(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (choir_id, user_id)
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT
);

-- Songs (global library)
CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    pdf_path TEXT,
    key_signature TEXT,
    voices TEXT,
    difficulty TEXT,
    created_by INTEGER REFERENCES users(id),
    is_public INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Song categories
CREATE TABLE IF NOT EXISTS song_categories (
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (song_id, category_id)
);

-- Choir songs (songs added to specific choir)
CREATE TABLE IF NOT EXISTS choir_songs (
    choir_id INTEGER REFERENCES choirs(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (choir_id, song_id)
);

-- Daily repertoire
CREATE TABLE IF NOT EXISTS repertoire (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    choir_id INTEGER REFERENCES choirs(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (choir_id, date)
);

-- Repertoire songs
CREATE TABLE IF NOT EXISTS repertoire_songs (
    repertoire_id INTEGER REFERENCES repertoire(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (repertoire_id, song_id)
);

-- Insert default categories (church holidays)
INSERT OR IGNORE INTO categories (id, name, icon) VALUES
    (1, 'Різдво', '🌟'),
    (2, 'Новий Рік', '🎄'),
    (3, 'Пасха', '☀️'),
    (4, 'Страждання Христа', '✝️'),
    (5, 'Свято Жнив', '🌾'),
    (6, 'Хрещення', '💧'),
    (7, 'Вознесіння', '☁️'),
    (8, 'Вїзд в Єрусалим', '🌿'),
    (9, 'Трійця', '🕊️'),
    (10, 'Інше', '🎵');

-- No demo data - start with empty database
