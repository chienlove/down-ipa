import fs from 'fs';
import path from 'path';
import plist from 'plist';
import unzipper from 'unzipper';

export class SignatureClient {
  constructor(songList0, email) {
    this.metadata = { ...songList0.metadata, 'apple-id': email, userName: email, 'appleId': email };
    this.signature = songList0.sinfs.find(sinf => sinf.id === 0);
    if (!this.signature) throw new Error('Invalid signature.');
    this.email = email;
  }

  async extractIPA(ipaPath, outputDir) {
    await fs.promises.mkdir(outputDir, { recursive: true });
    await fs.createReadStream(ipaPath).pipe(unzipper.Extract({ path: outputDir })).promise();
  }

  async patchMetadata(extractedPath) {
    const metadataPath = path.join(extractedPath, 'iTunesMetadata.plist');
    const metadataContent = plist.build(this.metadata);
    await fs.promises.writeFile(metadataPath, metadataContent, 'utf8');
  }

  async patchSignature(extractedPath) {
    const payloadPath = path.join(extractedPath, 'Payload');
    const appFolders = await fs.promises.readdir(payloadPath);
    const appPath = path.join(payloadPath, appFolders.find(name => name.endsWith('.app')));

    const manifestPath = path.join(appPath, 'SC_Info', 'Manifest.plist');
    const manifestRaw = await fs.promises.readFile(manifestPath, 'utf8');
    const manifest = plist.parse(manifestRaw);

    const sinfRelPath = manifest.SinfPaths?.[0];
    if (!sinfRelPath) throw new Error('Sinf path not found in manifest');

    const sinfFullPath = path.join(appPath, sinfRelPath);
    const sinfBuffer = Buffer.from(this.signature.sinf, 'base64');
    await fs.promises.writeFile(sinfFullPath, sinfBuffer);
  }

  async processIPA(ipaPath, extractedPath) {
    await this.extractIPA(ipaPath, extractedPath);
    await this.patchMetadata(extractedPath);
    await this.patchSignature(extractedPath);
  }
}