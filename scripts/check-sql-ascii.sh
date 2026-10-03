#!/bin/sh
# Standing rule: every .sql file is plain ASCII where it matters.
# ERROR on non-ASCII in live SQL (can corrupt data); WARN on comment-only.
#   sh scripts/check-sql-ascii.sh
node "$(dirname "$0")/check-sql-ascii.cjs"
