FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --only=production --no-optional


COPY . .

# Create non-root user (opsional tapi aman)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

USER nextjs

# Expose port
EXPOSE 4000

# Start app
CMD ["node", "server.js"]
