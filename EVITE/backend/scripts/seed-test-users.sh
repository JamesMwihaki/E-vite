#!/usr/bin/env bash
# Seed 10 test users via the real signup endpoint so passwords get bcrypt-hashed
# the same way as a normal signup. Idempotent — re-running just skips duplicates.
#
# Usage:   ./seed-test-users.sh
# Override API URL: API_URL=http://localhost:3001 ./seed-test-users.sh

set -u

ENDPOINT="${API_URL:-http://localhost:3001}/api/signup"
PASSWORD="password123"

# username:first:last
USERS=(
  "test1:James:Tester"
  "test2:Sarah:Demo"
  "test3:Mike:Quinn"
  "test4:Anna:Patel"
  "test5:Liam:Brown"
  "test6:Emma:Davies"
  "test7:Noah:Wright"
  "test8:Olivia:Hall"
  "test9:Lucas:Reed"
  "test10:Mia:Foster"
)

echo "Seeding users -> $ENDPOINT"
echo

for entry in "${USERS[@]}"; do
  IFS=":" read -r USERNAME FIRST LAST <<< "$entry"
  EMAIL="${USERNAME}@example.com"

  STATUS=$(curl -s -o /tmp/seed-body.json -w "%{http_code}" \
    -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$USERNAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"first_name\":\"$FIRST\",\"last_name\":\"$LAST\"}")

  case "$STATUS" in
    201) printf "[ok]   %-8s %s %s <%s>\n" "$USERNAME" "$FIRST" "$LAST" "$EMAIL" ;;
    409) printf "[skip] %-8s already exists\n" "$USERNAME" ;;
    000) printf "[err]  %-8s could not reach backend at %s\n" "$USERNAME" "$ENDPOINT"; exit 1 ;;
    *)   printf "[err]  %-8s HTTP %s: %s\n" "$USERNAME" "$STATUS" "$(cat /tmp/seed-body.json)" ;;
  esac
done

echo
echo "Done. All users share password: $PASSWORD"
