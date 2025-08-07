# Uppy TUS File Upload Server

A Node.js Express server with Uppy frontend for handling large file uploads (up to 20GB) using the TUS protocol for resumable uploads.

## Features

- 🚀 **Large File Support**: Upload files up to 20GB
- 🔄 **Resumable Uploads**: TUS protocol allows resuming interrupted uploads
- 🎯 **Drag & Drop Interface**: Modern Uppy frontend with drag & drop
- 📊 **Upload Statistics**: Real-time stats and file management
- 🛡️ **Chunked Uploads**: 6MB chunks for reliable large file transfers
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 🗑️ **File Management**: View and delete uploaded files

## Prerequisites

- Node.js 16+ 
- npm or yarn

## Installation

1. Clone or download this project
2. Install dependencies:

```bash
npm install
```

## Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

- `GET /` - Main upload interface
- `GET /health` - Health check endpoint
- `GET /api/uploads` - Get upload statistics and file list
- `DELETE /api/uploads/:filename` - Delete a specific file
- `POST /files/*` - TUS upload endpoint (handled by tus-node-server)

## Configuration

### File Upload Settings

- **Max File Size**: 20GB (configurable in `server.js`)
- **Chunk Size**: 6MB (configurable in `public/index.html`)
- **Upload Directory**: `./uploads/` (created automatically)

### TUS Server Configuration

The TUS server is configured with:
- Resumable uploads
- Unique filename generation
- Progress tracking
- Error handling

## File Structure

```
UppyTus/
├── server.js          # Express server with TUS integration
├── package.json       # Dependencies and scripts
├── public/
│   └── index.html     # Uppy frontend interface
├── uploads/           # Uploaded files directory (created automatically)
└── README.md          # This file
```

## How It Works

1. **Frontend**: Uppy provides a modern drag & drop interface
2. **TUS Protocol**: Handles chunked uploads with resume capability
3. **Backend**: Express server with tus-node-server for TUS protocol handling
4. **Storage**: Files are saved to the local `uploads/` directory

## Features in Detail

### Resumable Uploads
- If an upload is interrupted, it can be resumed from where it left off
- TUS protocol handles the chunking and reassembly automatically

### Progress Tracking
- Real-time upload progress with percentage and speed
- Visual progress bars and status indicators

### File Management
- View all uploaded files with size and date information
- Delete files directly from the web interface
- Statistics dashboard with total files and storage usage

### Error Handling
- Network error recovery
- File size validation
- Upload retry mechanisms

## Customization

### Changing Upload Limits

Edit `server.js`:
```javascript
maxFileSize: 20 * 1024 * 1024 * 1024, // Change 20GB limit
```

Edit `public/index.html`:
```javascript
maxFileSize: 20 * 1024 * 1024 * 1024, // Change 20GB limit
chunkSize: 6 * 1024 * 1024, // Change 6MB chunk size
```

### Changing Upload Directory

Edit `server.js`:
```javascript
const uploadDir = path.join(__dirname, 'uploads'); // Change directory
```

## Troubleshooting

### Common Issues

1. **Port already in use**: Change the PORT environment variable
   ```bash
   PORT=3001 npm start
   ```

2. **Permission denied**: Ensure write permissions for the uploads directory
   ```bash
   chmod 755 uploads/
   ```

3. **Large file uploads failing**: Check available disk space
   ```bash
   df -h
   ```

### Logs

The server provides console output for:
- Server startup information
- Upload progress
- Error messages
- File operations

## Security Considerations

- Files are stored locally on the server
- No authentication is implemented (add your own if needed)
- Consider implementing file type restrictions for production use
- Add rate limiting for production deployments

## Production Deployment

For production use, consider:

1. **Authentication**: Add user authentication
2. **Rate Limiting**: Implement upload rate limits
3. **File Validation**: Add file type and content validation
4. **Storage**: Use cloud storage (AWS S3, Google Cloud Storage, etc.)
5. **Load Balancing**: For high-traffic scenarios
6. **Monitoring**: Add logging and monitoring
7. **HTTPS**: Use SSL/TLS encryption

## License

MIT License - feel free to use and modify as needed. 