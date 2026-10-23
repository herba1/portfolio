// Errors that describe the audio rather than a failure: retrying or fetching
// the same song another way won't change them. `code` is one of "too-large",
// "too-short", "silent" or "no-notes".
export class ConvertError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConvertError";
    this.code = code;
  }
}
