import { Readable } from 'stream';

export class ImageStream extends Readable {
  private image: Buffer | null = null;
  private hasData = false;

  public pushImage(image: Buffer | null) {
    this.image = image;
    this.hasData = true;
    this.readChunk();
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  public override _read() {
    this.readChunk();
  }

  private readChunk() {
    if (this.hasData) {
      this.hasData = false;
      this.push(this.image);
    }
  }
}
