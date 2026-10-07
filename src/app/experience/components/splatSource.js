export const SPLAT_SRC = "/splats/herb-scan-clean.splat";

let request = null;

export function requestSplat() {
  if (!request) {
    request = fetch(SPLAT_SRC)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => URL.createObjectURL(blob))
      .catch((error) => {
        request = null;
        throw error;
      });
  }
  return request;
}
