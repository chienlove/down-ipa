import { createWriteStream, readFileSync, promises as fsPromises } from 'fs';
import JSZip from 'jszip';
import plist from 'plist';
import path from 'path';

export async function readZip(path) {
    const content = readFileSync(path);
    const z = await JSZip.loadAsync(content);
    return z;
}

export class SignatureClient {
    constructor(songList0, email) {
        this.archive = new JSZip();
        this.filename = '';
        this.metadata = { ...songList0.metadata, 'apple-id': email, userName: email, 'appleId': email };
        this.signature = songList0.sinfs.find(sinf => sinf.id === 0);
        if (!this.signature) throw new Error('Invalid signature.');
        this.email = email;
    }

    async loadFile(path) {
        this.archive = await readZip(path);
        this.filename = path;
    }

    appendMetadata() {
        const metadataPlist = plist.build(this.metadata);
        this.archive.file('iTunesMetadata.plist', Buffer.from(metadataPlist, 'utf8'));
        return this;
    }

    async appendSignature() {
        const manifestFile = this.archive.file(/\.app\/SC_Info\/Manifest\.plist$/)[0];
        if (!manifestFile) throw new Error('Invalid app bundle.');

        const manifestContent = await manifestFile.async('string');
        const manifest = plist.parse(manifestContent || '<plist></plist>');

        const sinfPath = manifest.SinfPaths?.[0];
        if (!sinfPath) throw new Error('Invalid signature.');

        const appBundleName = manifestFile.name.split('/')[1].replace(/\.app$/, '');
        const signatureTargetPath = `Payload/${appBundleName}.app/${sinfPath}`;

        this.archive.file(signatureTargetPath, Buffer.from(this.signature.sinf, 'base64'));
        return this;
    }

    // ✅ Ghi nội dung zip ra thư mục tạm để dùng archiver nén lại
    async extractToDirectory(outputDir) {
        await fsPromises.mkdir(outputDir, { recursive: true });
        const entries = Object.entries(this.archive.files);

        for (const [filePath, file] of entries) {
            const fullPath = path.join(outputDir, filePath);
            if (file.dir) {
                await fsPromises.mkdir(fullPath, { recursive: true });
            } else {
                const content = await file.async('nodebuffer');
                await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
                await fsPromises.writeFile(fullPath, content);
            }
        }
    }
}