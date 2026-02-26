const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'copytrade.sqlite');
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

function initDb() {
  const db = new Database(DB_PATH);
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  db.close();
  console.log(`DB initialized at ${DB_PATH}`);
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--init-db')) {
    initDb();
    return;
  }

  console.log('Copytrade simulator scaffold ready.');
  console.log('Run: npm run init-db');
}

main();
