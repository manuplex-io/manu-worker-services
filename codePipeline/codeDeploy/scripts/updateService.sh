#!/bin/bash
set -e

# Customize these as needed:
REGION="us-west-2"
ACCOUNT_ID="637423298319"

STACK_NAME="${1:-uSt-bS}"      # Can be overridden by CLI arg, defaults to "GreenStack"
SERVICE_SHORT_NAME="worker-services-1"
# Combine them into the full service name, e.g. "GreenStack_worker-service-1"
SERVICE_NAME="${STACK_NAME}_${SERVICE_SHORT_NAME}"

# ECR Repository and version.

# We'll get the image tag from the CodePipeline artifact
# IMAGE_TAG=$1   # Accept the image tag as a parameter
IMAGE_TAG=$(cat /home/ec2-user/codeDeploy/image_tag.txt || echo "")

if [ -z "$IMAGE_TAG" ]; then
  echo "Error: IMAGE_TAG is required"
  exit 1
fi

# Adjust these to match your image repository in ECR.
REPO_NAME="manu/worker-services"
# REPO_VERSION="latest"


# Construct the full ECR image reference
# IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:${REPO_VERSION}"
IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

# 1) Log in to ECR (on the Swarm Manager node)
echo "Logging into ECR..."
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS \
    --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# 2) Update the Docker service with --with-registry-auth
#    This pushes your local credentials to each node in the Swarm.
echo "Updating service $SERVICE_NAME to use image $IMAGE..."
docker service update \
  --with-registry-auth \
  --image "$IMAGE" \
  "$SERVICE_NAME"

echo "Service '$SERVICE_NAME' updated successfully!"
