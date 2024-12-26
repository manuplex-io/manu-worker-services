#!/bin/bash
# Wait for 60 seconds
sleep 60
# Perform the health check
HEALTHCHECK_URL="https://consul.prod.forty-two.xyz/v1/health/checks/worker-services"
# Fetch the health check response
response=$(curl -s "$HEALTHCHECK_URL")
# Check if any service has a "Status": "passing"
if echo "$response" | grep -q '"Status":"passing"'; then
  echo "Health check passed."
  echo "success" > /tmp/health_check_status  # Write success to a temporary file
  exit 0  # Exit with success
else
  echo "Health check failed."
  echo "failed" > /tmp/health_check_status  # Write failure to a temporary file
fi