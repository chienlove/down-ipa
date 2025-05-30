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

# Copy ipatool binary and set permissions
COPY public/bin/ipatool /usr/local/bin/ipatool
RUN chmod +x /usr/local/bin/ipatool

# Build the application
RUN npm run build

# Create downloads directory
RUN mkdir -p /app/downloads && chmod 755 /app/downloads

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]