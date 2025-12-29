import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Create database
const db = new Database(path.join(__dirname, '../../data.db'))

// Enable foreign keys
db.pragma('foreign_keys = ON')

// Initialize schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8')
db.exec(schema)

console.log('✅ Database initialized')

export default db
