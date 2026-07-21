# Use the official Node.js image as the base
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy the rest of the application code
COPY . .

# Build TypeScript code
RUN npm run build

# Expose the backend port
EXPOSE 4000

# Start the server using the compiled JS
CMD ["npm", "start"]
