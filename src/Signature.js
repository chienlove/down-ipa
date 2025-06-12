import { Transform } from 'stream';
import JSZip from 'jszip';
import plist from 'plist';

export class SignatureTransform extends Transform {
  constructor(songList0, email) {
    super();
    this.signature = songList0.sinfs.find(sinf => sinf.id === 0);
    if (!this.signature) throw new Error('Invalid signature.');
    
    this.metadata = { 
      ...songList0.metadata, 
      'apple-id': email, 
      userName: email, 
      'appleId': email 
    };
    
    this.buffer = Buffer.alloc(0);
    this.foundManifest = false;
    this.manifestContent = null;
    this.processed = false;
  }

  async _transform(chunk, encoding, callback) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      
      if (!this.foundManifest) {
        const manifestMatch = this.buffer.toString().match(/Payload\/[^\/]+\.app\/SC_Info\/Manifest\.plist/);
        if (manifestMatch) {
          this.foundManifest = true;
          const zip = await JSZip.loadAsync(this.buffer);
          const manifestFile = zip.file(/\.app\/SC_Info\/Manifest\.plist$/)[0];
          this.manifestContent = await manifestFile.async('string');
        }
      }
      
      if (this.foundManifest && !this.processed) {
        this.processed = true;
        const zip = await JSZip.loadAsync(this.buffer);
        
        // Thêm metadata
        const metadataPlist = plist.build(this.metadata);
        zip.file('iTunesMetadata.plist', Buffer.from(metadataPlist, 'utf8'));
        
        // Thêm signature
        const manifest = plist.parse(this.manifestContent);
        const sinfPath = manifest.SinfPaths?.[0];
        if (!sinfPath) throw new Error('Invalid signature.');
        
        const appBundleName = Object.keys(zip.files)
          .find(f => f.endsWith('.app/'))
          .split('/')[1]
          .replace(/\.app$/, '');
        
        const signatureTargetPath = `Payload/${appBundleName}.app/${sinfPath}`;
        zip.file(signatureTargetPath, Buffer.from(this.signature.sinf, 'base64'));
        
        // Generate lại file zip
        const newBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        this.push(newBuffer);
        callback();
      } else if (!this.processed) {
        callback();
      } else {
        this.push(chunk);
        callback();
      }
    } catch (err) {
      callback(err);
    }
  }

  _flush(callback) {
    if (this.buffer.length > 0) {
      this.push(this.buffer);
    }
    callback();
  }
}