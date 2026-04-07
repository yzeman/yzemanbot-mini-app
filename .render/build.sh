#!/bin/bash
# Exit on error
set -o errexit

# Install dependencies
npm install

# Create public directory if it doesn't exist
mkdir -p public

echo "Build completed successfully"
