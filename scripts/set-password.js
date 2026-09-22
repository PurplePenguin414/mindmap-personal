// Usage: node scripts/set-password.js "your new password"
// Prints a bcrypt hash to paste into .env as APP_PASSWORD_HASH=...
const bcrypt = require('bcrypt');

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: node scripts/set-password.js "your new password"');
  process.exit(1);
}

bcrypt.hash(pw, 12).then(hash => {
  console.log('\nAdd this line to your .env file:\n');
  console.log(`APP_PASSWORD_HASH=${hash}\n`);
});
