# Use the latest Node.js image
FROM node:latest


# Set the working directory for the worker service
WORKDIR /usr/src/worker-services-1

# Copy package.json and package-lock.json for the worker service
COPY package*.json ./

# Install dependencies for the worker service
RUN npm install

# Copy the rest of the worker service code
COPY . .

# Build the worker service (if using TypeScript)
RUN npm run build

# Set the default command to run the supervisor script directly
CMD ["node", "./supervisorV2/supervisor.js"]
