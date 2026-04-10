#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3006;
const MUSIC_DIR = process.env.VOLTA_MUSIC_DIR || path.join(process.env.HOME || '/home/volta', 'Music');

const MIME_TYPES = {
 '.html': 'text/html',
 '.css': 'text/css',
 '.js': 'application/javascript',
 '.json': 'application/json',
 '.mp3': 'audio/mpeg',
 '.flac': 'audio/flac',
 '.ogg': 'audio/ogg',
 '.wav': 'audio/wav',
 '.m4a': 'audio/mp4',
 '.aac': 'audio/aac',
 '.webm': 'audio/webm',
 '.png': 'image/png',
 '.jpg': 'image/jpeg',
 '.svg': 'image/svg+xml',
 '.lrc': 'text/plain'
};

const server = http.createServer((req, res) => {
 // CORS headers
 res.setHeader('Access-Control-Allow-Origin', '*');
 res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
 res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
 if (req.method === 'OPTIONS') {
 res.writeHead(204);
 res.end();
 return;
 }

 const url = new URL(req.url, `http://localhost:${PORT}`);
 
 // API: List music files
 if (url.pathname === '/api/tracks') {
 listTracks(req, res);
 return;
 }
 
 // API: Serve audio file
 if (url.pathname.startsWith('/api/audio/')) {
 serveAudio(req, res, url.pathname.replace('/api/audio/', ''));
 return;
 }
 
 // API: Fetch lyrics from LRCLIB
 if (url.pathname === '/api/lyrics') {
 fetchLyrics(req, res, url.searchParams);
 return;
 }
 
 // Serve static files
 serveStatic(req, res);
});

function listTracks(req, res) {
 const tracks = [];
 
 function scanDir(dir, depth = 0) {
 if (depth > 5) return; // Limit recursion depth
 try {
 const entries = fs.readdirSync(dir, { withFileTypes: true });
 for (const entry of entries) {
 if (entry.name.startsWith('.')) continue;
 
 const fullPath = path.join(dir, entry.name);
 
 if (entry.isDirectory()) {
 scanDir(fullPath, depth + 1);
 } else if (entry.isFile()) {
 const ext = path.extname(entry.name).toLowerCase();
 if (['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.webm'].includes(ext)) {
 const stem = path.basename(entry.name, ext);
 let artist = 'Unknown';
 let title = stem;
 
 if (stem.includes(' - ')) {
 const parts = stem.split(' - ');
 artist = parts[0].trim();
 title = parts.slice(1).join(' - ').trim();
 }
 
 tracks.push({
 path: fullPath,
 name: entry.name,
 artist,
 title,
 ext
 });
 }
 }
 }
 } catch (e) {
 // Skip directories we can't read
 }
 }
 
 scanDir(MUSIC_DIR);
 
 // Sort by artist then title
 tracks.sort((a, b) => {
 const aa = a.artist.toLowerCase();
 const ab = b.artist.toLowerCase();
 if (aa !== ab) return aa.localeCompare(ab);
 return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
 });
 
 res.writeHead(200, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ tracks, musicDir: MUSIC_DIR }));
}

function serveAudio(req, res, encodedPath) {
 const filePath = decodeURIComponent(encodedPath);
 const ext = path.extname(filePath).toLowerCase();
 const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
 
 try {
 const stat = fs.statSync(filePath);
 const range = req.headers.range;
 
 if (range) {
 const parts = range.replace(/bytes=/, '').split('-');
 const start = parseInt(parts[0], 10);
 const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
 const chunkSize = end - start + 1;
 
 res.writeHead(206, {
 'Content-Range': `bytes ${start}-${end}/${stat.size}`,
 'Accept-Ranges': 'bytes',
 'Content-Length': chunkSize,
 'Content-Type': mimeType
 });
 
 fs.createReadStream(filePath, { start, end }).pipe(res);
 } else {
 res.writeHead(200, {
 'Content-Length': stat.size,
 'Content-Type': mimeType
 });
 fs.createReadStream(filePath).pipe(res);
 }
 } catch (e) {
 res.writeHead(404);
 res.end('Not found');
 }
}

function fetchLyrics(req, res, params) {
 const artist = params.get('artist');
 const title = params.get('title');
 
 if (!artist || !title) {
 res.writeHead(400, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ error: 'Missing artist or title' }));
 return;
 }
 
 const https = require('https');
 const url = `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
 
 https.get(url, { timeout: 5000 }, (apiRes) => {
 let data = '';
 apiRes.on('data', chunk => data += chunk);
 apiRes.on('end', () => {
 try {
 const results = JSON.parse(data);
 const syncedLyrics = results.find(r => r.syncedLyrics)?.syncedLyrics || 
 results[0]?.plainLyrics || null;
 res.writeHead(200, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ lyrics: syncedLyrics }));
 } catch (e) {
 res.writeHead(200, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ lyrics: null }));
 }
 });
 }).on('error', () => {
 res.writeHead(200, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ lyrics: null }));
 });
}

function serveStatic(req, res) {
 let filePath = req.url === '/' ? '/index.html' : req.url;
 filePath = path.join(__dirname, 'public', filePath);
 
 // Security: prevent directory traversal
 if (!filePath.startsWith(path.join(__dirname, 'public'))) {
 res.writeHead(403);
 res.end('Forbidden');
 return;
 }
 
 const ext = path.extname(filePath).toLowerCase();
 const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
 
 try {
 const content = fs.readFileSync(filePath);
 res.writeHead(200, { 'Content-Type': mimeType });
 res.end(content);
 } catch (e) {
 res.writeHead(404);
 res.end('Not found');
 }
}

server.listen(PORT, () => {
 console.log(`volta-wave-gui running at http://localhost:${PORT}`);
 console.log(`Music directory: ${MUSIC_DIR}`);
});
