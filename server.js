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
  // Intercept POST requests to extract filename and rename after upload
  if (req.method === 'POST') {
    const originalEnd = res.end;
    res.end = function(data) {
      // After the upload is created, rename the file
      if (res.statusCode === 201) {
        const location = res.getHeader('Location');
        if (location) {
          const uploadId = location.split('/').pop();
          console.log('Upload created with ID:', uploadId);
          
          // Extract filename from metadata
          if (req.headers['upload-metadata']) {
            const metadata = req.headers['upload-metadata'];
            console.log('TUS metadata:', metadata);
            
            const parts = metadata.split(',');
            for (const part of parts) {
              const trimmedPart = part.trim();
              if (trimmedPart.startsWith('filename ') || trimmedPart.startsWith('name ')) {
                const fieldName = trimmedPart.startsWith('filename ') ? 'filename ' : 'name ';
                const encodedFilename = trimmedPart.substring(fieldName.length);
                try {
                  const originalName = Buffer.from(encodedFilename, 'base64').toString();
                  console.log('Extracted filename:', originalName);
                  
                  // Clean the filename for filesystem safety
                  const cleanName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
                  
                  // Rename the file after a short delay
                  setTimeout(() => {
                    try {
                      const oldPath = path.join(uploadDir, uploadId);
                      const newPath = path.join(uploadDir, cleanName);
                      
                      if (fs.existsSync(oldPath)) {
                        fs.renameSync(oldPath, newPath);
                        console.log(`✅ Renamed ${uploadId} to ${cleanName}`);
                        
                        // Also rename the metadata file
                        const oldMetadataPath = path.join(uploadDir, uploadId + '.json');
                        const newMetadataPath = path.join(uploadDir, cleanName + '.json');
                        if (fs.existsSync(oldMetadataPath)) {
                          fs.renameSync(oldMetadataPath, newMetadataPath);
                          console.log(`✅ Renamed metadata ${uploadId}.json to ${cleanName}.json`);
                        }
                      } else {
                        console.log(`❌ File ${oldPath} does not exist for renaming`);
                      }
                    } catch (error) {
                      console.log('❌ Error during rename:', error.message);
                    }
                  }, 500); // Increased delay to ensure file is written
                  
                  break;
                } catch (e) {
                  console.log('❌ Failed to decode filename:', e.message);
                }
              }
            }
          } else {
            console.log('❌ No upload-metadata header found');
          }
        } else {
          console.log('❌ No Location header found in response');
        }
      } else {
        console.log('❌ Response status not 201:', res.statusCode);
      }
      originalEnd.call(this, data);
    };
  }
  
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
    
    // Filter out TUS metadata files and chunks, only count actual uploaded files
    const actualFiles = files.filter(file => {
      // Exclude .json files (TUS metadata)
      if (file.endsWith('.json')) return false;
      // Exclude chunk files
      if (file.includes('.chunk')) return false;
      // Exclude temporary files
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
    
    // Get TUS metadata info for display
    const tusFiles = files.filter(file => file.endsWith('.json'));
    const chunkFiles = files.filter(file => file.includes('.chunk'));
    
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
      // Delete the main file
      await fs.remove(filePath);
      console.log('Deleted file:', filename);
      
      // Delete the associated metadata file (same name + .json)
      const metadataFile = filename + '.json';
      const metadataPath = path.join(uploadDir, metadataFile);
      if (await fs.pathExists(metadataPath)) {
        await fs.remove(metadataPath);
        console.log('Deleted metadata file:', metadataFile);
      }
      
      // Try to delete any chunk files associated with this upload
      const files = await fs.readdir(uploadDir);
      const chunkFiles = files.filter(file => 
        file.includes('.chunk') && file.includes(filename.replace(/\.[^/.]+$/, ''))
      );
      
      for (const chunkFile of chunkFiles) {
        const chunkPath = path.join(uploadDir, chunkFile);
        await fs.remove(chunkPath);
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
app.delete('/api/uploads/delete-all', async (req, res) => {
  try {
    const files = await fs.readdir(uploadDir);
    
    // Filter out TUS metadata files and chunks, only delete actual uploaded files
    const actualFiles = files.filter(file => {
      if (file.endsWith('.json')) return false;
      if (file.includes('.chunk')) return false;
      if (file.startsWith('.tmp') || file.startsWith('.temp')) return false;
      return true;
    });
    
    let deletedCount = 0;
    let deletedMetadata = 0;
    
    for (const file of actualFiles) {
      const filePath = path.join(uploadDir, file);
      await fs.remove(filePath);
      console.log('Deleted file:', file);
      
      // Delete the associated metadata file (same name + .json)
      const metadataFile = file + '.json';
      const metadataPath = path.join(uploadDir, metadataFile);
      if (await fs.pathExists(metadataPath)) {
        await fs.remove(metadataPath);
        deletedMetadata++;
        console.log('Deleted metadata file:', metadataFile);
      }
      
      deletedCount++;
    }
    
    res.json({ 
      message: 'All files deleted successfully',
      deletedFiles: deletedCount,
      deletedMetadata: deletedMetadata
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename uploaded file
app.put('/api/uploads/:filename/rename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const { newName } = req.body;
    
    if (!newName || newName.trim() === '') {
      return res.status(400).json({ error: 'New name is required' });
    }
    
    // Clean the new filename
    const cleanNewName = newName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    const oldFilePath = path.join(uploadDir, filename);
    const newFilePath = path.join(uploadDir, cleanNewName);
    
    if (!(await fs.pathExists(oldFilePath))) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    if (await fs.pathExists(newFilePath)) {
      return res.status(409).json({ error: 'A file with that name already exists' });
    }
    
    // Rename the main file
    await fs.move(oldFilePath, newFilePath);
    console.log(`Renamed file: ${filename} → ${cleanNewName}`);
    
    // Also rename associated TUS metadata file
    const oldMetadataFile = filename + '.json';
    const newMetadataFile = cleanNewName + '.json';
    const oldMetadataPath = path.join(uploadDir, oldMetadataFile);
    const newMetadataPath = path.join(uploadDir, newMetadataFile);
    
    if (await fs.pathExists(oldMetadataPath)) {
      await fs.move(oldMetadataPath, newMetadataPath);
      console.log(`Renamed metadata: ${oldMetadataFile} → ${newMetadataFile}`);
      
      // Update the metadata file content to reflect the new filename
      try {
        const metadataContent = await fs.readJson(newMetadataPath);
        metadataContent.metadata.filename = cleanNewName;
        metadataContent.metadata.name = cleanNewName;
        await fs.writeJson(newMetadataPath, metadataContent, { spaces: 2 });
        console.log('Updated metadata content with new filename');
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
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Upload directory: ${uploadDir}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 Upload stats: http://localhost:${PORT}/api/uploads`);
});

// Handle server errors gracefully
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`❌ Port ${PORT} is already in use. Please stop the existing server first.`);
    process.exit(1);
  } else {
    console.log('❌ Server error:', error.message);
    process.exit(1);
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  server.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
}); 