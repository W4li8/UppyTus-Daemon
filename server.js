const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const { Server } = require('@tus/server');
const { FileStore } = require('@tus/file-store');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'uploads');
fs.ensureDirSync(uploadDir);

// TUS Server Configuration
const tusServer = new Server({
  path: '/files',
  datastore: new FileStore({
    directory: uploadDir,
  }),
  namingFunction: (req) => {
    // Generate unique filename based on timestamp and original name
    const timestamp = Date.now();
    const originalName = req.headers['upload-metadata'] 
      ? Buffer.from(req.headers['upload-metadata'].split('filename ')[1], 'base64').toString()
      : 'unknown';
    const extension = path.extname(originalName);
    const name = path.basename(originalName, extension);
    return `${name}_${timestamp}${extension}`;
  },
  maxFileSize: 20 * 1024 * 1024 * 1024, // 20GB limit
  allowedMethods: ['POST', 'HEAD', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Authorization',
    'Content-Type',
    'Upload-Length',
    'Upload-Metadata',
    'Upload-Offset',
    'Tus-Resumable',
    'Upload-Concat'
  ],
  exposedHeaders: [
    'Upload-Offset',
    'Location',
    'Upload-Length',
    'Tus-Version',
    'Tus-Resumable',
    'Tus-Max-Size',
    'Tus-Extension',
    'Upload-Metadata'
  ]
});

// Mount TUS server - handle both /files and /files/*
app.all(['/files', '/files/*'], (req, res) => {
  console.log('TUS request:', req.method, req.url);
  tusServer.handle(req, res);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uploadDir: uploadDir
  });
});

// Get upload statistics
app.get('/api/uploads', async (req, res) => {
  try {
    const files = await fs.readdir(uploadDir);
    const stats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(uploadDir, file);
        const stat = await fs.stat(filePath);
        return {
          name: file,
          size: stat.size,
          created: stat.birthtime,
          modified: stat.mtime
        };
      })
    );
    
    res.json({
      totalFiles: stats.length,
      totalSize: stats.reduce((sum, file) => sum + file.size, 0),
      files: stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete uploaded file
app.delete('/api/uploads/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadDir, filename);
    
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
      res.json({ message: 'File deleted successfully' });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Upload directory: ${uploadDir}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 Upload stats: http://localhost:${PORT}/api/uploads`);
}); 