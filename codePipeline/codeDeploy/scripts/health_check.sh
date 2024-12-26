#!/bin/bash

# Perform health check by checking if the response contains "status":"ok"
#!/bin/bash

# Wait for 60 seconds
sleep 60

# Perform the health check
if curl -s https://os.manuplex.io/services/health | grep -q '"status":"ok"'; then
  echo "Health check passed."
  echo "success" > /tmp/health_check_status  # Write success to a temporary file
  exit 0  # Exit with success
else
  echo "Health check failed."
  echo "failed" > /tmp/health_check_status  # Write failure to a temporary file
fi