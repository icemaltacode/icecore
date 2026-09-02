/* Turning whatever a student picked into something we are willing to store.
 *
 * Pure-ish and dependency-free, like compare.js and csv.js - it takes a File and gives back
 * bytes. It touches the DOM only in the sense that a canvas is the image decoder every
 * browser already has; nothing here reads or writes the page.
 *
 * THE POINT IS THAT WE NEVER STORE THE FILE THAT WAS CHOSEN. It is decoded, cropped square,
 * scaled to a fixed size and re-encoded, so the bytes that leave the machine are pixels the
 * browser drew. Three things follow, and the third is the one that decides it:
 *
 *   1. The size limit holds by construction rather than by a rule somebody has to check.
 *   2. No image processing on the server, and no Lambda decoding untrusted bytes.
 *   3. EXIF is discarded - which on a phone photo carries GPS coordinates - and a file
 *      crafted against a decoder does not survive being rasterised and re-encoded.
 *
 * The server still checks what arrives. This is the reason the check can be cheap, not a
 * reason to skip it: anybody can post to the endpoint without going through this file.
 */

/** The stored square. Big enough for a retina 32px chip and a 64px one later. */
export const SIZE = 256;

/**
 * The URL for a stored avatar, from whatever the API handed back.
 *
 * ONE DEFINITION, because there are two renderers - the top bar's chip and the account
 * page's portrait - and they must not disagree about what a key is. They already did: the
 * chip glued BASE_URL onto the front of a `data:` URL, which is what preview returns, so an
 * upload appeared on the account page and never in the corner.
 *
 * A deployment hands back a bucket key (`avatars/<sub>/<hash>.webp`) which is relative to
 * the site; preview hands back a `data:` URL, which is absolute and already complete. Test
 * for the absolute forms rather than for the relative one - a key has no distinguishing
 * shape, and "does not start with a scheme" is the only thing reliably true of it.
 */
export const avatarSrc = key => {
  if (!key) return '';
  return /^(data:|blob:|https?:)/i.test(key) ? key : `${import.meta.env.BASE_URL}${key}`;
};

/* WebP first, and the fallback is not a formality: `canvas.toBlob` given a type it cannot
 * encode falls back to PNG SILENTLY rather than failing. So the caller must name the type
 * from the blob it got back, never from the one it asked for - a PNG stored under a .webp
 * key with an image/webp content-type is a file that will not render. */
const WANT = 'image/webp';

const decode = file => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image we can read.')); };
  img.src = url;
});

const toBlob = (canvas, type, quality) =>
  new Promise(resolve => canvas.toBlob(resolve, type, quality));

/**
 * A File in, `{ data, type }` out - base64 and the type the browser actually produced.
 *
 * Cropped to the CENTRE square before scaling, rather than squashed to fit: a face in a
 * circle that has been stretched reads as a bad photo rather than as a bad crop.
 */
export async function normalise(file) {
  const img = await decode(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!side) throw new Error('That image has no size to it.');

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  /* A transparent PNG would otherwise land on the black that a fresh canvas is. White,
   * because the chip it ends up in sits on a light or dark bar and a face on a white plate
   * reads as a photo either way - the same argument as the white plate under a matplotlib
   * figure. */
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img,
    (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
    0, 0, SIZE, SIZE);

  const blob = await toBlob(canvas, WANT, 0.86)
    // A browser that encodes neither WebP nor anything at this call has bigger problems, but
    // an explicit JPEG attempt is one line and turns a null into a picture.
    || await toBlob(canvas, 'image/jpeg', 0.86);
  if (!blob) throw new Error('This browser could not prepare that image.');

  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  // In chunks: String.fromCharCode(...) on a whole array blows the argument limit somewhere
  // north of a hundred thousand bytes, and does it as a RangeError nobody would connect to
  // an avatar.
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));

  return { data: btoa(binary), type: blob.type || 'image/png', bytes: bytes.length };
}
