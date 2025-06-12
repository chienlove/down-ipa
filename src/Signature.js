import { Transform } from 'stream';
import JSZip from 'jszip';
import plist from 'plist';

export class SignatureTransform extends Transform {
  constructor(songList0, email) {
    super({
      highWaterMark: 5 * 1024 * 1024 // 5MB buffer
    });
    this.signature = songList0.sinfs.find(sinf => sinf.id === 0);
    if (!this.signature) throw new Error('Invalid signature.');
    
    this.metadata = { 
      ...songList0.metadata, 
      'apple-id': email, 
      userName: email, 
      'appleId': email 
    };
    
    this.chunks = [];
  }

  _transform(chunk, encoding, callback) {
    this.chunks.push(chunk);
    if (this.chunks.length > 10) { // ~50MB in memory max
      this.push(Buffer.concat(this.chunks));
      this.chunks = [];
    }
    callback();
  }

  async _flush(callback) {
    try {
      if (this.chunks.length === 0) {
        return callback(new Error('No data received'));
      }

      const buffer = Buffer.concat(this.chunks);
      const zip = await JSZip.loadAsync(buffer);
      
      // Add metadata
      const metadataPlist = plist.build(this.metadata);
      zip.file('iTunesMetadata.plist', Buffer.from(metadataPlist, 'utf8'));
      
      // Process manifest
      const manifestFile = zip.file(/\.app\/SC_Info\/Manifest\.plist$/)[0];
      if (!manifestFile) throw new Error('Manifest.plist not found');
      
      const manifestContent = await manifestFile.async('string');
      const manifest = plist.parse(manifestContent);
      const sinfPath = manifest.SinfPaths?.[0];
      if (!sinfPath) throw new Error('SinfPath not found in manifest');
      
      const appBundleName = manifestFile.name.split('/')[1].replace(/\.app$/, '');
      const signatureTargetPath = `Payload/${appBundleName}.app/${sinfPath}`;
      zip.file(signatureTargetPath, Buffer.from(this.signature.sinf, 'base64'));
      
      // Generate new IPA
      const newBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });
      
      this.push(newBuffer);
      callback();
    } catch (err) {
      callback(err);
    } finally {
      this.chunks = null; // Free memory
    }
  }

  _destroy(err, callback) {
    this.chunks = null;
    callback(err);
  }
}