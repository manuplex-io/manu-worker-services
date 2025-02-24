#!/bin/bash
set -e

# Customize the stack name here:
STACK_NAME="${1:-uSt-bS}"

REPLICAS="${2:-1}" # Defaults to 1 if not provided

# The script assumes docker-stack.yml is in the same directory if we copied it via appspec.yml:
cd /home/ec2-user/codeDeploy/scripts

echo "Deploying Docker stack with name: $STACK_NAME"

# Deploy the stack
docker stack deploy -c docker-stack.yml "$STACK_NAME"

echo "Deployment complete!"

