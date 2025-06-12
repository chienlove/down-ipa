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
    
    this.chunks = [];
  }

  _transform(chunk, encoding, callback) {
    this.chunks.push(chunk);
    callback();
  }

  async _flush(callback) {
    try {
      const buffer = Buffer.concat(this.chunks);
      const zip = await JSZip.loadAsync(buffer);
      
      // Thêm metadata
      const metadataPlist = plist.build(this.metadata);
      zip.file('iTunesMetadata.plist', Buffer.from(metadataPlist, 'utf8'));
      
      // Tìm và thêm signature
      const manifestFile = zip.file(/\.app\/SC_Info\/Manifest\.plist$/)[0];
      if (!manifestFile) throw new Error('Invalid app bundle.');
      
      const manifestContent = await manifestFile.async('string');
      const manifest = plist.parse(manifestContent);
      const sinfPath = manifest.SinfPaths?.[0];
      if (!sinfPath) throw new Error('Invalid signature.');
      
      const appBundleName = manifestFile.name.split('/')[1].replace(/\.app$/, '');
      const signatureTargetPath = `Payload/${appBundleName}.app/${sinfPath}`;
      zip.file(signatureTargetPath, Buffer.from(this.signature.sinf, 'base64'));
      
      // Generate lại file zip
      const newBuffer = await zip.generateAsync({ 
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });
      
      this.push(newBuffer);
      callback();
    } catch (err) {
      callback(err);
    }
  }
}