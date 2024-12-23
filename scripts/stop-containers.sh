#!/bin/bash

# Stop the running Docker containers using the stack name
echo "Stopping running Docker containers..."
cd /home/ec2-user/manu-worker-services || { echo "Failed to navigate to stack directory"; exit 1; }
docker stack rm manu-worker-services-stack || { echo "Failed to stop containers"; exit 1; }

# Wait for all containers to be removed
echo "Waiting for containers to stop..."
sleep 30