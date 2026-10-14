#!/bin/bash
echo "Running Type Check..."
npx tsc --noEmit

echo "Running Linter..."
npx eslint "src/**/*.ts"