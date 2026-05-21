const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3006;
const FLASK_API = 'http://127.0.0.1:5050';

const MIME = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

// Proxy helper — forwards to Flask backend at :5050
function proxyToFlask(req, res, flaskPath) {
    const options = {
        hostname: '127.0.0.1', port: 5050,
        path: flaskPath, method: req.method,
        headers: { 'Content-Type': 'application/json' }
    };
    const proxy = http.request(options, (flaskRes) => {
        res.writeHead(flaskRes.statusCode, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        flaskRes.pipe(res);
    });
    proxy.on('error', () => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'SaaS API offline', status: 'degraded' }));
    });
    req.pipe(proxy);
}

const server = http.createServer((req, res) => {
    // ── API proxy routes ──────────────────────────────────────
    if (req.url === '/api/status' || req.url === '/api/health') {
        return proxyToFlask(req, res, '/health');
    }
    if (req.url === '/api/swarms') {
        return proxyToFlask(req, res, '/v1/swarms');
    }
    if (req.url === '/api/deploy' && req.method === 'POST') {
        return proxyToFlask(req, res, '/v1/swarms/deploy');
    }

    // ── Static file handler ───────────────────────────────────
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            fs.readFile(path.join(__dirname, 'index.html'), (err2, data2) => {
                if (err2) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data2);
            });
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`MoltBot VM SaaS :${PORT} — Flask API proxy → ${FLASK_API}`);
});
