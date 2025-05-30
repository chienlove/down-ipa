FROM node:18-alpine

# Install required packages
RUN apk add --no-cache curl

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Copy ipatool binary and set permissions (do this before build)
COPY public/bin/ipatool /usr/local/bin/ipatool
RUN chmod +x /usr/local/bin/ipatool

# Build the application
RUN npm run build

# Create a clean standalone directory
RUN mkdir -p /app/standalone
RUN cp -r .next/standalone/* /app/standalone/

# Create .next directory and copy static files
RUN mkdir -p /app/standalone/.next
RUN if [ -d ".next/static" ]; then cp -r .next/static /app/standalone/.next/; fi

# Copy public directory if it exists in standalone
RUN if [ -d "public" ]; then cp -r public /app/standalone/; fi

# Set working directory to standalone
WORKDIR /app/standalone

# Create downloads directory
RUN mkdir -p downloads && chmod 755 downloads

# Expose port (Railway uses PORT env var)
EXPOSE ${PORT:-3000}

# Start the application
CMD ["node", "server.js"]