FROM node:18-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    git \
    curl \
    docker-cli \
    jq

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy agent code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Default health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

CMD ["node", "webhook-receiver.js"]
