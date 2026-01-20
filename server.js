
const { createServer } = require('http');
const { parse } = require('url');

const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);
const workerMode = process.env.WORKER_MODE === 'true';
const workerId = process.env.WORKER_ID || 'unknown';

const NextServer = require('next/dist/server/next-server').default;
const path = require('path');

async function start() {
  

  const nextServer = new NextServer({
    hostname,
    port,
    dir: path.join(__dirname),
    dev: false,
    conf: {
      ...require('./next.config.js'),
      distDir: './.next',
    },
  });

  const requestHandler = nextServer.getRequestHandler();

  await nextServer.prepare();

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await requestHandler(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  server.once('error', (err) => {
    console.error(err);
    process.exit(1);
  });

  server.listen(port, hostname, () => {
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  })
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      

      if (workerMode) {
        initializeWorker();
      }
    });
});

async function initializeWorker() {
  
  try {
    const response = await fetch(`http://localhost:${port}/api/worker`, {
      method: 'POST',
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✓ Worker node started:', data);
    } else {
      console.error('✗ Failed to start worker node');
    }
  } catch (error) {
    console.error('✗ Worker initialization error:', error);
  }
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing server');
  
  if (workerMode) {
    console.log('Closing worker queues...');
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT signal received: closing server');
  process.exit(0);
});
