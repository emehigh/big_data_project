
WORKER_MODE=${WORKER_MODE:-false}
WORKER_ID=${WORKER_ID:-unknown}
PARTITIONS=${PARTITIONS:-none}

if [ "$WORKER_MODE" = "true" ]; then
  echo "Worker ID:  $WORKER_ID"
  echo "Partitions: $PARTITIONS"
  echo ""
  echo "Initializing worker..."
  # Give services time to start
  sleep 5
  # Initialize worker by calling the API
  curl -X POST http://localhost:3000/api/worker || true
else
  echo "Web UI:    http://localhost:${PORT:-3000}"
  echo "API:       http://localhost:${PORT:-3000}/api"
fi

echo ""
echo "Ready!"
echo ""

# Start Next.js standalone server
exec node server.js
