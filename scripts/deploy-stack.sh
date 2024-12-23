#!/bin/bash

# Navigate to the directory containing the stack file
cd /home/ec2-user/manu-worker-services || { echo "Failed to navigate to stack directory"; exit 1; }

echo "Authenticating with ECR..."
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 637423298319.dkr.ecr.us-west-2.amazonaws.com

# # Pull the latest image from ECR (ensure you specify the correct repository and image tag)
echo "Pulling latest image from ECR..."
docker pull 637423298319.dkr.ecr.us-west-2.amazonaws.com/manu/worker-services:latest

# Deploy the Docker stack
echo "Deploying Docker stack..."
docker stack deploy -c docker-stack.yml manu-worker-services-stack || { echo "Failed to deploy Docker stack"; exit 1; }

# Check if the stack was deployed successfully
echo "Deployment Successful"
