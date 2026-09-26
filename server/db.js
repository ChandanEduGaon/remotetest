// Dispatches to a driver based on DB_CLIENT (mysql | sqlite).
// mysql -> production/VPS. sqlite -> zero-install local dev only.
const client = (process.env.DB_CLIENT || 'mysql').toLowerCase();

const driver = client === 'sqlite' ? require('./drivers/sqlite') : require('./drivers/mysql');

module.exports = driver;
