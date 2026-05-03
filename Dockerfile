# Use Node.js 20 as base image
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy backend package files first for caching
COPY backend/package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the backend code
COPY backend/ .

# Set environment to production
ENV NODE_ENV=production

# Hugging Face Spaces specifically looks for port 7860
ENV PORT=7860
EXPOSE 7860

# Start the application
CMD ["node", "src/index.js"]
