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
RUN mkdir -p downloads && chmod 755 downloads

# Expose port
EXPOSE 8080

# Start the application using regular next start
CMD ["npm", "run", "start:regular"]