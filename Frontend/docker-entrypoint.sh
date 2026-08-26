#!/bin/sh
set -eu

: "${API_BASE_URL:=http://localhost:3001}"
: "${SQUARE_APP_ID:=}"
: "${SQUARE_LOCATION_ID:=}"
: "${SQUARE_ENVIRONMENT:=sandbox}"
: "${SQUARE_SDK_URL:=https://sandbox.web.squarecdn.com/v1/square.js}"
: "${AFTERPAY_SCRIPT_URL:=https://portal.sandbox.afterpay.com/afterpay.js}"

export API_BASE_URL SQUARE_APP_ID SQUARE_LOCATION_ID SQUARE_ENVIRONMENT SQUARE_SDK_URL AFTERPAY_SCRIPT_URL

envsubst < /usr/share/nginx/html/config.js.template > /usr/share/nginx/html/config.js

exec nginx -g 'daemon off;'