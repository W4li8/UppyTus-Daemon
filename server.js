const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const { Server, EVENTS } = require('@tus/server');
const { FileStore } = require('@tus/file-store');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const uploadDir = path.join(__dirname, 'uploads');
fs.ensureDirSync(uploadDir);

const tusServer = new Server({
  path: '/files',
  datastore: new FileStore({ directory: uploadDir }),
  maxFileSize: 32 * 1024 * 1024 * 1024,
  allowedMethods: ['POST', 'HEAD', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Authorization', 'Content-Type', 'Upload-Length', 'Upload-Metadata',
    'Upload-Offset', 'Tus-Resumable', 'Upload-Concat'
  ],
  exposedHeaders: [
    'Upload-Offset', 'Location', 'Upload-Length', 'Tus-Version',
    'Tus-Resumable', 'Tus-Max-Size', 'Tus-Extension', 'Upload-Metadata'
  ]
});

// ✅ Only rename AFTER the upload is fully complete
tusServer.on(EVENTS.POST_FINISH, async (req, res, upload) => {
  try {
    const uploadId = upload.id;
    console.log(`✅ Upload complete for ID: ${uploadId}`);

    // Extract filename from metadata
    if (upload.metadata && upload.metadata.filename) {
      const originalName = upload.metadata.filename //Buffer.from(upload.metadata.filename, 'base64').toString();
      console.log(`Original filename from metadata: ${originalName}`);

      const cleanName = originalName //.replace(/[\/:*?"<>|]/g, '_');
      const oldPath = path.join(uploadDir, uploadId);
      const newPath = path.join(uploadDir, cleanName);

      if (await fs.pathExists(oldPath)) {
        await fs.rename(oldPath, newPath);
        console.log(`✅ Renamed ${uploadId} to ${cleanName}`);

        // Rename metadata file too
        const oldMeta = path.join(uploadDir, uploadId + '.json');
        const newMeta = path.join(uploadDir, cleanName + '.json');
        if (await fs.pathExists(oldMeta)) {
          await fs.rename(oldMeta, newMeta);
          console.log(`✅ Renamed metadata to ${cleanName}.json`);
        }
      } else {
        console.log(`⚠️ File not found for ID ${uploadId} during rename`);
      }
    } else {
      console.log(`⚠️ No filename metadata found for ID ${uploadId}`);
    }
  } catch (err) {
    console.error(`❌ Error in onUploadFinish rename: ${err.message}`);
  }
});

// Mount TUS server
app.all(['/files', '/files/*'], (req, res) => {
  tusServer.handle(req, res);
});

// ===== Your existing API routes stay the same =====

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
    const actualFiles = files.filter(file => {
      if (file.endsWith('.json')) return false;
      if (file.includes('.chunk')) return false;
      if (file.startsWith('.tmp') || file.startsWith('.temp')) return false;
      return true;
    });

    const stats = await Promise.all(
      actualFiles.map(async (file) => {
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
      lastUpdate: stats.length > 0 ? Math.max(...stats.map(f => new Date(f.modified).getTime())) : null,
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
      console.log('Deleted file:', filename);

      const metadataFile = filename + '.json';
      const metadataPath = path.join(uploadDir, metadataFile);
      if (await fs.pathExists(metadataPath)) {
        await fs.remove(metadataPath);
        console.log('Deleted metadata file:', metadataFile);
      }

      const files = await fs.readdir(uploadDir);
      const chunkFiles = files.filter(file =>
        file.includes('.chunk') && file.includes(filename.replace(/\.[^/.]+$/, ''))
      );
      for (const chunkFile of chunkFiles) {
        await fs.remove(path.join(uploadDir, chunkFile));
        console.log('Deleted chunk file:', chunkFile);
      }

      res.json({
        message: 'File deleted successfully',
        deletedMetadata: 1,
        deletedChunks: chunkFiles.length
      });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete all uploaded files
app.delete('/api/manage/delete-all', async (req, res) => {
  try {
    await fs.remove(uploadDir);
    await fs.ensureDir(uploadDir);
    res.json({ message: 'All files deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename uploaded file (manual API call)
app.put('/api/uploads/:filename/rename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const { newName } = req.body;

    if (!newName || newName.trim() === '') {
      return res.status(400).json({ error: 'New name is required' });
    }

    const cleanNewName = newName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const oldFilePath = path.join(uploadDir, filename);
    const newFilePath = path.join(uploadDir, cleanNewName);

    if (!(await fs.pathExists(oldFilePath))) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (await fs.pathExists(newFilePath)) {
      return res.status(409).json({ error: 'A file with that name already exists' });
    }

    await fs.move(oldFilePath, newFilePath);
    console.log(`Renamed file: ${filename} → ${cleanNewName}`);

    const oldMetadataFile = filename + '.json';
    const newMetadataFile = cleanNewName + '.json';
    const oldMetadataPath = path.join(uploadDir, oldMetadataFile);
    const newMetadataPath = path.join(uploadDir, newMetadataFile);

    if (await fs.pathExists(oldMetadataPath)) {
      await fs.move(oldMetadataPath, newMetadataPath);
      try {
        const metadataContent = await fs.readJson(newMetadataPath);
        metadataContent.metadata.filename = cleanNewName;
        metadataContent.metadata.name = cleanNewName;
        await fs.writeJson(newMetadataPath, metadataContent, { spaces: 2 });
      } catch (e) {
        console.log('Could not update metadata file:', e.message);
      }
    }

    res.json({
      message: 'File renamed successfully',
      oldName: filename,
      newName: cleanNewName
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Upload directory: ${uploadDir}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 Upload stats: http://localhost:${PORT}/api/uploads`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`❌ Port ${PORT} is already in use.`);
    process.exit(1);
  } else {
    console.log('❌ Server error:', error.message);
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  server.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
});
