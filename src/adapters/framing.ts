/** Byte bounded JSON Lines framing. Oversize lines are discarded through the delimiter. */
export class JsonLines {
  private bytes: number[] = [];
  private discard = false;
  constructor(
    private record: (value: unknown) => void,
    private error: (code: string) => void,
    private limit = 32768,
  ) {}
  push(chunk: Uint8Array) {
    for (const b of chunk) {
      if (b === 10) {
        if (!this.discard && this.bytes.length) {
          try {
            this.record(
              JSON.parse(
                new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(this.bytes)),
              ),
            );
          } catch {
            this.error('invalid_json');
          }
        }
        this.bytes = [];
        this.discard = false;
      } else if (!this.discard) {
        if (this.bytes.length >= this.limit) {
          this.bytes = [];
          this.discard = true;
          this.error('record_too_large');
        } else this.bytes.push(b);
      }
    }
  }
  end() {
    if (this.bytes.length && !this.discard) this.error('incomplete_eof');
    this.bytes = [];
    this.discard = false;
  }
}
